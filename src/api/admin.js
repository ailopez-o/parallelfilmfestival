import { supabase } from '../config/supabase.js';

/**
 * Admin API service.
 * Handles user management, logs, and application settings.
 */
export const AdminService = {
  getPublicSocialAssetUrl(path) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error('Missing VITE_SUPABASE_URL for social metadata URL generation');
    }
    const normalizedBase = supabaseUrl.replace(/\/$/, '');
    return `${normalizedBase}/storage/v1/object/public/social/${path}`;
  },
  /**
   * Fetches all registered profiles.
   */
  async fetchAllProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Deletes a user and all their associated data completely via Edge Function.
   */
  async deleteUser(userId) {
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { targetUserId: userId }
    });
    
    if (error) {
      console.error('Edge function error:', error);
      throw error;
    }
    
    if (data && data.error) {
      throw new Error(data.error);
    }
  },

  /**
   * Fetches participation logs for the admin dashboard.
   */
  async fetchParticipationLogs(limit = 50) {
    const { data, error } = await supabase
      .from('participation_log')
      .select('*, profiles!user_id(full_name, email), movies(title, tmdb_id)')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  },
  
  /**
   * Logs a user participation event (like attendance, proposals, voting).
   */
  async logParticipation(userId, actionType, movieId = null) {
    const logData = { user_id: userId, action_type: actionType };
    if (movieId) logData.movie_id = movieId;
    const { error } = await supabase.from('participation_log').insert([logData]);
    if (error) throw error;
  },

  /**
   * Fetches application settings (limits, etc.)
   */
  async fetchAppSettings() {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (error) throw error;
    
    const settings = {};
    data?.forEach(setting => {
      if (setting.key === 'max_proposals') settings.maxProposals = parseInt(setting.value);
      if (setting.key === 'max_votes') settings.maxVotes = parseInt(setting.value);
    });
    if (!Number.isInteger(settings.maxProposals) || !Number.isInteger(settings.maxVotes)) {
      throw new Error('Missing required app settings in DB: max_proposals and/or max_votes');
    }

    return settings;
  },
  
  /**
   * Updates multiple application settings.
   */
  async updateAppSettings(newMaxProposals, newMaxVotes) {
    const [maxProposalsResult, maxVotesResult] = await Promise.all([
      supabase.from('app_settings').update({ value: newMaxProposals.toString() }).eq('key', 'max_proposals'),
      supabase.from('app_settings').update({ value: newMaxVotes.toString() }).eq('key', 'max_votes')
    ]);

    const errors = [maxProposalsResult.error, maxVotesResult.error].filter(Boolean);
    if (errors.length > 0) {
      const joinedMessage = errors.map(e => e.message || 'Unknown settings update error').join(' | ');
      throw new Error(`Failed to update app settings: ${joinedMessage}`);
    }
  },
  
  /**
   * Cleans up movies that have been inactive for more than 15 days.
   */
  async cleanupInactiveMovies() {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    const thresholdIso = fifteenDaysAgo.toISOString();
    
    const { data: moviesToClean, error: fetchErr } = await supabase
      .from('movies')
      .select('id, title, created_at, is_dropped, is_seen, proposed_by')
      .eq('is_dropped', false)
      .eq('is_seen', false);
      
    if (fetchErr || !moviesToClean) throw fetchErr || new Error('No movies found');

    if (moviesToClean.length === 0) {
      return { cleanedCount: 0 };
    }

    const candidateIds = moviesToClean.map(m => m.id);
    const { data: recentVotes, error: votesErr } = await supabase
      .from('votes')
      .select('movie_id')
      .in('movie_id', candidateIds)
      .gte('created_at', thresholdIso);
      
    if (votesErr) throw votesErr;

    const activeMovieIds = new Set((recentVotes || []).map(v => v.movie_id));
    const toDrop = moviesToClean.filter(m => {
      const proposalDate = new Date(m.created_at);
      return proposalDate < fifteenDaysAgo && !activeMovieIds.has(m.id);
    });

    if (toDrop.length === 0) {
      return { cleanedCount: 0 };
    }

    const ids = toDrop.map(m => m.id);
    const { error: updateErr } = await supabase
      .from('movies')
      .update({ is_dropped: true })
      .in('id', ids);

    if (updateErr) throw updateErr;

    // Log the points loss for each movie proposer and voter
    try {
      const logs = [];
      
      // Points loss for proposers (-4)
      toDrop.forEach(m => {
        logs.push({
          user_id: m.proposed_by,
          action_type: 'cemetery_drop',
          movie_id: m.id
        });
      });

      // Points loss for voters (-1)
      const { data: voters } = await supabase
        .from('votes')
        .select('user_id, movie_id')
        .in('movie_id', ids);

      voters?.forEach(v => {
        logs.push({
          user_id: v.user_id,
          action_type: 'cemetery_vote_loss',
          movie_id: v.movie_id
        });
      });

      if (logs.length > 0) {
        await supabase.from('participation_log').insert(logs);
      }

      // NEW: Permanently delete votes for dropped movies to free up user vote slots
      await supabase.from('votes').delete().in('movie_id', ids);
      
    } catch (logErr) {
      console.error('Error logging automatic drops:', logErr);
    }
    
    return { cleanedCount: toDrop.length };
  },

  /**
   * Updates the social preview metadata (image and HTML) for the next upcoming session.
   * 1. Updates the poster image in Supabase Storage.
   * 2. Fetches the current next-session.html as a template.
   * 3. Replaces OG tags with dynamic content.
   * 4. Uploads the updated HTML to Supabase Storage.
   */
  async updateSocialMetadata(session) {
    if (!session) throw new Error('No session provided');
    
    const movie = session.movies;
    const posterUrl = movie?.poster_url;

    // --- Part 1: Update Image ---
    const imageSource = posterUrl
      ? `https://images.weserv.nl/?url=${encodeURIComponent(posterUrl)}`
      : '/coming-soon.png';

    const response = await fetch(imageSource);
    if (!response.ok) throw new Error(`Failed to download image (Source Error: ${response.status})`);
    
    const imageBlob = await response.blob();
    const imageContentType = response.headers.get('content-type') || imageBlob.type || 'image/jpeg';
    const { error: storageError } = await supabase.storage
      .from('social')
      .upload('current-poster.jpg', imageBlob, {
        contentType: imageContentType,
        upsert: true
      });
    
    if (storageError) throw new Error(`Storage error (image): ${storageError.message}`);

    // --- Part 2: Update HTML Metadata ---
    // Fetch the current HTML to use as a template (fresh from the server)
    const htmlResponse = await fetch(`/next-session.html?v=${Date.now()}`);
    if (!htmlResponse.ok) throw new Error('Failed to fetch next-session.html template');
    let html = await htmlResponse.text();

    // IMPORTANT: Convert relative assets to absolute URLs so they work when hosted on Supabase Storage
    const domain = window.location.origin;
    html = html.replace(/(src|href)="\/(assets\/|style\.css|src\/)/gi, `$1="${domain}/$2`);

    const dateObj = new Date(session.session_date);
    const dateStr = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    const timeStr = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    const title = `${movie?.title || 'Film To Be Decided'} | Paral·lel Film Festival`;
    const description = `📅 ${dateStr} a las ${timeStr}. 📍 ${session.location || 'Paral·lel Cinema'}. ¡Únete a nosotros!`;
    const imageUrl = `${this.getPublicSocialAssetUrl('current-poster.jpg')}?v=${Date.now()}`;

    // Precise surgical replacement of OG tags only
    const replacements = [
      { regex: /<meta property="og:title" content="[^"]*">/i, replacement: `<meta property="og:title" content="${title}">` },
      { regex: /<meta property="og:description" content="[^"]*">/i, replacement: `<meta property="og:description" content="${description}">` },
      { regex: /<meta property="og:image" content="[^"]*">/i, replacement: `<meta property="og:image" content="${imageUrl}">` },
      { regex: /<meta name="twitter:title" content="[^"]*">/i, replacement: `<meta name="twitter:title" content="${title}">` },
      { regex: /<meta name="twitter:description" content="[^"]*">/i, replacement: `<meta name="twitter:description" content="${description}">` },
      { regex: /<meta name="twitter:image" content="[^"]*">/i, replacement: `<meta name="twitter:image" content="${imageUrl}">` }
    ];

    replacements.forEach(r => {
      html = html.replace(r.regex, r.replacement);
    });

    // --- Part 3: Upload HTML to Storage ---
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const { error: htmlStorageError } = await supabase.storage
      .from('social')
      .upload('next-session.html', htmlBlob, {
        contentType: 'text/html',
        upsert: true
      });

    if (htmlStorageError) throw new Error(`Storage error (html): ${htmlStorageError.message}`);

    return { 
      success: true, 
      movieTitle: movie?.title || 'Film To Be Decided'
    };
  }
};

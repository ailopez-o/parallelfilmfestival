import { supabase } from '../config/supabase.js';

/**
 * Admin API service.
 * Handles user management, logs, and application settings.
 */
export const AdminService = {
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
    return settings;
  },
  
  /**
   * Updates multiple application settings.
   */
  async updateAppSettings(newMaxProposals, newMaxVotes) {
    await Promise.all([
      supabase.from('app_settings').update({ value: newMaxProposals.toString() }).eq('key', 'max_proposals'),
      supabase.from('app_settings').update({ value: newMaxVotes.toString() }).eq('key', 'max_votes')
    ]);
  },
  
  /**
   * Cleans up movies that have been inactive for more than 15 days.
   */
  async cleanupInactiveMovies() {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    
    const { data: moviesToClean, error: fetchErr } = await supabase
      .from('movies')
      .select('id, title, created_at, is_dropped, is_seen, proposed_by')
      .eq('is_dropped', false)
      .eq('is_seen', false);
      
    if (fetchErr || !moviesToClean) throw fetchErr || new Error('No movies found');

    const { data: allVotes, error: votesErr } = await supabase
      .from('votes')
      .select('movie_id, created_at');
      
    if (votesErr) throw votesErr;

    const toDrop = moviesToClean.filter(m => {
      const proposalDate = new Date(m.created_at);
      const movieVotes = (allVotes || []).filter(v => v.movie_id === m.id);
      if (movieVotes.length === 0) {
        return proposalDate < fifteenDaysAgo;
      } else {
        const lastVoteDate = new Date(Math.max(...movieVotes.map(v => new Date(v.created_at))));
        return lastVoteDate < fifteenDaysAgo;
      }
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
   * Updates the social preview image for the next upcoming session.
   * Requires a 'social' bucket in Supabase Storage with public access.
   */
  async updateSocialImage(session) {
    if (!session) throw new Error('No session provided');
    
    const movie = session.movies;
    const posterUrl = movie?.poster_url;
    if (!posterUrl) throw new Error('Session has no movie poster');

    const response = await fetch(posterUrl);
    const imageBlob = await response.blob();
    
    const { error } = await supabase.storage
      .from('social')
      .upload('current-poster.jpg', imageBlob, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (error) throw error;
    return { success: true };
  }
};

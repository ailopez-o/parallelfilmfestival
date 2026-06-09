import { supabase } from '../config/supabase.js';
import nextSessionTemplate from '../../next-session.html?raw';

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeOrigin(url) {
  return url.replace(/\/$/, '');
}

function extractOriginFromCanonicalUrl(html) {
  const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
  if (!ogUrlMatch?.[1]) {
    return normalizeOrigin(window.location.origin);
  }

  try {
    return normalizeOrigin(new URL(ogUrlMatch[1]).origin);
  } catch {
    return normalizeOrigin(window.location.origin);
  }
}

function absolutizeAssetUrl(path, origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedOrigin}${normalizedPath}`;
}

function collectManifestAssets(manifest, entryKey) {
  const entry = manifest?.[entryKey];
  if (!entry?.file) return null;

  const importedJs = [];
  const cssFiles = [];
  const visited = new Set();

  const visit = (key) => {
    if (!key || visited.has(key)) return;
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) return;

    if (chunk.file && !chunk.isEntry && !importedJs.includes(chunk.file)) {
      importedJs.push(chunk.file);
    }

    chunk.css?.forEach((cssFile) => {
      if (!cssFiles.includes(cssFile)) {
        cssFiles.push(cssFile);
      }
    });

    chunk.imports?.forEach(visit);
  };

  entry.imports?.forEach(visit);

  return {
    entryFile: entry.file,
    importedJs,
    cssFiles
  };
}

function buildNextSessionAssetMarkup({ entryFile, importedJs, cssFiles }, publicOrigin) {
  const lines = [
    `    <script type="module" crossorigin src="${absolutizeAssetUrl(entryFile, publicOrigin)}"></script>`
  ];

  importedJs.forEach((file) => {
    lines.push(`    <link rel="modulepreload" crossorigin href="${absolutizeAssetUrl(file, publicOrigin)}">`);
  });

  cssFiles.forEach((file) => {
    lines.push(`    <link rel="stylesheet" crossorigin href="${absolutizeAssetUrl(file, publicOrigin)}">`);
  });

  return lines.join('\n');
}

function replaceNextSessionAssetBlock(html, assetMarkup) {
  let updatedHtml = html
    .replace(/\s*<link[^>]*id="theme-link"[^>]*>\s*/i, '\n')
    .replace(/\s*<script[^>]*type="module"[^>]*src="[^"]*\/src\/next_session\.js"[^>]*><\/script>\s*/i, '\n')
    .replace(/\s*<script[^>]*type="module"[^>]*src="[^"]*\/assets\/[^"]+"[^>]*><\/script>\s*/gi, '\n')
    .replace(/\s*<link[^>]*rel="modulepreload"[^>]*href="[^"]*\/assets\/[^"]+"[^>]*>\s*/gi, '\n')
    .replace(/\s*<link[^>]*rel="stylesheet"[^>]*href="[^"]*\/assets\/[^"]+"[^>]*>\s*/gi, '\n');

  updatedHtml = updatedHtml.replace('</head>', `${assetMarkup}\n  </head>`);
  return updatedHtml;
}

function extractBuiltAssetMarkup(html) {
  const matches = html.match(
    /<script[^>]*type="module"[^>]*src="[^"]*(?:\/assets\/|assets\/)[^"]+"[^>]*><\/script>|<link[^>]*rel="modulepreload"[^>]*href="[^"]*(?:\/assets\/|assets\/)[^"]+"[^>]*>|<link[^>]*rel="stylesheet"[^>]*href="[^"]*(?:\/assets\/|assets\/)[^"]+"[^>]*>/gi
  );

  if (!matches?.length) return null;
  return matches.map((tag) => `    ${tag.trim()}`).join('\n');
}

function normalizeTemplateAssetUrls(html, publicOrigin) {
  return html
    .replace(/(src|href)="https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/(assets\/[^"]+)"/gi, (_, attr, path) => `${attr}="${absolutizeAssetUrl(path, publicOrigin)}"`)
    .replace(/(src|href)="\/(assets\/[^"]+)"/gi, (_, attr, path) => `${attr}="${absolutizeAssetUrl(path, publicOrigin)}"`)
    .replace(/(src|href)="\/(style\.css|src\/[^"]+)"/gi, (_, attr, path) => `${attr}="${absolutizeAssetUrl(path, publicOrigin)}"`);
}

export function computeActivityScore(totalVotes, recentVotes) {
  return totalVotes * (recentVotes > 0 ? 2 : 1);
}

export function selectBottomHalf(movies) {
  const sorted = [...movies].sort((a, b) => a.score - b.score);
  const cullCount = Math.floor(sorted.length / 2);
  return sorted.slice(0, cullCount);
}

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

    // Candidates: proposed movies older than 15 days
    const { data: candidates, error: fetchErr } = await supabase
      .from('movies')
      .select('id, title, created_at')
      .eq('is_dropped', false)
      .eq('is_seen', false)
      .lt('created_at', thresholdIso);

    if (fetchErr) throw fetchErr;
    if (!candidates || candidates.length === 0) return { cleanedCount: 0 };

    const candidateIds = candidates.map(m => m.id);

    // All votes ever cast for these candidates
    const { data: allVotes, error: allVotesErr } = await supabase
      .from('votes')
      .select('movie_id')
      .in('movie_id', candidateIds);

    if (allVotesErr) throw allVotesErr;

    // Votes cast in the last 15 days
    const { data: recentVoteData, error: recentVotesErr } = await supabase
      .from('votes')
      .select('movie_id')
      .in('movie_id', candidateIds)
      .gte('created_at', thresholdIso);

    if (recentVotesErr) throw recentVotesErr;

    const totalByMovie = new Map();
    const recentByMovie = new Map();
    (allVotes || []).forEach(v => {
      totalByMovie.set(v.movie_id, (totalByMovie.get(v.movie_id) || 0) + 1);
    });
    (recentVoteData || []).forEach(v => {
      recentByMovie.set(v.movie_id, (recentByMovie.get(v.movie_id) || 0) + 1);
    });

    const scored = candidates.map(m => ({
      ...m,
      score: computeActivityScore(
        totalByMovie.get(m.id) || 0,
        recentByMovie.get(m.id) || 0
      )
    }));

    const toDrop = selectBottomHalf(scored);
    if (toDrop.length === 0) return { cleanedCount: 0 };

    const ids = toDrop.map(m => m.id);

    const { error: updateErr } = await supabase
      .from('movies')
      .update({ is_dropped: true })
      .in('id', ids);

    if (updateErr) throw updateErr;

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
    let html = nextSessionTemplate;
    const publicOrigin = extractOriginFromCanonicalUrl(html);
    let assetMarkup = null;

    try {
      const manifestResponse = await fetch(`/manifest.json?v=${Date.now()}`, { cache: 'no-store' });
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        const nextSessionAssets = collectManifestAssets(manifest, 'next-session.html');

        if (nextSessionAssets) {
          assetMarkup = buildNextSessionAssetMarkup(nextSessionAssets, publicOrigin);
        }
      }
    } catch (manifestError) {
      console.warn('Unable to load Vite manifest for social metadata:', manifestError);
    }

    if (!assetMarkup) {
      try {
        const currentHtmlResponse = await fetch(`/next-session.html?v=${Date.now()}`, { cache: 'no-store' });
        if (currentHtmlResponse.ok) {
          const currentHtml = await currentHtmlResponse.text();
          assetMarkup = extractBuiltAssetMarkup(currentHtml);
        }
      } catch (templateError) {
        console.warn('Unable to load served next-session template for social metadata:', templateError);
      }
    }

    if (assetMarkup) {
      html = replaceNextSessionAssetBlock(html, assetMarkup);
    }

    html = normalizeTemplateAssetUrls(html, publicOrigin);

    const dateObj = new Date(session.session_date);
    const dateStr = dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    const timeStr = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    const title = `${movie?.title || 'Film To Be Decided'} | Paral·lel Film Festival`;
    const description = `📅 ${dateStr} a las ${timeStr}. 📍 ${session.location || 'Paral·lel Cinema'}. ¡Únete a nosotros!`;
    const imageUrl = `${this.getPublicSocialAssetUrl('current-poster.jpg')}?v=${Date.now()}`;

    // Precise surgical replacement of OG tags only
    const replacements = [
      { regex: /<meta property="og:title" content="[^"]*">/i, replacement: `<meta property="og:title" content="${escapeHtmlAttribute(title)}">` },
      { regex: /<meta property="og:description" content="[^"]*">/i, replacement: `<meta property="og:description" content="${escapeHtmlAttribute(description)}">` },
      { regex: /<meta property="og:image" content="[^"]*">/i, replacement: `<meta property="og:image" content="${escapeHtmlAttribute(imageUrl)}">` },
      { regex: /<meta name="twitter:title" content="[^"]*">/i, replacement: `<meta name="twitter:title" content="${escapeHtmlAttribute(title)}">` },
      { regex: /<meta name="twitter:description" content="[^"]*">/i, replacement: `<meta name="twitter:description" content="${escapeHtmlAttribute(description)}">` },
      { regex: /<meta name="twitter:image" content="[^"]*">/i, replacement: `<meta name="twitter:image" content="${escapeHtmlAttribute(imageUrl)}">` }
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

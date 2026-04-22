import { FALLBACK_IMAGE } from '../config/constants.js';
import { formatScore } from '../utils/formatters.js';

/**
 * Generates the HTML for a movie card.
 * 
 * @param {Object} movie - Movie data object.
 * @param {Object} options - Configuration and state.
 * @param {string} options.context - Rendering context ('proposal', 'history', 'showcase', 'cemetery', 'explore').
 * @param {boolean} options.showDelete - Whether to show the delete button.
 * @param {boolean} options.isAdmin - Whether the current user is an admin.
 * @param {Object} options.user - Current user object.
 * @param {Set} options.userVotes - Set of movie IDs the user has voted for.
 * @param {number} options.rank - Rank (for showcase context).
 * @returns {string} HTML string for the movie card.
 */
export function createMovieCardHTML(movie, options = {}) {
  const { 
    context = 'proposal', 
    showDelete = false,
    isAdmin = false,
    user = null,
    userVotes = new Set()
  } = options;
  
  const hasVoted = userVotes.has(movie.id);
  const genres = (movie.genres || []).slice(0, 3);
  const posterUrl = movie.poster_url || (movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : FALLBACK_IMAGE);
  const releaseYear = movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : 'N/A');
  
  // Watch providers
  const providers = movie.watch_providers?.flatrate || [];
  const providersLink = movie.watch_providers?.link || '#';

  const cardClass = context === 'history' ? 'movie-card seen' : 
                   context === 'showcase' ? 'movie-card top-highlight-card' : 
                   context === 'cemetery' ? 'movie-card dropped' : 'movie-card';

  return `
    <div class="${cardClass}" data-id="${movie.id || ''}">
      ${context === 'showcase' ? `
        <div class="top-badge">
          <i data-lucide="award"></i> #${options.rank} MOST WANTED
        </div>
      ` : ''}
      <div class="poster-wrapper">
        <img src="${posterUrl}" alt="${movie.title}" loading="lazy" onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'">
        
        <!-- Explore Context Overlay (Now inside poster) -->
        ${context === 'explore' ? `
          <div class="propose-overlay">
            <button class="btn-propose" onclick="window.proposeMovie(${JSON.stringify(movie).replace(/"/g, '&quot;')}, this)">
              <i data-lucide="plus"></i> Propose Movie
            </button>
          </div>
        ` : ''}
      </div>

      ${isAdmin ? `
        <div class="admin-actions-overlay">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
          <button class="delete-movie-btn perm-delete" onclick="window.deleteMovie('${movie.id}')" title="Delete Permanently">
            <i data-lucide="x-circle"></i>
          </button>
        </div>
      ` : ((showDelete || (user && movie.proposed_by === user.id)) && !movie.is_seen && context !== 'cemetery' ? `
        <div class="admin-actions-overlay user-only">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      ` : '')}

      <div class="movie-info">
        <div class="header-main">
          <div class="title-row">
            <div class="movie-title">${movie.title}</div>
            <div class="rating-badge">
              <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
              <span class="rating-value">${formatScore(movie.vote_average)}</span>
            </div>
          </div>
          <div class="movie-meta">
            <span>${releaseYear} • ${movie.director || 'Unknown'}</span>
            ${movie.trailer_url ? `
              <a href="${movie.trailer_url}" target="_blank" class="trailer-link-btn ${context === 'history' ? 'mini' : ''}" title="Watch Trailer">
                <i data-lucide="play-circle"></i> Trailer
              </a>
            ` : ''}
          </div>
        </div>

        <div class="genre-tags">
          ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
        </div>

        <div class="synopsis">${movie.synopsis || 'No synopsis available.'}</div>

        <!-- Watch Providers -->
        ${providers.length > 0 ? `
          <div class="watch-providers ${context === 'history' || context === 'activity' ? 'mini' : ''}">
            <span class="provider-label">Available on:</span>
            <div class="provider-list">
              ${providers.slice(0, 4).map(p => `
                <a href="${providersLink}" target="_blank" class="provider-icon ${context === 'history' || context === 'activity' ? 'small' : ''}" title="${p.provider_name}">
                  <img src="https://image.tmdb.org/t/p/original${p.logo_path}" alt="${p.provider_name}">
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Context Actions -->
        ${context === 'proposal' ? `
          <div class="voting-container">
            <div class="vote-main-actions">
              <button class="vote-btn like-btn ${hasVoted ? 'active' : ''}" onclick="window.toggleVote('${movie.id}')">
                <i data-lucide="heart"></i>
                <span>${hasVoted ? 'Voted' : 'Vote'}</span>
              </button>
              <span class="vote-count">${movie.vote_count || 0} votes</span>
            </div>

            ${isAdmin ? `
              <button class="mark-seen-btn" onclick="window.markAsSeen('${movie.id}')">
                <i data-lucide="check-circle"></i> Mark as Seen
              </button>
            ` : ''}
          </div>
        ` : ''}

        ${context === 'history' ? `
          <div class="rating-input-wrapper">
            <div style="display:flex; justify-content:space-between; font-size: 0.8rem; margin-bottom: 0.5rem;">
              <span style="font-weight:600; color:var(--text-secondary);">Your Rating</span>
              <span id="rating-val-${movie.id}" style="font-weight:700; color:#fbbf24;">${movie.user_rating || 0} / 10</span>
            </div>
            <div class="star-rating" onmouseleave="window.resetStars('${movie.id}', ${movie.user_rating || 0})">
              ${Array.from({ length: 10 }, (_, i) => i + 1).map(num => `
                <button class="star-btn ${movie.user_rating >= num ? 'star-filled' : ''}" 
                        data-star="${num}"
                        onmouseover="window.hoverStars('${movie.id}', ${num})"
                        onclick="window.rateMovie('${movie.id}', ${num})">
                  <i data-lucide="star"></i>
                </button>
              `).join('')}
            </div>
            <div class="community-avg-box">
              <span class="community-label">Festival Average</span>
              <span class="community-score" id="comm-avg-${movie.id}">${movie.average_community_rating ? movie.average_community_rating.toFixed(1) : '0.0'}</span>
            </div>
          </div>
        ` : ''}

        ${context === 'history' && isAdmin ? `
          <button class="unmark-seen-btn" onclick="window.unmarkAsSeen('${movie.id}')">
            <i data-lucide="rotate-ccw"></i> Back to Proposals
          </button>
        ` : ''}
        ${context === "cemetery" ? `
          <div class="cemetery-status">
            <i data-lucide="skull"></i>
            <span>Dropped Film</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

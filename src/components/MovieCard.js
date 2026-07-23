import { FALLBACK_IMAGE } from '../config/constants.js';
import { formatRuntime, formatScore } from '../utils/formatters.js';
import { escapeHtml, getUserDisplayName, sanitizeUrl } from '../utils/index.js';

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
  const posterUrl = sanitizeUrl(
    movie.poster_url || (movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : FALLBACK_IMAGE),
    FALLBACK_IMAGE
  );
  const releaseYear = movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : 'N/A');
  const runtimeLabel = formatRuntime(movie.runtime || movie.duration || movie.runtime_minutes);
  const safeTitle = escapeHtml(movie.title || 'Untitled');
  const safeDirector = escapeHtml(movie.director || 'Unknown');
  const safeSynopsis = escapeHtml(movie.synopsis || 'No synopsis available.');
  const safeUserComment = escapeHtml(movie.user_comment || '');
  const movieDirectorYear = [safeDirector, releaseYear].filter(Boolean).join(' • ');
  const runtimeDisplay = runtimeLabel || '—';

  // Watch providers
  const providers = movie.watch_providers?.flatrate || [];
  const providersLink = sanitizeUrl(movie.watch_providers?.link, '#');
  const trailerUrl = sanitizeUrl(movie.trailer_url, '#');

  const cardClass = context === 'history' ? 'movie-card seen horizontal' :
                   context === 'showcase' ? 'movie-card top-highlight-card' :
                   context === 'cemetery' ? 'movie-card dropped' : 'movie-card';

  return `
    <div class="${cardClass}" data-id="${movie.id || ''}">
      ${context === 'showcase' ? `
        <div class="top-badge">
          <i data-lucide="award"></i> #${options.rank} MOST WANTED
        </div>
        <div class="showcase-vote-count">
          <i data-lucide="heart"></i>
          <span>${movie.vote_count || 0} ${movie.vote_count === 1 ? 'vote' : 'votes'}</span>
        </div>
      ` : ''}
      <div class="poster-wrapper">
        <img src="${posterUrl}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'">

        ${context === 'explore' ? `
          <div class="propose-overlay">
            <button class="btn-propose" onclick="window.proposeMovie(${escapeHtml(JSON.stringify(movie))}, this)">
              <i data-lucide="plus"></i> Propose Movie
            </button>
          </div>
        ` : ''}

        ${context === 'cemetery' ? `
          <div class="cemetery-vote-badge">
            <i data-lucide="heart"></i>
            <span>${movie.vote_count || 0}</span>
          </div>
        ` : ''}
      </div>

      ${isAdmin && context !== 'showcase' ? `
        <div class="admin-actions-overlay">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
          <button class="delete-movie-btn perm-delete" onclick="window.deleteMovie('${movie.id}')" title="Delete Permanently">
            <i data-lucide="x-circle"></i>
          </button>
        </div>
      ` : ((showDelete || (user && movie.proposed_by === user.id)) && !movie.is_seen && context !== 'cemetery' && context !== 'showcase' ? `
        <div class="admin-actions-overlay user-only">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      ` : '')}

      <div class="movie-info">
        ${context === 'history' ? '' : `
          <div class="header-main">
            <div class="title-row">
              <div class="movie-title">${safeTitle}</div>
              <div class="rating-badge">
                <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
                <span class="rating-value">${formatScore(movie.vote_average)}</span>
              </div>
            </div>
            <div class="movie-meta">${movieDirectorYear}</div>
            <div class="movie-runtime">
              <i data-lucide="clock" class="runtime-icon"></i>
              <span${runtimeLabel ? '' : ' data-empty'}>${runtimeDisplay}</span>
              ${movie.trailer_url ? `
                <a href="${trailerUrl}" target="_blank" rel="noopener noreferrer" class="trailer-link-btn" title="Watch Trailer" style="margin-left:auto;">
                  <i data-lucide="play-circle"></i> Trailer
                </a>
              ` : ''}
            </div>
          </div>

          <div class="genre-tags">
            ${genres.map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('')}
          </div>

          <div class="synopsis">${safeSynopsis}</div>
        `}

        <!-- Watch Providers -->
        ${providers.length > 0 ? `
          <div class="watch-providers ${context === 'history' || context === 'activity' ? 'mini' : ''}">
            <span class="provider-label">Available on:</span>
            <div class="provider-list">
              ${providers.slice(0, 4).map(p => `
                <a href="${providersLink}" target="_blank" rel="noopener noreferrer" class="provider-icon ${context === 'history' || context === 'activity' ? 'small' : ''}" title="${escapeHtml(p.provider_name)}">
                  <img src="${sanitizeUrl(`https://image.tmdb.org/t/p/original${p.logo_path}`, FALLBACK_IMAGE)}" alt="${escapeHtml(p.provider_name)}">
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
          <div class="history-full-layout">
            <div class="history-header-compact">
              <div class="title-row">
                <div class="movie-title">${safeTitle}</div>
                <div class="rating-badge">
                  <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
                  <span class="rating-value">${formatScore(movie.vote_average)}</span>
                </div>
              </div>
              <div class="movie-meta">${movieDirectorYear}</div>
              <div class="movie-runtime">
                <i data-lucide="clock" class="runtime-icon"></i>
                <span${runtimeLabel ? '' : ' data-empty'}>${runtimeDisplay}</span>
                ${movie.trailer_url ? `<a href="${trailerUrl}" target="_blank" rel="noopener noreferrer" class="trailer-link-btn mini" style="margin-left:auto;"><i data-lucide="play-circle"></i></a>` : ''}
              </div>
            </div>

            <div class="history-content-row">
              <div class="history-synopsis-compact">${safeSynopsis}</div>

              <div class="history-metadata-right">
                <div class="avg-pill large"><i data-lucide="star"></i> ${movie.average_community_rating ? movie.average_community_rating.toFixed(1) : '0.0'}</div>
                ${!options.hasAttended ? `
                  <div class="attendance-notice-inline">
                    <i data-lucide="info"></i> Not attended
                  </div>
                ` : ''}
              </div>
            </div>

            <div class="history-reviews-section">
              ${(() => {
                const hasUserReview = options.hasAttended && (movie.user_rating > 0 || !!(movie.user_comment?.trim()));
                const communityReviews = (movie.reviews || []).filter(rev => !user || rev.user_id !== user.id);
                const userName = user ? getUserDisplayName(user, user) : 'You';
                const userAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&size=32`;

                return `
              <div class="reviews-title-row">
                <span>Community Reviews (${communityReviews.length})</span>
              </div>

              ${options.hasAttended ? `
                <div id="review-section-${movie.id}">

                  ${hasUserReview ? `
                  <div class="review-view-mode">
                    <div class="review-line your-review-read">
                      <img src="${userAvatar}" class="rev-avatar-mini" />
                      <div class="rev-main">
                        <div class="rev-top">
                          <div class="rev-name-group">
                            <span class="rev-name" style="color:var(--accent);">Your Review</span>
                            <button class="edit-review-btn" onclick="window.startEditReview('${movie.id}')" title="Edit review">
                              <i data-lucide="pencil"></i>
                            </button>
                          </div>
                          <div class="rev-stars-bar">
                            ${Array.from({length: 10}).map((_, i) => `<div class="star-dot ${movie.user_rating > i ? 'active' : ''}"></div>`).join('')}
                          </div>
                        </div>
                        ${movie.user_comment ? `<p class="rev-text-compact">${safeUserComment}</p>` : ''}
                      </div>
                    </div>
                  </div>
                  ` : ''}

                  <div class="review-edit-mode"${hasUserReview ? ' style="display:none"' : ''}>
                    <div class="your-review-line-editor">
                      <div class="rev-avatar-mini" style="background:var(--accent); display:flex; align-items:center; justify-content:center;">
                        <i data-lucide="edit-3" style="width:12px; height:12px; color:white;"></i>
                      </div>
                      <div class="rev-main">
                        <div class="rev-top">
                          <span class="rev-name" style="color:var(--accent);">Your Review</span>
                          <div class="star-rating mini" onmouseleave="window.resetStars('${movie.id}', ${movie.user_rating || 0})">
                            ${Array.from({ length: 10 }, (_, i) => i + 1).map(num => `
                              <button class="star-btn ${movie.user_rating >= num ? 'star-filled' : ''}"
                                      data-star="${num}"
                                      onmouseover="window.hoverStars('${movie.id}', ${num})"
                                      onclick="window.selectRating('${movie.id}', ${num})">
                                <i data-lucide="star"></i>
                              </button>
                            `).join('')}
                          </div>
                        </div>
                        <div class="comment-row-compact">
                          <textarea id="comment-input-${movie.id}" class="review-comment-textarea compact" placeholder="How was the film?">${safeUserComment}</textarea>
                          <button class="save-review-btn mini" onclick="window.rateMovie('${movie.id}', document.getElementById('rating-val-${movie.id}')?.textContent || ${movie.user_rating || 0})">
                            <i data-lucide="send"></i>
                          </button>
                          ${hasUserReview ? `
                          <button class="cancel-review-btn" onclick="window.cancelEditReview('${movie.id}')" title="Cancel">
                            <i data-lucide="x"></i>
                          </button>
                          ` : ''}
                          <span id="rating-val-${movie.id}" style="display:none;">${movie.user_rating || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              ` : ''}

              <div class="google-reviews-horizontal">
                ${communityReviews.length ? communityReviews.map(rev => {
                  const name = getUserDisplayName(rev.profiles);
                  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&size=32`;
                  return `
                    <div class="review-line">
                      <img src="${avatar}" class="rev-avatar-mini" />
                      <div class="rev-main">
                        <div class="rev-top">
                          <span class="rev-name">${escapeHtml(name)}</span>
                          <div class="rev-stars-bar">
                            ${Array.from({length: 10}).map((_, i) => `<div class="star-dot ${rev.rating > i ? 'active' : ''}"></div>`).join('')}
                          </div>
                        </div>
                        ${rev.comment ? `<p class="rev-text-compact">${escapeHtml(rev.comment)}</p>` : ''}
                      </div>
                    </div>
                  `;
                }).join('') : '<div class="empty-reviews-compact">No reviews yet.</div>'}
              </div>
                `;
              })()}
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
            <span class="vote-count">${movie.vote_count || 0} votes</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

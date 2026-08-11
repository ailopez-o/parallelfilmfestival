import { 
  createMovieCardHTML, 
  createSessionHeroHTML, 
  createAchievementCardHTML, 
  createTimelineItemHTML 
} from '../components/index.js';
import { escapeHtml, formatRuntime, timeAgo } from '../utils/index.js';

/**
 * Home View Module.
 * Manages the rendering and logic for the Home page.
 */
export const HomeView = {
  /**
   * Renders skeletons for movie grids on the home screen.
   */
  renderMovieGridSkeletons(container, count = 4) {
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-image"></div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text-short"></div>
      </div>
    `).join('');
  },

  /**
   * Renders a skeleton for the next session hero.
   */
  renderNextSessionHeroSkeleton(container) {
    if (!container) return;
    container.classList.remove('page-hidden');
    container.innerHTML = `
      <div class="next-session-skeleton">
        <div class="next-session-skeleton-copy">
          <div class="skeleton skeleton-text-short"></div>
          <div class="skeleton skeleton-title" style="width: 60%; height: 2.75rem;"></div>
          <div class="skeleton skeleton-text" style="width: 85%;"></div>
          <div class="skeleton skeleton-text" style="width: 70%;"></div>
          <div class="next-session-skeleton-meta">
            <div class="skeleton skeleton-text-short" style="width: 120px;"></div>
            <div class="skeleton skeleton-text-short" style="width: 100px;"></div>
            <div class="skeleton skeleton-text-short" style="width: 140px;"></div>
          </div>
        </div>
        <div class="next-session-skeleton-poster">
          <div class="skeleton skeleton-image"></div>
        </div>
      </div>
    `;
  },

  /**
   * Renders skeleton rows for the home activity timeline.
   */
  renderTimelineSkeletons(container, count = 4) {
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
      <tr class="timeline-row">
        <td>
          <div class="event-user-cell">
            <div class="skeleton skeleton-avatar" style="width: 42px; height: 42px;"></div>
            <div class="event-content" style="flex: 1;">
              <div class="skeleton skeleton-text" style="width: 75%; height: 1rem; margin-bottom: 0.5rem;"></div>
              <div class="skeleton skeleton-text-short" style="width: 30%; height: 0.85rem;"></div>
            </div>
          </div>
        </td>
      </tr>
    `).join('');
  },

  /**
   * Renders the proposed movies grid.
   */
  renderProposals(proposedMovies, container, state) {
    if (!container) return;
    if (!proposedMovies.length) {
      container.innerHTML = '<div class="empty-state">No movies proposed yet. Be the first!</div>';
      return;
    }

    container.innerHTML = proposedMovies.map(movie => {
      const isOwner = state.user && movie.proposed_by === state.user.id;
      return createMovieCardHTML(movie, { 
        context: 'proposal', 
        showDelete: isOwner || state.isAdmin,
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes
      });
    }).join('');
  },

  /**
   * Renders the top voted movies showcase.
   */
  renderTopVotedShowcase(proposedMovies, section, grid, state) {
    if (!grid || !section) return;

    const topContenders = [...proposedMovies]
      .filter(m => (m.vote_count || 0) > 0)
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .slice(0, 3);

    if (topContenders.length === 0) {
      section.classList.add('page-hidden');
      return;
    }

    section.classList.remove('page-hidden');
    grid.innerHTML = topContenders.map((movie, index) => 
      createMovieCardHTML(movie, { 
        context: 'showcase', 
        rank: index + 1,
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes
      })
    ).join('');
  },

  /**
   * Renders the seen movies history.
   */
  renderHistory(seenMovies, container, state) {
    if (!container) return;
    if (!seenMovies.length) {
      container.innerHTML = '<div class="empty-state">No movies in history yet.</div>';
      return;
    }

    container.innerHTML = seenMovies.map(movie => {
      const hasAttended = state.userAttendance && state.userAttendance.has(movie.id);
      return createMovieCardHTML(movie, { 
        context: 'history', 
        showDelete: false,
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes,
        hasAttended: hasAttended
      });
    }).join('');
  },

  /**
   * Renders the dropped movies cemetery.
   */
  renderCemetery(droppedMovies, container, state) {
    if (!container) return;
    if (!droppedMovies.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = droppedMovies.map(movie => 
      createMovieCardHTML(movie, { 
        context: 'cemetery',
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes,
        showDelete: state.isAdmin
      })
    ).join('');
  },

  /**
   * Renders community achievements on home page.
   */
  renderHomeAchievements(stats, container, achievementList) {
    if (!container) return;
    container.innerHTML = achievementList.map(a => {
      const userCount = stats[a.id] || 0;
      return `
        <div class="achievement-card ${a.class} active">
          <div class="achievement-header">
            <div class="medal-icon-wrapper">
              <i data-lucide="${a.icon}"></i>
            </div>
            <div class="achievement-info">
              <span class="achievement-name">${a.name}</span>
              <span class="achievement-desc">${a.desc}</span>
              <div class="achievement-stats-badge">
                <i data-lucide="users" style="width:12px; height:12px;"></i>
                ${userCount} users earned this
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  /**
   * Renders the achievement timeline.
   */
  renderTimeline(events, container) {
    if (!container) return;
    if (events.length === 0) {
      container.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No recent activity yet.</td></tr>`;
      return;
    }

	    container.innerHTML = events.map(e => `
	      <tr class="timeline-row event-${e.type}">
        <td>
          <div class="event-user-cell">
            <div class="event-icon-circle">
              <i data-lucide="${e.icon || 'star'}"></i>
            </div>
	            <div class="event-content">
	              <div class="event-message">
	                <span class="event-name">${escapeHtml(e.name || 'User')}</span> ${e.text}
	              </div>
              <div class="event-date">${timeAgo(e.date)}</div>
            </div>
          </div>
        </td>
      </tr>
    `).join('');
  },

  /**
   * Renders the next session hero.
   */
  renderNextSessionHero(upcomingSession, container, state) {
    if (!container) return;
    if (!upcomingSession) {
      container.classList.add('page-hidden');
      return;
    }

    container.classList.remove('page-hidden');
    container.innerHTML = createSessionHeroHTML(upcomingSession, { user: state.user });
  },

  /**
   * Renders the search autocomplete dropdown results.
   */
  renderSearchResults(results, container, formatScore, fallbackImage) {
    if (!container) return;
    if (!results.length) {
      container.innerHTML = '<div class="search-result-item">No movies found</div>';
	    } else {
	      container.innerHTML = results.map(movie => {
          const runtimeLabel = formatRuntime(movie.runtime);
          return `
	          <div class="search-result-item" onclick="window.proposeMovie(${escapeHtml(JSON.stringify(movie))})">
	            <img class="result-poster" src="${movie.poster_path ? 'https://image.tmdb.org/t/p/w92' + movie.poster_path : fallbackImage}">
	            <div class="result-info">
	              <div class="result-title">${escapeHtml(movie.title)}</div>
	              <div class="result-meta">
                <span>${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'}</span>
                ${runtimeLabel ? `<span style="color: rgba(255,255,255,0.2);">•</span><span>${runtimeLabel}</span>` : ''}
                <span style="color: rgba(255,255,255,0.2);">•</span>
                <div class="rating-badge" style="margin:0; padding:0; background:transparent; border:none; font-size: 0.75rem;">
                  <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
                  <span style="color:#fbbf24;">${formatScore(movie.vote_average)}</span>
                </div>
              </div>
	              <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">${escapeHtml(movie.director || 'Unknown')}</div>
	            </div>
	          </div>
	        `;
        }).join('');
    }
    container.classList.add('active');
  }
};

import { createMovieCardHTML, createAchievementCardHTML } from '../components/index.js';

/**
 * Profile View Module.
 * Manages the user profile screen and activity history.
 */
export const ProfileView = {
  /**
   * Renders the profile header and stats.
   */
  renderHeader(profile, options = {}) {
    const { 
      profileName, 
      profileEmail, 
      profileAvatar, 
      countProposals, 
      countVotes,
      maxProposals,
      maxVotes,
      proposalsCount,
      votesCount
    } = options;

    const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'User';
    const displayEmail = profile?.email || 'N/A';
    const displayAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=5850ec&color=fff&size=256&bold=true`;

    if (profileName) profileName.textContent = displayName;
    if (profileEmail) profileEmail.textContent = displayEmail;
    if (profileAvatar) profileAvatar.src = displayAvatar;

    if (countProposals) countProposals.textContent = `${proposalsCount || 0} / ${maxProposals}`;
    if (countVotes) countVotes.textContent = `${votesCount || 0} / ${maxVotes}`;
  },

  /**
   * Renders the activity grid (proposals or votes).
   */
  renderActivityGrid(movies, container, state) {
    if (!container) return;
    if (!movies || movies.length === 0) {
      container.innerHTML = '<div class="empty-state">No movies found in this category.</div>';
      return;
    }

    container.innerHTML = movies.map(movie => {
      const isOwner = state.user && movie.proposed_by === state.user.id;
      return createMovieCardHTML(movie, { 
        context: 'activity', 
        showDelete: isOwner || state.isAdmin,
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes
      });
    }).join('');
  },

  /**
   * Renders user achievements.
   */
  renderAchievements(achievements, container) {
    if (!container) return;
    container.innerHTML = achievements.map(a => createAchievementCardHTML(a)).join('');
  },

  /**
   * Renders skeletons for the profile header.
   */
  renderSkeletonHeader(options = {}) {
    const { profileName, profileEmail, profileAvatar, countProposals, countVotes } = options;
    if (profileName) profileName.innerHTML = '<div class="skeleton skeleton-title" style="width: 200px; height: 2rem;"></div>';
    if (profileEmail) profileEmail.innerHTML = '<div class="skeleton skeleton-text" style="width: 150px;"></div>';
    if (profileAvatar) profileAvatar.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // Transparent 1x1
    if (profileAvatar) profileAvatar.parentElement.classList.add('skeleton');
    
    if (countProposals) countProposals.innerHTML = '<div class="skeleton skeleton-stat"></div>';
    if (countVotes) countVotes.innerHTML = '<div class="skeleton skeleton-stat"></div>';
  },

  /**
   * Renders skeletons for the activity grid.
   */
  renderActivitySkeletons(container, count = 4) {
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-image"></div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text-short"></div>
      </div>
    `).join('');
  },

  /**
   * Renders skeletons for the achievements grid.
   */
  renderAchievementSkeletons(container, count = 3) {
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-achievement">
        <div style="display:flex; gap:1rem; align-items:center;">
          <div class="skeleton skeleton-avatar" style="width:40px; height:40px;"></div>
          <div style="flex:1;">
            <div class="skeleton skeleton-title" style="width:60%; height:1rem; margin-bottom:0.5rem;"></div>
            <div class="skeleton skeleton-text" style="width:80%; height:0.75rem;"></div>
          </div>
        </div>
        <div class="skeleton skeleton-text" style="width:100%; height:8px; margin-top:1rem;"></div>
      </div>
    `).join('');
  }
};

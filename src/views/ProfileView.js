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
  }
};

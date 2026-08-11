import { createMovieCardHTML } from '../components/index.js';

/**
 * Explore View Module.
 * Manages the movie discovery and AI scout functionality.
 */
export const ExploreView = {
  /**
   * Renders the explore search results.
   */
  renderResults(results, container, state) {
    if (!container) return;
    
    if (!results || results.length === 0) {
      container.innerHTML = '<div class="empty-state">No movies found. Try adjusting your filters.</div>';
      return;
    }

    container.innerHTML = results.map(movie => 
      createMovieCardHTML(movie, { 
        context: 'explore',
        isAdmin: state.isAdmin,
        user: state.user,
        userVotes: state.userVotes
      })
    ).join('');
  },

  /**
   * Renders a loading state for the AI Scout.
   */
  renderAILoading(container) {
    if (!container) return;
    container.innerHTML = '<div class="loading-state">Scanning the cinematic multiverse...</div>';
  },

  /**
   * Renders an error state for the AI Scout.
   */
  renderError(container, message) {
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-circle" style="width:48px; height:48px; color:#f87171; margin-bottom:1rem;"></i>
        <p>The AI Scout reached its limits.</p>
        <p style="font-size: 0.85rem; color: #94a3b8;">${message}</p>
        <button class="auth-btn" style="margin-top:1.5rem;" onclick="window.fetchAIRecommendations()">Retry Scout</button>
      </div>`;
  }
};

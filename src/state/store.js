import { DEFAULT_MAX_PROPOSALS, DEFAULT_MAX_VOTES } from '../config/constants.js';

/**
 * Centralized State Management Store.
 * Holds the single source of truth for the application.
 */
class Store {
  constructor() {
    this.state = {
      // Data collections
      allMovies: [],
      proposedMovies: [],
      seenMovies: [],
      droppedMovies: [],
      rankedUsers: [],
      sessions: [],
      
      // User state
      user: null,
      userProfile: null,
      isAdmin: false,
      userVotes: new Set(),
      
      // UI state
      currentView: 'home',
      currentSession: null,
      
      // Configuration state (Dynamic from DB)
      maxProposals: DEFAULT_MAX_PROPOSALS,
      maxVotes: DEFAULT_MAX_VOTES,
      
      // Lookups
      genreMap: {},
      providerMap: {}
    };

    // Listeners for state changes (simple reactivity)
    this.listeners = [];
  }

  /**
   * Returns the current state.
   */
  getState() {
    return this.state;
  }

  /**
   * Updates a portion of the state.
   * @param {Object} newState - The new state properties.
   */
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.notify();
  }

  /**
   * Specific helper to update user votes.
   * @param {Set|Array} votes - New set of votes.
   */
  setUserVotes(votes) {
    this.state.userVotes = new Set(votes);
    this.notify();
  }

  /**
   * Adds a listener for state changes.
   * @param {Function} listener 
   */
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Notifies all listeners of a state change.
   */
  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

// Export a singleton instance of the store
export const store = new Store();
export default store;

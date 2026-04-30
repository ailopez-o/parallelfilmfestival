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
      userAttendance: new Set(),
      
      // UI state
      currentView: 'home',
      currentSession: null,
      
      // Configuration state (Dynamic from DB)
      maxProposals: null,
      maxVotes: null,
      
      // Lookups
      genreMap: {},
      providerMap: {}
    };

    // Listeners for state changes (simple reactivity)
    this.listeners = [];
  }

  /**
   * Returns the live internal state for controller-level orchestration.
   * Subscribers still receive readonly snapshots via notify().
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

  createReadonlySnapshot(value) {
    if (typeof structuredClone === 'function') {
      return this.deepFreeze(structuredClone(value));
    }
    return this.deepFreeze(this.cloneFallback(value));
  }

  cloneFallback(value) {
    if (value instanceof Set) return new Set([...value]);
    if (Array.isArray(value)) return value.map(item => this.cloneFallback(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, this.cloneFallback(v)])
      );
    }
    return value;
  }

  deepFreeze(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      if (
        Object.prototype.hasOwnProperty.call(obj, prop) &&
        obj[prop] !== null &&
        (typeof obj[prop] === 'object' || typeof obj[prop] === 'function') &&
        !Object.isFrozen(obj[prop])
      ) {
        this.deepFreeze(obj[prop]);
      }
    });
    return obj;
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
    const snapshot = this.createReadonlySnapshot(this.state);
    this.listeners.forEach(listener => listener(snapshot));
  }
}

// Export a singleton instance of the store
export const store = new Store();
export default store;

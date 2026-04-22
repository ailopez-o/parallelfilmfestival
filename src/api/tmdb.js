import { supabase } from '../config/supabase.js';
import { TMDB_PROXY_TIMEOUT } from '../config/constants.js';

/**
 * Helper to invoke the TMDB proxy via Supabase Edge Functions.
 * Includes a timeout mechanism to prevent hanging requests.
 * 
 * @param {string} path - TMDB API path (e.g., '/movie/popular').
 * @param {Object} params - Query parameters for the request.
 * @returns {Promise<Object>} The data returned from TMDB.
 */
export const TMDBService = {
  async invokeTMDBCall(path, params = {}) {
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Request Timeout')), ms));
    
    try {
      const response = await Promise.race([
        supabase.functions.invoke('tmdb-proxy', { body: { path, params } }),
        timeout(TMDB_PROXY_TIMEOUT)
      ]);

      const { data, error } = response;
      
      if (error) {
        const msg = error.message || "Unknown Proxy Error";
        console.error(`[TMDB Proxy Error]: ${msg}`, error);
        throw new Error(`TMDB Proxy Error: ${msg}`);
      }
      
      if (data && data.error) {
        console.error(`[TMDB Proxy Logic Error]: ${data.error}`, data.details);
        throw new Error(data.error);
      }

      return data;
    } catch (e) {
      if (e.message === 'Request Timeout') {
        console.warn(`[TMDB Proxy] Timeout reached for ${path}`);
      }
      throw e;
    }
  },

  async searchTMDB(query) {
    if (!query || query.length < 2) return [];
    
    try {
      const data = await this.invokeTMDBCall('/search/movie', { 
        query, 
        include_adult: 'false' 
      });
      return data.results || [];
    } catch (err) {
      console.error('TMDB Search error:', err);
      throw err;
    }
  }
};


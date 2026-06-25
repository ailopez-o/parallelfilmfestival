import { supabase } from '../config/supabase.js';

/**
 * Movies API service layer.
 * Handles all database operations related to movies, votes, and ratings.
 */

export const MovieService = {
  async fetchAllMovies() {
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  async getUserRatings(userId) {
    const { data, error } = await supabase
      .from('user_ratings')
      .select('*')
      .eq('user_id', userId);
    
    if (error) throw error;
    return data || [];
  },

  async getGlobalRatings() {
    const { data, error } = await supabase
      .from('user_ratings')
      .select('movie_id, rating, comment, created_at, user_id');
    
    if (error) throw error;
    return data || [];
  },

  async updateMovieData(movieId, updates) {
    const { data, error } = await supabase
      .from('movies')
      .update(updates)
      .eq('id', movieId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async createMovie(movieData) {
    const { data, error } = await supabase
      .from('movies')
      .insert([movieData])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteMovie(movieId) {
    const { error } = await supabase
      .from('movies')
      .delete()
      .eq('id', movieId);
    
    if (error) throw error;
  },

  async findMovieByTMDBId(tmdbId) {
    const { data, error } = await supabase
      .from('movies')
      .select('*')
      .eq('tmdb_id', tmdbId)
      .maybeSingle();
      
    if (error) throw error;
    return data;
  },

  async rescueMovie(movieId, userId) {
    const { error } = await supabase
      .from('movies')
      .update({ is_dropped: false, proposed_by: userId })
      .eq('id', movieId);
      
    if (error) throw error;
  },

  async fetchVotesForUser(userId) {
    const { data, error } = await supabase
      .from('votes')
      .select('movie_id, movies(is_dropped, is_seen)')
      .eq('user_id', userId);
    
    if (error) throw error;
    return (data || []).filter(vote => !vote.movies?.is_dropped && !vote.movies?.is_seen);
  },

  async addVote(userId, movieId) {
    const { error } = await supabase
      .from('votes')
      .insert([{ user_id: userId, movie_id: movieId }]);
    
    if (error) throw error;
  },

  async removeVote(userId, movieId) {
    const { error } = await supabase
      .from('votes')
      .delete()
      .eq('user_id', userId)
      .eq('movie_id', movieId);

    if (error) throw error;
  },

  async getVoteCountsByMovieIds(movieIds) {
    if (!movieIds.length) return new Map();
    const { data, error } = await supabase
      .from('votes')
      .select('movie_id')
      .in('movie_id', movieIds);
    if (error) throw error;
    const counts = new Map();
    (data || []).forEach(v => counts.set(v.movie_id, (counts.get(v.movie_id) || 0) + 1));
    return counts;
  },

  async deleteVotesForMovie(movieId) {
    const { error } = await supabase
      .from('votes')
      .delete()
      .eq('movie_id', movieId);
    if (error) throw error;
  },

  async upsertRating(userId, movieId, rating, comment = null) {
    const { error } = await supabase
      .from('user_ratings')
      .upsert(
        [{ user_id: userId, movie_id: movieId, rating, comment }],
        { onConflict: 'user_id,movie_id' }
      );

    if (error) throw error;
  }
};

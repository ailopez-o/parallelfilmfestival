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
      .select('movie_id, rating');
    
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

  async upsertRating(userId, movieId, rating) {
    // First check if a rating already exists
    const { data: existing } = await supabase
      .from('user_ratings')
      .select('id')
      .eq('user_id', userId)
      .eq('movie_id', movieId)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('user_ratings')
        .update({ rating })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_ratings')
        .insert([{ user_id: userId, movie_id: movieId, rating }]);
      if (error) throw error;
    }
  }
};

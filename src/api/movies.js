import { supabase } from '../config/supabase.js';

/**
 * Movies API service layer.
 * Handles all database operations related to movies, votes, and ratings.
 */

export async function fetchAllMovies() {
  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function getUserRatings(userId) {
  const { data, error } = await supabase
    .from('user_ratings')
    .select('*')
    .eq('user_id', userId);
  
  if (error) throw error;
  return data || [];
}

export async function getGlobalRatings() {
  const { data, error } = await supabase
    .from('user_ratings')
    .select('movie_id, rating');
  
  if (error) throw error;
  return data || [];
}

export async function updateMovieData(movieId, updates) {
  const { data, error } = await supabase
    .from('movies')
    .update(updates)
    .eq('id', movieId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function createMovie(movieData) {
  const { data, error } = await supabase
    .from('movies')
    .insert([movieData])
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function deleteMovie(movieId) {
  const { error } = await supabase
    .from('movies')
    .delete()
    .eq('id', movieId);
  
  if (error) throw error;
}

export async function addVote(userId, movieId) {
  const { error } = await supabase
    .from('votes')
    .insert([{ user_id: userId, movie_id: movieId }]);
  
  if (error) throw error;
}

export async function removeVote(userId, movieId) {
  const { error } = await supabase
    .from('votes')
    .delete()
    .eq('user_id', userId)
    .eq('movie_id', movieId);
  
  if (error) throw error;
}

export async function upsertRating(userId, movieId, rating) {
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

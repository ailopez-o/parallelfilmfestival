import { supabase } from '../config/supabase.js';

/**
 * Authentication service layer.
 * Handles all interactions with Supabase Auth and User Profiles.
 */

export async function getCurrentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function signInWithEmail(email, password) {
  return await supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email, password) {
  return await supabase.auth.signUp({ email, password });
}

export async function signOut() {
  return await supabase.auth.signOut();
}

export async function signInWithGoogle() {
  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
}

export async function getUserProfile(userId) {
  return await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
}

export async function createUserProfile(userId, email, fullName) {
  const defaultName = fullName || email.split('@')[0];
  return await supabase
    .from('profiles')
    .insert([{
      id: userId,
      full_name: defaultName,
      role: 'user'
    }])
    .select()
    .single();
}

export async function getUserVotes(userId) {
  return await supabase
    .from('votes')
    .select('movie_id')
    .eq('user_id', userId);
}

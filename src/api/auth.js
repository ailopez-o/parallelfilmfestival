import { supabase } from '../config/supabase.js';

/**
 * Authentication service layer.
 * Handles all interactions with Supabase Auth and User Profiles.
 */

export const AuthService = {
  async getCurrentSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async signInWithEmail(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
  },

  async signUpWithEmail(email, password) {
    return await supabase.auth.signUp({ email, password });
  },

  async signOut() {
    return await supabase.auth.signOut();
  },

  async signInWithGoogle() {
    return await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  },

  async getUserProfile(userId) {
    return await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
  },

  async createUserProfile(userId, email, fullName) {
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
  },

  async getUserVotes(userId) {
    return await supabase
      .from('votes')
      .select('movie_id')
      .eq('user_id', userId);
  }
};


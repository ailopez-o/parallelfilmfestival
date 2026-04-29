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
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  },

  async createUserProfile(userId, email, fullName) {
    const defaultName = fullName || email.split('@')[0];
    const { data, error } = await supabase
      .from('profiles')
      .insert([{
        id: userId,
        full_name: defaultName,
        email,
        role: 'user'
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateUserProfileName(userId, email, fullName) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, email })
      .eq('id', userId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getOrCreateUserProfile(user, displayName) {
    try {
      const profile = await this.getUserProfile(user.id);

      if (profile?.full_name === null) {
        return await this.updateUserProfileName(user.id, user.email, displayName);
      }

      return profile;
    } catch (error) {
      if (error.code !== 'PGRST116') throw error;
      return await this.createUserProfile(user.id, user.email, displayName);
    }
  },

  async getUserVotes(userId) {
    return await supabase
      .from('votes')
      .select('movie_id')
      .eq('user_id', userId);
  }
};

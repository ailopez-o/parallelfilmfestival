import { supabase } from '../config/supabase.js';

/**
 * Session Service.
 * Manages fetching and participation for cinema sessions.
 */
export const SessionService = {
  /**
   * Fetches all cinema sessions with movies and signups.
   */
  async fetchAll() {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, movies(*), session_signups(user_id, profiles(full_name))')
      .order('session_date', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Fetches detailed data for a specific session (comments, photos, participants).
   */
  async fetchDetails(sessionId) {
    const [comments, photos, signups, attendance] = await Promise.all([
      supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', sessionId).order('created_at', { ascending: false }),
      supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', sessionId).order('created_at', { ascending: false }),
      supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId),
      supabase.from('session_attendance').select('*, profiles(full_name, id)').eq('session_id', sessionId)
    ]);

    return {
      comments: comments.data || [],
      photos: photos.data || [],
      signups: signups.data || [],
      attendance: attendance.data || []
    };
  },

  /**
   * Toggles session signup for a user.
   */
  async toggleSignup(sessionId, userId) {
    const { data: existing } = await supabase
      .from('session_signups')
      .select('*')
      .match({ session_id: sessionId, user_id: userId })
      .single();

    if (existing) {
      const { error } = await supabase.from('session_signups').delete().match({ session_id: sessionId, user_id: userId });
      if (error) throw error;
      return { action: 'removed' };
    } else {
      const { error } = await supabase.from('session_signups').insert([{ session_id: sessionId, user_id: userId }]);
      if (error) throw error;
      return { action: 'added' };
    }
  },

  /**
   * Adds a comment to a session.
   */
  async addComment(sessionId, userId, content) {
    const { error } = await supabase.from('session_comments').insert([{
      session_id: sessionId,
      user_id: userId,
      content: content
    }]);
    if (error) throw error;
  },

  /**
   * Adds a photo URL to a session gallery.
   */
  async addPhoto(sessionId, userId, url) {
    const { error } = await supabase.from('session_photos').insert([{
      session_id: sessionId,
      user_id: userId,
      photo_url: url
    }]);
    if (error) throw error;
  }
};

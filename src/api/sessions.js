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
   * Fetches a single session by ID.
   */
  async fetchSessionById(sessionId) {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, movies(*), session_signups(user_id, profiles(full_name))')
      .eq('id', sessionId)
      .single();

    if (error) throw error;
    return data;
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
  },

  /**
   * Toggles session attendance for a user (Admin only).
   */
  async toggleAttendance(sessionId, userId) {
    const { data: existing } = await supabase
      .from('session_attendance')
      .select('*')
      .match({ session_id: sessionId, user_id: userId })
      .single();

    if (existing) {
      const { error } = await supabase.from('session_attendance').delete().match({ session_id: sessionId, user_id: userId });
      if (error) throw error;
      return { action: 'removed' };
    } else {
      const { error } = await supabase.from('session_attendance').insert([{ session_id: sessionId, user_id: userId }]);
      if (error) throw error;
      return { action: 'added' };
    }
  },

  /**
   * Creates a new session (Admin only).
   */
  async createSession(sessionData) {
    const { error } = await supabase.from('sessions').insert([sessionData]);
    if (error) throw error;
  },

  /**
   * Updates an existing session (Admin only).
   */
  async updateSession(sessionId, updates) {
    const { error } = await supabase.from('sessions').update(updates).eq('id', sessionId);
    if (error) throw error;
  },

  /**
   * Deletes a session (Admin only).
   */
  async deleteSession(sessionId) {
    const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
    if (error) throw error;
  },

  /**
   * Uploads a photo to Supabase Storage and adds it to the session gallery.
   */
  async uploadSessionPhoto(sessionId, userId, file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${sessionId}/${userId}_${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${fileName}`;

    // 1. Upload to Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('session-photos')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // 2. Get Public URL
    const { data: { publicUrl } } = supabase.storage
      .from('session-photos')
      .getPublicUrl(filePath);

    // 3. Save to Database
    await this.addPhoto(sessionId, userId, publicUrl);

    return { publicUrl };
  },

  /**
   * Deletes a photo from both database and storage.
   */
  async deletePhoto(photoId, photoUrl) {
    // 1. Delete from DB
    const { error: dbError } = await supabase.from('session_photos').delete().eq('id', photoId);
    if (dbError) throw dbError;

    // 2. Try to delete from Storage (extract path from URL)
    try {
      const pathParts = photoUrl.split('/session-photos/');
      if (pathParts.length > 1) {
        const filePath = pathParts[1];
        await supabase.storage.from('session-photos').remove([filePath]);
      }
    } catch (err) {
      console.warn('Could not delete file from storage:', err);
      // We don't throw here to ensure DB deletion is at least successful
    }
  }
};

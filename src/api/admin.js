import { supabase } from '../config/supabase.js';

/**
 * Admin API service.
 * Handles user management, logs, and application settings.
 */
export const AdminService = {
  /**
   * Fetches all registered profiles.
   */
  async fetchAllProfiles() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Deletes a user and all their associated data (cascading).
   */
  async deleteUser(userId) {
    // Note: Supabase should be configured with ON DELETE CASCADE for FKs.
    // If not, manual cleanup might be needed here.
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) throw error;
  },

  /**
   * Fetches participation logs for the admin dashboard.
   */
  async fetchParticipationLogs(limit = 50) {
    const { data, error } = await supabase
      .from('participation_log')
      .select('*, profiles(full_name), movies(title)')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  },

  /**
   * Fetches application settings (limits, etc.)
   */
  async fetchAppSettings() {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (error) throw error;
    
    const settings = {};
    data?.forEach(setting => {
      if (setting.key === 'max_proposals') settings.maxProposals = parseInt(setting.value);
      if (setting.key === 'max_votes') settings.maxVotes = parseInt(setting.value);
    });
    return settings;
  }
};

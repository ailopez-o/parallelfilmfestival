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
   * Deletes a user and all their associated data explicitly.
   */
  async deleteUser(userId) {
    await supabase.from('votes').delete().eq('user_id', userId);
    await supabase.from('user_ratings').delete().eq('user_id', userId);
    await supabase.from('participation_log').delete().eq('user_id', userId);
    await supabase.from('session_signups').delete().eq('user_id', userId);
    await supabase.from('session_attendance').delete().eq('user_id', userId);
    await supabase.from('movies').delete().eq('proposed_by', userId);
    
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
   * Logs a user participation event (like attendance, proposals, voting).
   */
  async logParticipation(userId, actionType, movieId = null) {
    const logData = { user_id: userId, action_type: actionType };
    if (movieId) logData.movie_id = movieId;
    const { error } = await supabase.from('participation_log').insert([logData]);
    if (error) throw error;
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
  },
  
  /**
   * Updates multiple application settings.
   */
  async updateAppSettings(newMaxProposals, newMaxVotes) {
    await Promise.all([
      supabase.from('app_settings').update({ value: newMaxProposals.toString() }).eq('key', 'max_proposals'),
      supabase.from('app_settings').update({ value: newMaxVotes.toString() }).eq('key', 'max_votes')
    ]);
  },
  
  /**
   * Cleans up movies that have been inactive for more than 15 days.
   */
  async cleanupInactiveMovies() {
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
    
    const { data: moviesToClean, error: fetchErr } = await supabase
      .from('movies')
      .select('id, title, created_at, vote_count, is_dropped, is_seen')
      .eq('is_dropped', false)
      .eq('is_seen', false);
      
    if (fetchErr || !moviesToClean) throw fetchErr || new Error('No movies found');

    const { data: allVotes, error: votesErr } = await supabase
      .from('votes')
      .select('movie_id, created_at');
      
    if (votesErr) throw votesErr;

    const toDrop = moviesToClean.filter(m => {
      const proposalDate = new Date(m.created_at);
      const movieVotes = (allVotes || []).filter(v => v.movie_id === m.id);
      if (movieVotes.length === 0) {
        return proposalDate < fifteenDaysAgo;
      } else {
        const lastVoteDate = new Date(Math.max(...movieVotes.map(v => new Date(v.created_at))));
        return lastVoteDate < fifteenDaysAgo;
      }
    });

    if (toDrop.length === 0) {
      return { cleanedCount: 0 };
    }

    const ids = toDrop.map(m => m.id);
    const { error: updateErr } = await supabase
      .from('movies')
      .update({ is_dropped: true })
      .in('id', ids);

    if (updateErr) throw updateErr;
    
    return { cleanedCount: toDrop.length };
  }
};

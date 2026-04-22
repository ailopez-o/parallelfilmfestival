import { supabase } from '../config/supabase.js';
import { ACHIEVEMENT_LIST } from '../config/constants.js';

/**
 * Achievement Service.
 * Manages calculations and fetching for user and global achievements.
 */
export const AchievementService = {
  /**
   * Calculates achievement progress for a specific user.
   */
  async calculateUserAchievements(userId, allSessions = []) {
    if (!userId) return ACHIEVEMENT_LIST.map(a => ({ ...a, progress: 0, current: 0, completed: false }));

    try {
      const [ratingsRes, attendanceRes, visionaryRes] = await Promise.all([
        supabase.from('user_ratings').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('participation_log').select('movie_id').eq('user_id', userId).eq('action_type', 'attendance'),
        supabase.from('movies').select('*', { count: 'exact', head: true }).eq('proposed_by', userId).eq('is_seen', true)
      ]);

      const ratingsCount = ratingsRes.count || 0;
      const attendanceLogs = attendanceRes.data || [];
      const attendanceCount = attendanceLogs.length || 0;
      const attendedMovieIds = new Set(attendanceLogs.map(l => l.movie_id));
      const seenCount = visionaryRes.count || 0;

      // 4. Attendance Streak Logic: Find the longest sequence of attended sessions
      let maxStreak = 0;
      let currentStreak = 0;
      if (allSessions.length > 0) {
        allSessions.forEach(s => {
          if (attendedMovieIds.has(s.id)) {
            currentStreak++;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
          } else {
            currentStreak = 0;
          }
        });
      }

      return ACHIEVEMENT_LIST.map(achievement => {
        let current = 0;
        let completed = false;

        if (achievement.type === 'static') {
          current = 1;
          completed = true;
        } else if (achievement.type === 'ratings') {
          current = ratingsCount;
          completed = current >= achievement.target;
        } else if (achievement.type === 'attendance') {
          current = attendanceCount;
          completed = current >= achievement.target;
        } else if (achievement.type === 'streak') {
          current = maxStreak;
          completed = current >= achievement.target;
        } else if (achievement.type === 'visionary') {
          current = seenCount;
          completed = current >= achievement.target;
        }

        const progress = Math.min(100, (current / achievement.target) * 100);
        if (completed) current = achievement.target;

        return { ...achievement, current, completed, progress };
      });
    } catch (e) {
      console.error('Error calculating achievements:', e);
      return ACHIEVEMENT_LIST.map(a => ({ ...a, progress: 0, current: 0, completed: false }));
    }
  },

  /**
   * Calculates global achievement statistics for the community.
   */
  async calculateGlobalStats(proposedMovies = []) {
    const stats = { miembro: 0, feroz: 0, oro: 0, trend: 0, streak: 0, debut: 0, regular: 0, legend: 0 };
    try {
      const [profilesRes, ratingsRes, attendanceRes] = await Promise.all([
        supabase.from('profiles').select('id'),
        supabase.from('user_ratings').select('user_id'),
        supabase.from('participation_log').select('user_id').eq('action_type', 'attendance')
      ]);

      stats.miembro = profilesRes.data?.length || 0;

      const ratingsMap = {};
      ratingsRes.data?.forEach(r => { ratingsMap[r.user_id] = (ratingsMap[r.user_id] || 0) + 1; });
      Object.values(ratingsMap).forEach(count => {
        if (count >= 5) stats.feroz++;
        if (count >= 10) stats.oro++;
      });

      const top3Movies = [...proposedMovies].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 3);
      stats.trend = new Set(top3Movies.map(m => m.proposed_by)).size;

      const attMap = {};
      attendanceRes.data?.forEach(a => { attMap[a.user_id] = (attMap[a.user_id] || 0) + 1; });
      Object.values(attMap).forEach(count => {
        if (count >= 1) stats.debut++;
        if (count >= 3) stats.regular++;
        if (count >= 5) stats.legend++;
      });
    } catch (e) {
      console.error('Error calculating global stats:', e);
    }
    return stats;
  },

  /**
   * Fetches recent achievement events for the timeline.
   */
  async fetchRecentEvents() {
    try {
      const [profiles, allRatings, allAttendance, allMovies, allSessions] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, created_at').order('created_at', { ascending: false }).limit(20),
        supabase.from('user_ratings').select('user_id, created_at, movie_id'),
        supabase.from('participation_log').select('user_id, created_at, action_type, movie_id'),
        supabase.from('movies').select('id, proposed_by, is_seen, created_at'),
        supabase.from('sessions').select('id, session_date').order('session_date', { ascending: true })
      ]);

      if (profiles.error) throw profiles.error;

      const events = [];
      
      // 1. Join Events
      profiles.data?.forEach(p => {
        events.push({
          type: 'miembro', icon: 'user-check', userId: p.id,
          name: p.full_name || p.email.split('@')[0],
          date: new Date(p.created_at),
          text: 'earned the <span class="event-medal-name">Festival Member</span> medal'
        });
      });

      // 2. Ratings Milestones
      const ratingStats = {};
      (allRatings.data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(r => {
        if (!ratingStats[r.user_id]) ratingStats[r.user_id] = new Set();
        ratingStats[r.user_id].add(r.movie_id);
        const count = ratingStats[r.user_id].size;
        if (count === 1 || count === 5 || count === 10) {
          const medal = count === 10 ? 'Golden Cinephile' : (count === 1 ? 'First Critic' : 'Fierce Critic');
          events.push({
            type: count === 10 ? 'oro' : 'feroz',
            icon: count === 10 ? 'award' : (count === 1 ? 'star' : 'clapperboard'),
            userId: r.user_id, date: new Date(r.created_at),
            text: `earned the <span class="event-medal-name">${medal}</span> medal`
          });
        }
      });

      // 3. Attendance Milestones
      const attendanceStats = {};
      (allAttendance.data || []).filter(a => a.action_type === 'attendance')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(a => {
        attendanceStats[a.user_id] = (attendanceStats[a.user_id] || 0) + 1;
        const count = attendanceStats[a.user_id];
        if ([1, 3, 5].includes(count)) {
          const medal = count === 1 ? 'Grand Premiere' : (count === 3 ? 'Festival Regular' : 'Cinema Legend');
          events.push({
            type: 'asistencia', icon: count === 1 ? 'ticket' : (count === 3 ? 'calendar' : 'crown'),
            userId: a.user_id, date: new Date(a.created_at),
            text: `earned the <span class="event-medal-name">${medal}</span> medal`
          });
        }
      });

      // 4. Streak Milestones
      const userAttMap = {};
      (allAttendance.data || []).filter(a => a.action_type === 'attendance').forEach(log => {
        if (!userAttMap[log.user_id]) userAttMap[log.user_id] = new Set();
        userAttMap[log.user_id].add(log.movie_id);
      });

      profiles.data?.forEach(u => {
        let streak = 0;
        allSessions.data?.forEach(s => {
          if (userAttMap[u.id]?.has(s.id)) {
            streak++;
            if ([3, 5].includes(streak)) {
              events.push({
                type: 'streak', icon: streak === 5 ? 'zap' : 'flame', userId: u.id,
                date: new Date(s.session_date),
                text: `earned the <span class="event-medal-name">${streak === 5 ? 'Infinite Streak (5x)' : 'Iron Streak (3x)'}</span> medal`
              });
            }
          } else streak = 0;
        });
      });

      // 5. Visionary Milestones
      const visStats = {};
      (allMovies.data || []).filter(m => m.is_seen).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(m => {
        visStats[m.proposed_by] = (visStats[m.proposed_by] || 0) + 1;
        if ([1, 3].includes(visStats[m.proposed_by])) {
          events.push({
            type: 'visionary', icon: visStats[m.proposed_by] === 3 ? 'sparkles' : 'eye', userId: m.proposed_by,
            date: new Date(m.created_at),
            text: `earned the <span class="event-medal-name">${visStats[m.proposed_by] === 3 ? 'The Oracle' : 'The Visionary'}</span> medal`
          });
        }
      });

      return events;
    } catch (e) {
      console.error('Error fetching achievement events:', e);
      return [];
    }
  }
};

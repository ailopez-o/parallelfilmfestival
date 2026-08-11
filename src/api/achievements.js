import { supabase } from '../config/supabase.js';
import { ACHIEVEMENT_LIST } from '../config/constants.js';
import { getUserDisplayName } from '../utils/user.js';

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
      const [ratingsRes, tableRes, visionaryRes] = await Promise.all([
        supabase.from('user_ratings').select('*', { count: 'exact', head: true }).eq('user_id', userId),
        supabase.from('session_attendance').select('session_id').eq('user_id', userId),
        supabase.from('movies').select('*', { count: 'exact', head: true }).eq('proposed_by', userId).eq('is_seen', true)
      ]);

      const ratingsCount = ratingsRes.count || 0;
      
      // session_attendance is the source of truth
      const attendedSessionIds = new Set(
        (tableRes.data || []).map(a => a.session_id).filter(Boolean)
      );
      
      const attendanceCount = attendedSessionIds.size;
      const seenCount = visionaryRes.count || 0;

      // Attendance streaks must follow the chronological order of actual sessions.
      let maxStreak = 0;
      let currentStreak = 0;
      if (allSessions.length > 0) {
        const sortedSessions = [...allSessions]
          .filter(session => session?.id && session?.session_date)
          .sort((a, b) => new Date(a.session_date) - new Date(b.session_date));

        sortedSessions.forEach(s => {
          if (attendedSessionIds.has(s.id)) {
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
  async calculateGlobalStats(allMovies = []) {
    const stats = {
      miembro: 0,
      visionary: 0,
      oracle: 0,
      debut: 0,
      regular: 0,
      legend: 0,
      first_critic: 0,
      feroz: 0,
      oro: 0,
      streak3: 0,
      streak5: 0
    };
    try {
      const [profilesRes, ratingsRes, attendanceRes, sessionsRes] = await Promise.all([
        supabase.from('profiles').select('id'),
        supabase.from('user_ratings').select('user_id'),
        supabase.from('session_attendance').select('user_id, session_id'),
        supabase.from('sessions').select('id, session_date').order('session_date', { ascending: true })
      ]);

      stats.miembro = profilesRes.data?.length || 0;

      const ratingsMap = {};
      ratingsRes.data?.forEach(r => { ratingsMap[r.user_id] = (ratingsMap[r.user_id] || 0) + 1; });
      Object.values(ratingsMap).forEach(count => {
        if (count >= 1) stats.first_critic++;
        if (count >= 5) stats.feroz++;
        if (count >= 10) stats.oro++;
      });

      const attMap = {};
      attendanceRes.data?.forEach(a => { 
        if (!attMap[a.user_id]) attMap[a.user_id] = new Set();
        if (a.session_id) attMap[a.user_id].add(a.session_id);
      });
      Object.values(attMap).forEach(sessionSet => {
        const count = sessionSet.size;
        if (count >= 1) stats.debut++;
        if (count >= 3) stats.regular++;
        if (count >= 5) stats.legend++;
      });

      const orderedSessions = sessionsRes.data || [];
      Object.values(attMap).forEach(sessionSet => {
        let currentStreak = 0;
        let maxStreak = 0;

        orderedSessions.forEach(session => {
          if (sessionSet.has(session.id)) {
            currentStreak++;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
          } else {
            currentStreak = 0;
          }
        });

        if (maxStreak >= 3) stats.streak3++;
        if (maxStreak >= 5) stats.streak5++;
      });

      // Visionary / Oracle stats
      const visMap = {};
      allMovies.filter(m => m.is_seen).forEach(m => {
        if (!m.proposed_by) return;
        visMap[m.proposed_by] = (visMap[m.proposed_by] || 0) + 1;
      });
      Object.values(visMap).forEach(count => {
        if (count >= 1) stats.visionary++;
        if (count >= 3) stats.oracle++;
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
      const [profiles, allRatings, allAttendance, allMovies, allSessions, allAttendanceTable] = await Promise.all([
        supabase.from('profiles').select('id, full_name, email, created_at').order('created_at', { ascending: false }),
        supabase.from('user_ratings').select('user_id, created_at, movie_id'),
        supabase.from('participation_log').select('user_id, created_at, action_type, movie_id'),
        supabase.from('movies').select('id, proposed_by, is_seen, created_at'),
        supabase.from('sessions').select('id, session_date, movie_id').order('session_date', { ascending: true }),
        supabase.from('session_attendance').select('user_id, session_id, sessions(movie_id, session_date)')
      ]);

      if (profiles.error) throw profiles.error;

      const activeUsersMap = new Map();
      profiles.data?.forEach(p => activeUsersMap.set(p.id, getUserDisplayName(p)));

      const events = [];
      
      // 1. Join Events (Only top 5 most recent to avoid spam)
      profiles.data?.slice(0, 5).forEach(p => {
        events.push({
          type: 'miembro', icon: 'user-check', userId: p.id,
          name: activeUsersMap.get(p.id),
          date: new Date(p.created_at),
          text: 'earned the <span class="event-medal-name">Festival Member</span> medal'
        });
      });

      // Helper to safely add events only for active users
      const pushEvent = (userId, date, type, icon, medal) => {
        if (!activeUsersMap.has(userId)) return; // Filter out deleted/ghost users
        events.push({
          type, icon, userId, date, name: activeUsersMap.get(userId),
          text: `earned the <span class="event-medal-name">${medal}</span> medal`
        });
      };

      // 2. Ratings Milestones
      const ratingStats = {};
      (allRatings.data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(r => {
        if (!ratingStats[r.user_id]) ratingStats[r.user_id] = new Set();
        ratingStats[r.user_id].add(r.movie_id);
        const count = ratingStats[r.user_id].size;
        if (count === 1 || count === 5 || count === 10) {
          const medal = count === 10 ? 'Golden Cinephile' : (count === 1 ? 'First Critic' : 'Fierce Critic');
          pushEvent(r.user_id, new Date(r.created_at), count === 10 ? 'oro' : 'feroz', count === 10 ? 'award' : (count === 1 ? 'star' : 'clapperboard'), medal);
        }
      });

      // 3. Attendance Milestones (Source of Truth: session_attendance + logs)
      const attendanceStats = {};
      const processedAttendanceKeys = new Set();
      
      // First, process official session_attendance (Authority)
      (allAttendanceTable?.data || []).forEach(a => {
        const movieId = a.sessions?.movie_id;
        const date = a.sessions?.session_date ? new Date(a.sessions.session_date) : new Date();
        if (!movieId) return;
        
        if (!attendanceStats[a.user_id]) attendanceStats[a.user_id] = new Set();
        attendanceStats[a.user_id].add(movieId);
        const count = attendanceStats[a.user_id].size;
        processedAttendanceKeys.add(`${a.user_id}_${movieId}`);
        
        if ([1, 3, 5].includes(count)) {
          const medal = count === 1 ? 'Grand Premiere' : (count === 3 ? 'Festival Regular' : 'Cinema Legend');
          pushEvent(a.user_id, date, 'asistencia', count === 1 ? 'ticket' : (count === 3 ? 'calendar' : 'crown'), medal);
        }
      });

      // Second, process logs (for historical ones that might not be in session_attendance)
      (allAttendance.data || []).filter(a => a.action_type === 'attendance')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(a => {
        if (processedAttendanceKeys.has(`${a.user_id}_${a.movie_id}`)) return;
        
        if (!attendanceStats[a.user_id]) attendanceStats[a.user_id] = new Set();
        attendanceStats[a.user_id].add(a.movie_id);
        const count = attendanceStats[a.user_id].size;
        
        if ([1, 3, 5].includes(count)) {
          const medal = count === 1 ? 'Grand Premiere' : (count === 3 ? 'Festival Regular' : 'Cinema Legend');
          pushEvent(a.user_id, new Date(a.created_at), 'asistencia', count === 1 ? 'ticket' : (count === 3 ? 'calendar' : 'crown'), medal);
        }
      });

      // 4. Streak Milestones
      const userAttMap = {};
      (allAttendanceTable.data || []).forEach(entry => {
        if (!userAttMap[entry.user_id]) userAttMap[entry.user_id] = new Set();
        if (entry.session_id) userAttMap[entry.user_id].add(entry.session_id);
      });

      profiles.data?.forEach(u => {
        let streak = 0;
        allSessions.data?.forEach(s => {
          if (userAttMap[u.id]?.has(s.id)) {
            streak++;
            if ([3, 5].includes(streak)) {
              pushEvent(u.id, new Date(s.session_date), 'streak', streak === 5 ? 'zap' : 'flame', streak === 5 ? 'Infinite Streak (5x)' : 'Iron Streak (3x)');
            }
          } else streak = 0;
        });
      });

      // 5. Visionary Milestones
      const visStats = {};
      const movieSessionMap = {};
      (allSessions.data || []).forEach(s => {
        if (s.movie_id) movieSessionMap[s.movie_id] = s.session_date;
      });

      (allMovies.data || []).filter(m => m.is_seen).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).forEach(m => {
        visStats[m.proposed_by] = (visStats[m.proposed_by] || 0) + 1;
        if ([1, 3].includes(visStats[m.proposed_by])) {
          // Use session date if available, else fallback to creation date
          const eventDate = movieSessionMap[m.id] ? new Date(movieSessionMap[m.id]) : new Date(m.created_at);
          pushEvent(m.proposed_by, eventDate, 'visionary', visStats[m.proposed_by] === 3 ? 'sparkles' : 'eye', visStats[m.proposed_by] === 3 ? 'The Oracle' : 'The Visionary');
        }
      });
      
      // Sort all events by date descending (most recent first)
      return events.sort((a, b) => (b.date || 0) - (a.date || 0));
    } catch (e) {
      console.error('Error fetching achievement events:', e);
      return [];
    }
  }
};

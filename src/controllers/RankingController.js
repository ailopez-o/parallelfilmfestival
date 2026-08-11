import { supabase } from '../config/supabase.js';
import { ACHIEVEMENT_LIST, PARTICIPATION_POINTS } from '../config/constants.js';
import { store } from '../state/store.js';
import { AdminView } from '../views/index.js';

export function getMaxAttendanceStreak(attendedSessionIds, sessionsList) {
  let maxStreak = 0;
  let currentStreak = 0;
  const sortedSessions = [...(sessionsList || [])]
    .filter(s => s?.id && s?.session_date)
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  sortedSessions.forEach(session => {
    if (attendedSessionIds.has(session.id)) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  });
  return maxStreak;
}


export function getAchievementBreakdownForUser(stats, sessionsList) {
  const attendanceCount = stats.attendedSessionIds.size;
  const ratingsCount = stats.ratedMovieIds.size;
  const streak = getMaxAttendanceStreak(stats.attendedSessionIds, sessionsList);
  return ACHIEVEMENT_LIST.filter(achievement => {
    if (achievement.type === 'static') return true;
    if (achievement.type === 'ratings') return ratingsCount >= achievement.target;
    if (achievement.type === 'attendance') return attendanceCount >= achievement.target;
    if (achievement.type === 'visionary') return stats.seenProposals >= achievement.target;
    if (achievement.type === 'streak') return streak >= achievement.target;
    return false;
  }).map(achievement => ({ ...achievement, reason: achievement.desc }));
}

export function createEmptyScoreStats() {
  return {
    activeVotes: 0, activeProposals: 0, cemeteryProposals: 0, seenProposals: 0,
    ratedMovieIds: new Set(), attendedSessionIds: new Set(),
    activeVoteMovieIds: new Set(), activeProposalMovieIds: new Set(),
    cemeteryProposalMovieIds: new Set(),
    achievementPoints: 0, achievementBreakdown: [], totalScore: 0
  };
}

export function buildUserScoreStatsMap(profiles, votes, allMoviesList, ratings, attendance, orderedSessions, signups) {
  const userStats = {};
  (profiles || []).forEach(profile => { userStats[profile.id] = createEmptyScoreStats(); });

  (votes || []).forEach(vote => {
    const stats = userStats[vote.user_id];
    if (!stats || vote.movies?.is_dropped) return;
    stats.activeVotes += 1;
    if (vote.movie_id) stats.activeVoteMovieIds.add(vote.movie_id);
  });

  (allMoviesList || []).forEach(movie => {
    const stats = userStats[movie.proposed_by];
    if (!stats) return;
    if (movie.is_dropped) {
      stats.cemeteryProposals += 1;
      stats.cemeteryProposalMovieIds.add(movie.id);
      return;
    }
    stats.activeProposals += 1;
    stats.activeProposalMovieIds.add(movie.id);
    if (movie.is_seen) stats.seenProposals += 1;
  });

  (ratings || []).forEach(rating => {
    const stats = userStats[rating.user_id];
    if (stats && rating.movie_id) stats.ratedMovieIds.add(rating.movie_id);
  });

  const signupSet = {};
  (signups || []).forEach(s => {
    if (!signupSet[s.user_id]) signupSet[s.user_id] = new Set();
    signupSet[s.user_id].add(s.session_id);
  });

  (attendance || []).forEach(entry => {
    const stats = userStats[entry.user_id];
    if (stats && entry.session_id && signupSet[entry.user_id]?.has(entry.session_id)) {
      stats.attendedSessionIds.add(entry.session_id);
    }
  });

  (profiles || []).forEach(profile => {
    const stats = userStats[profile.id];
    if (!stats) return;
    stats.achievementBreakdown = getAchievementBreakdownForUser(stats, orderedSessions);
    stats.achievementPoints = stats.achievementBreakdown.reduce((sum, a) => sum + (a.points || 0), 0);
    stats.totalScore =
      (stats.activeProposals * PARTICIPATION_POINTS.proposalActive) +
      (stats.cemeteryProposals * PARTICIPATION_POINTS.proposalCemetery) +
      (stats.activeVotes * PARTICIPATION_POINTS.voteActive) +
      (stats.ratedMovieIds.size * PARTICIPATION_POINTS.review) +
      (stats.attendedSessionIds.size * PARTICIPATION_POINTS.attendance) +
      stats.achievementPoints;
  });
  return userStats;
}

export function buildUserPointsAudit(profile, stats, context = {}) {
  const moviesById = new Map((context.movies || []).map(m => [m.id, m]));
  const voteTitleMap = new Map((context.votes || []).map(v => [v.movie_id, v.movies]));
  const ratingTitleMap = new Map((context.ratings || []).map(r => [r.movie_id, r.movies]));
  const sessionEntries = context.attendanceEntries || [];

  const movieTitleForId = (movieId) => {
    const movie = moviesById.get(movieId) || voteTitleMap.get(movieId) || ratingTitleMap.get(movieId);
    return movie?.title || 'Untitled movie';
  };

  const attendanceDetails = sessionEntries.map(entry => {
    const title = entry.sessions?.movies?.title || 'Session';
    const date = entry.sessions?.session_date
      ? new Date(entry.sessions.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    return date ? `${title} (${date})` : title;
  }).filter(Boolean);

  const lines = [
    { label: 'Valid Proposals', count: stats.activeProposals, unitPoints: PARTICIPATION_POINTS.proposalActive, totalPoints: stats.activeProposals * PARTICIPATION_POINTS.proposalActive, details: Array.from(stats.activeProposalMovieIds).map(movieTitleForId) },
    { label: 'Cemetery Proposals', count: stats.cemeteryProposals, unitPoints: PARTICIPATION_POINTS.proposalCemetery, totalPoints: stats.cemeteryProposals * PARTICIPATION_POINTS.proposalCemetery, details: Array.from(stats.cemeteryProposalMovieIds).map(movieTitleForId) },
    { label: 'Active Votes', count: stats.activeVotes, unitPoints: PARTICIPATION_POINTS.voteActive, totalPoints: stats.activeVotes * PARTICIPATION_POINTS.voteActive, details: Array.from(stats.activeVoteMovieIds).map(movieTitleForId) },
    { label: 'Reviews', count: stats.ratedMovieIds.size, unitPoints: PARTICIPATION_POINTS.review, totalPoints: stats.ratedMovieIds.size * PARTICIPATION_POINTS.review, details: Array.from(stats.ratedMovieIds).map(movieTitleForId) },
    { label: 'Attendance', count: stats.attendedSessionIds.size, unitPoints: PARTICIPATION_POINTS.attendance, totalPoints: stats.attendedSessionIds.size * PARTICIPATION_POINTS.attendance, details: attendanceDetails },
  ];

  return {
    userId: profile.id,
    totalScore: stats.totalScore,
    basePoints: lines.reduce((sum, line) => sum + line.totalPoints, 0),
    achievementPoints: stats.achievementPoints,
    achievements: stats.achievementBreakdown,
    lines
  };
}

export async function updateGlobalRanking() {
  try {
    const [profilesRes, votesRes, moviesRes, ratingsRes, attendanceRes, sessionsRes, signupsRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('votes').select('user_id, movie_id, movies(is_dropped)'),
      supabase.from('movies').select('id, proposed_by, is_dropped, is_seen'),
      supabase.from('user_ratings').select('user_id, movie_id'),
      supabase.from('session_attendance').select('user_id, session_id'),
      supabase.from('sessions').select('id, session_date, movie_id, movies(title)'),
      supabase.from('session_signups').select('user_id, session_id')
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (votesRes.error) throw votesRes.error;
    if (moviesRes.error) throw moviesRes.error;
    if (ratingsRes.error) throw ratingsRes.error;
    if (attendanceRes.error) throw attendanceRes.error;
    if (sessionsRes.error) throw sessionsRes.error;

    const profiles = (profilesRes.data || []).filter(p => p.role !== 'admin');
    const userStats = buildUserScoreStatsMap(
      profiles, votesRes.data || [], moviesRes.data || [],
      ratingsRes.data || [], attendanceRes.data || [], sessionsRes.data || [], signupsRes.data || []
    );

    profiles.forEach(p => { p.score = userStats[p.id]?.totalScore || 0; });
    profiles.sort((a, b) => b.score - a.score);
    profiles.forEach((p, idx) => { p.rank = idx + 1; });

    store.setState({ rankedUsers: profiles });

    const { user, userProfile } = store.getState();
    if (user && userProfile) {
      const me = profiles.find(u => u.id === user.id);
      if (me) {
        store.setState({ userProfile: { ...userProfile, rank: me.rank, score: me.score } });
        window.dispatchEvent(new CustomEvent('authui:update'));
      }
    }

    renderRankingView();
  } catch (err) {
    console.error('Error updating global ranking:', err);
  }
}

export function renderRankingView() {
  const { rankedUsers } = store.getState();
  const rankingList = document.getElementById('rankingList');
  AdminView.renderRankingView(rankedUsers, rankingList);
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  // No window.* handlers needed for ranking
}

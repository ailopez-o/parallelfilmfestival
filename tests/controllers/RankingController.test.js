import { describe, it, expect } from 'vitest';
import {
  getMaxAttendanceStreak,
  getAchievementBreakdownForUser,
  buildUserScoreStatsMap,
  createEmptyScoreStats,
} from '../../src/controllers/RankingController.js';

describe('getMaxAttendanceStreak', () => {
  it('returns 0 for empty attendance', () => {
    expect(getMaxAttendanceStreak(new Set(), [])).toBe(0);
  });

  it('returns correct streak for all sessions attended', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { id: 'b', session_date: '2024-02-01' },
      { id: 'c', session_date: '2024-03-01' },
    ];
    expect(getMaxAttendanceStreak(new Set(['a', 'b', 'c']), sessions)).toBe(3);
  });

  it('returns the longest run when there are gaps', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { id: 'b', session_date: '2024-02-01' },
      { id: 'c', session_date: '2024-03-01' },
      { id: 'd', session_date: '2024-04-01' },
    ];
    expect(getMaxAttendanceStreak(new Set(['a', 'b', 'd']), sessions)).toBe(2);
  });

  it('ignores sessions without id or date', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { session_date: '2024-02-01' },
      { id: 'c' },
    ];
    expect(getMaxAttendanceStreak(new Set(['a']), sessions)).toBe(1);
  });
});

describe('getAchievementBreakdownForUser', () => {
  it('always includes the static "miembro" achievement', () => {
    const stats = { ...createEmptyScoreStats() };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'miembro')).toBe(true);
  });

  it('includes attendance achievement when threshold is met', () => {
    const stats = { ...createEmptyScoreStats(), attendedSessionIds: new Set(['s1']) };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'debut')).toBe(true);
  });

  it('does not include achievement when threshold is not met', () => {
    const stats = { ...createEmptyScoreStats() };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'debut')).toBe(false);
  });
});

describe('buildUserScoreStatsMap', () => {
  it('returns empty stats for a profile with no activity', () => {
    const profiles = [{ id: 'u1' }];
    const result = buildUserScoreStatsMap(profiles, [], [], [], [], []);
    expect(result['u1'].totalScore).toBeGreaterThanOrEqual(0);
    expect(result['u1'].activeVotes).toBe(0);
  });

  it('counts active votes correctly', () => {
    const profiles = [{ id: 'u1' }];
    const votes = [{ user_id: 'u1', movie_id: 'm1', movies: { is_dropped: false } }];
    const result = buildUserScoreStatsMap(profiles, votes, [], [], [], []);
    expect(result['u1'].activeVotes).toBe(1);
  });

  it('skips votes for dropped movies', () => {
    const profiles = [{ id: 'u1' }];
    const votes = [{ user_id: 'u1', movie_id: 'm1', movies: { is_dropped: true } }];
    const result = buildUserScoreStatsMap(profiles, votes, [], [], [], []);
    expect(result['u1'].activeVotes).toBe(0);
  });
});

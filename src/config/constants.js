/**
 * Global application constants.
 */

// Fallback images for movie posters
export const FALLBACK_IMAGE = 'https://placehold.co/300x450/1a1a1f/94a3b8?text=Cinema+Poster';
export const TBD_POSTER = '/coming-soon.png';

// API Timeouts
export const TMDB_PROXY_TIMEOUT = 12000;

// Core participation scoring rules
export const PARTICIPATION_POINTS = {
  proposalActive: 5,
  proposalCemetery: 1,
  voteActive: 1,
  attendance: 10,
  review: 5
};

// Achievement Definitions
export const ACHIEVEMENT_LIST = [
  {
    id: 'oracle',
    name: 'The Oracle',
    desc: 'You have shaped the festival: 3 of your proposals have been screened!',
    icon: 'sparkles',
    target: 3,
    type: 'visionary',
    class: 'medal-oracle',
    points: 50
  },
  {
    id: 'visionary',
    name: 'The Visionary',
    desc: 'One of your proposed movies has been screened!',
    icon: 'eye',
    target: 1,
    type: 'visionary',
    class: 'medal-visionary',
    points: 20
  },
  {
    id: 'miembro',
    name: 'Festival Member',
    desc: 'You have joined our cinephile community.',
    icon: 'user-check',
    target: 1,
    type: 'static',
    class: 'medal-miembro',
    points: 5
  },
  {
    id: 'debut',
    name: 'Grand Premiere',
    desc: 'You attended your first physical session.',
    icon: 'ticket',
    target: 1,
    type: 'attendance',
    class: 'medal-attendance',
    points: 10
  },
  {
    id: 'regular',
    name: 'Festival Regular',
    desc: 'You have attended 3 physical sessions.',
    icon: 'calendar',
    target: 3,
    type: 'attendance',
    class: 'medal-attendance',
    points: 15
  },
  {
    id: 'legend',
    name: 'Cinema Legend',
    desc: 'You have attended 5 physical sessions.',
    icon: 'crown',
    target: 5,
    type: 'attendance',
    class: 'medal-attendance',
    points: 25
  },
  {
    id: 'first_critic',
    name: 'First Critic',
    desc: 'You have rated your first movie.',
    icon: 'star',
    target: 1,
    type: 'ratings',
    class: 'medal-feroz',
    points: 10
  },
  {
    id: 'feroz',
    name: 'Fierce Critic',
    desc: 'You have rated 5 or more movies.',
    icon: 'clapperboard',
    target: 5,
    type: 'ratings',
    class: 'medal-feroz',
    points: 20
  },
  {
    id: 'oro',
    name: 'Golden Cinephile',
    desc: 'You have rated 10 or more movies.',
    icon: 'award',
    target: 10,
    type: 'ratings',
    class: 'medal-oro',
    points: 30
  },
  {
    id: 'streak3',
    name: 'Iron Streak (3x)',
    desc: 'Attended 3 consecutive sessions without missing any.',
    icon: 'flame',
    target: 3,
    type: 'streak',
    class: 'medal-feroz',
    points: 10
  },
  {
    id: 'streak5',
    name: 'Infinite Streak (5x)',
    desc: 'Attended 5 consecutive sessions without missing any.',
    icon: 'zap',
    target: 5,
    type: 'streak',
    class: 'medal-oro',
    points: 20
  }
];

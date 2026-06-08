import { supabase } from './src/config/supabase.js';
import { normalize, formatScore, timeAgo, showNotification, getUserDisplayName, escapeHtml } from './src/utils/index.js';
import { FALLBACK_IMAGE, TBD_POSTER, ACHIEVEMENT_LIST } from './src/config/constants.js';
import { 
  createMovieCardHTML, 
  createSessionCardHTML, 
  createSessionHeroHTML, 
  createRankingRowHTML, 
  createAchievementCardHTML, 
  createTimelineItemHTML,
  renderAvatarStack
} from './src/components/index.js';
import { HomeView, ProfileView, AdminView, ExploreView, SessionsView } from './src/views/index.js';
import { 
  AuthService, MovieService, TMDBService, 
  AchievementService, SessionService, AdminService 
} from './src/api/index.js';
// Configuration removed (now in src/config/supabase.js)
import { updateGlobalRanking, renderRankingView, buildUserScoreStatsMap, buildUserPointsAudit, createEmptyScoreStats } from './src/controllers/RankingController.js';
import { fetchGenreMap, fetchProvidersMap, fetchExploreResults, fetchAIRecommendations, renderExploreResults, init as initExplore } from './src/controllers/ExploreController.js';
import { fetchAppSettings, loadAppSettings, saveAppSettings, fetchUserList, fetchParticipationLog, init as initAdmin } from './src/controllers/AdminController.js';
import { checkUser, updateAuthUI, loadUserActivity, scheduleAuthStateSync, init as initAuth } from './src/controllers/AuthController.js';
import { fetchSessions, renderSessions, renderNextSessionHero, updateAdminSessions, init as initSessions } from './src/controllers/SessionController.js';
import {
  renderProposals, renderHistory, renderCemetery, renderTopVotedShowcase,
  enrichMovieData, renderHomeAchievements, fetchRecentAchievementEvents,
  handleMovieSearch, init as initMovies
} from './src/controllers/MovieController.js';

// Edge Function Proxy Helper logic is now fully in TMDBService

import { store } from './src/state/store.js';
// This routes all variable reads/writes transparently into the centralized store.
['allMovies', 'proposedMovies', 'seenMovies', 'rankedUsers', 'sessions', 'currentSession', 'currentView', 'genreMap', 'providerMap', 'userAttendance'].forEach(key => {
  Object.defineProperty(window, key, {
    get: () => store.getState()[key],
    set: (v) => store.setState({ [key]: v })
  });
});

['user', 'userProfile', 'isAdmin', 'MAX_PROPOSALS', 'MAX_VOTES'].forEach((key) => {
  Object.defineProperty(window, key, {
    get: () => {
      const state = store.getState();
      if (key === 'MAX_PROPOSALS') return state.maxProposals;
      if (key === 'MAX_VOTES') return state.maxVotes;
      return state[key];
    }
  });
});

Object.defineProperty(window, 'userVotes', {
  get: () => store.getState().userVotes,
  set: (v) => store.setUserVotes(v)
});

function setAuthContext(nextUser, nextUserProfile, nextIsAdmin) {
  store.setState({
    user: nextUser,
    userProfile: nextUserProfile,
    isAdmin: nextIsAdmin
  });
}

const PRELOADER_MIN_VISIBLE_MS = 250;
const PRELOADER_MAX_VISIBLE_MS = 1400;
const PRELOADER_REMOVE_DELAY_MS = 450;

function createPreloaderController() {
  const startedAt = Date.now();
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;

    const preloader = document.getElementById('preloader');
    if (!preloader || preloader.classList.contains('fade-out')) {
      dismissed = true;
      return;
    }

    dismissed = true;
    const elapsed = Date.now() - startedAt;
    const waitMs = Math.max(0, PRELOADER_MIN_VISIBLE_MS - elapsed);

    window.setTimeout(() => {
      preloader.classList.add('fade-out');
      window.setTimeout(() => preloader.remove(), PRELOADER_REMOVE_DELAY_MS);
    }, waitMs);
  };

  const fallbackTimer = window.setTimeout(dismiss, PRELOADER_MAX_VISIBLE_MS);

  return {
    dismiss() {
      window.clearTimeout(fallbackTimer);
      dismiss();
    }
  };
}

function seedInitialLoadingState() {
  if (movieGrid && movieGrid.innerHTML.trim() === '') {
    HomeView.renderMovieGridSkeletons(movieGrid, 4);
  }

  if (historyGrid && historyGrid.innerHTML.trim() === '') {
    HomeView.renderMovieGridSkeletons(historyGrid, 3);
  }

  if (nextSessionHero && nextSessionHero.innerHTML.trim() === '') {
    HomeView.renderNextSessionHeroSkeleton(nextSessionHero);
  }

  if (sessionsGrid && sessionsGrid.innerHTML.trim() === '') {
    SessionsView.renderSkeletons(sessionsGrid, 3);
  }

  const homeAchievementsGrid = document.getElementById('homeAchievementsGrid');
  if (homeAchievementsGrid && homeAchievementsGrid.innerHTML.trim() === '') {
    ProfileView.renderAchievementSkeletons(homeAchievementsGrid, 4);
  }

  const timelineBody = document.getElementById('timelineBody');
  if (timelineBody && timelineBody.innerHTML.trim() === '') {
    HomeView.renderTimelineSkeletons(timelineBody, 5);
  }
}

/**
 * Normalizes strings for robust comparison:
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes diacritics (accents)
 */
// normalize imported from utils

// DOM Elements
const views = {
  home: document.getElementById('homeView'),
  auth: document.getElementById('authView'),
  profile: document.getElementById('profileView'),
  ranking: document.getElementById('rankingView'),
  explore: document.getElementById('exploreView'),
  sessions: document.getElementById('sessionsView')
};
const rankingList = document.getElementById('rankingList');
const movieGrid = document.getElementById('movieGrid');
const historyGrid = document.getElementById('historyGrid');
const adminToggle = document.getElementById('adminToggle');
const searchInput = document.getElementById('movieSearch');
const searchResults = document.getElementById('searchResults');
const userHeader = document.getElementById('userHeader');
const exploreGrid = document.getElementById('exploreGrid');
const exploreGenreSelect = document.getElementById('exploreGenre');
const aiSearchInput = document.getElementById('aiSearchInput');
const aiSearchBtn = document.getElementById('aiSearchBtn');
const exploreSearchBtn = document.getElementById('exploreSearchBtn');
const exploreInputs = [
  document.getElementById('exploreTitle'),
  document.getElementById('exploreDirector'),
  document.getElementById('exploreGenre'),
  document.getElementById('exploreYearFrom'),
  document.getElementById('exploreYearTo'),
  document.getElementById('exploreLimit'),
  document.getElementById('exploreActor'),
  document.getElementById('exploreSort'),
  document.getElementById('exploreProvider')
];
const exploreButtons = [
  document.getElementById('exploreClearBtn'),
  document.getElementById('exploreSearchBtn')
];

// Profile Elements
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profileAvatar = document.getElementById('profileAvatar');
const countProposals = document.getElementById('countProposals');
const countVotes = document.getElementById('countVotes');
const profileActivityGrid = document.getElementById('profileActivityGrid');
const profilePointsAuditSection = document.getElementById('profilePointsAuditSection');
const profilePointsAuditContent = document.getElementById('profilePointsAuditContent');
const profilePointsAuditSubtitle = document.getElementById('profilePointsAuditSubtitle');
const adminDashboard = document.getElementById('adminDashboard');
const adminUserList = document.getElementById('adminUserList');
const adminUserCount = document.getElementById('adminUserCount');
const adminParticipationLog = document.getElementById('adminParticipationLog');
const homeLeaderboard = document.getElementById('homeLeaderboard');
const homeLeaderboardSection = document.getElementById('homeLeaderboardSection');
const nextSessionHero = document.getElementById('nextSessionHero');
const sessionsGrid = document.getElementById('sessionsGrid');
const sessionModal = document.getElementById('sessionModal');
const sessionModalBody = document.getElementById('sessionModalBody');
const createSessionModal = document.getElementById('createSessionModal');
const sessionMovieSelect = document.getElementById('sessionMovieSelect');
const adminSessionsList = document.getElementById('adminSessionsList');

// Profile Edit Elements
const profileDisplay = document.getElementById('profileDisplay');
const profileEditForm = document.getElementById('profileEditForm');
const editName = document.getElementById('editName');
const editAvatar = document.getElementById('editAvatar');

// Fallback images (imported from constants)
// Limits configuration

// Initialization
async function init() {
  initExplore();
  initAdmin();
  initAuth();
  initSessions();
  initMovies();
  const preloader = createPreloaderController();
  seedInitialLoadingState();
  setupEventListeners();
  handleRouting();

  try {
    Promise.allSettled([
      fetchGenreMap(),
      fetchProvidersMap(),
      fetchAppSettings()
    ]);

    await checkUser();

    // Load the first meaningful screen quickly and defer slower enrichments.
    await refreshData({ lazy: true });
    preloader.dismiss();

  } catch (err) {
    console.error('Initialization error:', err);
    preloader.dismiss();
  }
}


async function refreshData(options = {}) {
  const { lazy = false } = options;
  const individualRatingsPromise = user ? MovieService.getUserRatings(user.id) : Promise.resolve([]);
  const allRatingsPromise = MovieService.getGlobalRatings();
  const allProfilesPromise = AdminService.fetchAllProfiles();
  const sessionsTask = fetchSessions()
    .then(() => {
      renderSessions();
      renderNextSessionHero();
      updateAdminSessions();
    })
    .catch((error) => {
      console.error('Error refreshing sessions:', error);
    });

  try {
    allMovies = await MovieService.fetchAllMovies();
  } catch (error) {
    console.error('Error fetching movies:', error);
    return;
  }

  allMovies = allMovies.map((movie) => ({
    ...movie,
    user_rating: 0,
    user_comment: '',
    reviews: [],
    average_community_rating: 0,
    vote_average:
      (movie.vote_average === undefined || movie.vote_average === null || movie.vote_average === 0)
      && typeof movie.average_rating === 'number'
      && movie.average_rating !== 0
        ? movie.average_rating
        : movie.vote_average
  }));

  proposedMovies = allMovies.filter(m => !m.is_seen && !m.is_dropped);
  seenMovies = allMovies.filter(m => m.is_seen);
  const droppedMovies = allMovies.filter(m => m.is_dropped);

  renderProposals({ lazy });
  renderHistory();
  renderCemetery(droppedMovies);
  if (currentView === 'profile') loadUserActivity();
  
  // Kick off secondary UI updates after the first content is visible.
  updateGlobalRanking();
  renderHomeAchievements();
  renderTopVotedShowcase();
  fetchRecentAchievementEvents();
  updateAuthUI();

  const ratingsHydrationTask = Promise.all([individualRatingsPromise, allRatingsPromise, allProfilesPromise])
    .then(([individualRatings, allRatings, allProfiles]) => {
      const profileById = new Map((allProfiles || []).map((profile) => [profile.id, profile]));
      const ratingsByMovieId = new Map();

      (allRatings || []).forEach((rating) => {
        const bucket = ratingsByMovieId.get(rating.movie_id) || [];
        bucket.push({
          ...rating,
          profiles: profileById.get(rating.user_id)
        });
        ratingsByMovieId.set(rating.movie_id, bucket);
      });

      const individualRatingsByMovieId = new Map((individualRatings || []).map((rating) => [rating.movie_id, rating]));

      allMovies = allMovies.map((movie) => {
        const userRating = individualRatingsByMovieId.get(movie.id);
        const movieRatings = ratingsByMovieId.get(movie.id) || [];

        return {
          ...movie,
          user_rating: userRating ? userRating.rating : 0,
          user_comment: userRating ? userRating.comment : '',
          reviews: movieRatings,
          average_community_rating: movieRatings.length > 0
            ? movieRatings.reduce((sum, rating) => sum + rating.rating, 0) / movieRatings.length
            : 0
        };
      });

      proposedMovies = allMovies.filter(m => !m.is_seen && !m.is_dropped);
      seenMovies = allMovies.filter(m => m.is_seen);
      renderProposals({ lazy });
      renderHistory();
      if (currentView === 'profile') loadUserActivity();
    })
    .catch((error) => {
      console.error('Error hydrating movie ratings:', error);
    });

  const enrichmentTask = enrichMovieData(allMovies, { lazyProposals: lazy }).catch((error) => {
    console.error('Error enriching movie data:', error);
  });

  if (!lazy) {
    await Promise.all([ratingsHydrationTask, enrichmentTask, sessionsTask]);
  }
}

// Rendering Helpers
// formatScore imported from utils

// Routing
window.navigateTo = (viewId, targetUserId = null) => {
  if (viewId === 'profile' && !targetUserId) {
    store.setState({ profileAuditMode: 'activity' });
  }

  currentView = viewId;
  
  // Hide all views
  Object.values(views).forEach(v => v.classList.add('page-hidden'));
  adminDashboard.classList.add('page-hidden');

  // If we are navigating to profile, check if it's our own or another user's (audit)
  if (viewId === 'profile') {
    loadUserActivity(targetUserId);
  }

  // Show target view
  if (views[viewId]) {
    views[viewId].classList.remove('page-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  updateActiveNavLink(viewId);
};

function updateActiveNavLink(viewId) {
  document.querySelectorAll('.nav-link-btn').forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(viewId)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}


function handleRouting() {
  const hash = window.location.hash.replace('#', '') || 'home';
  currentView = hash;

  Object.keys(views).forEach(v => {
    if (v === hash) views[v].classList.remove('page-hidden');
    else views[v].classList.add('page-hidden');
  });

  if (hash === 'profile' && !user) {
    window.navigateTo('auth');
    return;
  }

  if (hash === 'profile') loadUserActivity();
  if (hash === 'ranking') renderRankingView();
  
  if (window.lucide) window.lucide.createIcons();
}

// Visual Feedback System (Toasts)
// showNotification imported from utils

// createMovieCardHTML imported from components

// Profile Logic

function renderActivityGrid(movies) {
  ProfileView.renderActivityGrid(movies, profileActivityGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function setupEventListeners() {
  supabase.auth.onAuthStateChange((event, session) => {
    scheduleAuthStateSync(session);
  });

  window.addEventListener('hashchange', handleRouting);
  window.addEventListener('app:refresh', (e) => refreshData(e.detail || {}));

  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleMovieSearch(e.target.value), 500);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('active');
    }
  });

  // Auth Tab Toggling
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.auth-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').classList.toggle('page-hidden', !isLogin);
      document.getElementById('signupForm').classList.toggle('page-hidden', isLogin);
    };
  });

  // Explore Controls
  document.getElementById('exploreSearchBtn').onclick = fetchExploreResults;
  document.getElementById('aiSearchBtn').onclick = fetchAIRecommendations;
  
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.mode-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isAI = tab.dataset.mode === 'ai';
      document.getElementById('manualSearchPanel').classList.toggle('page-hidden', isAI);
      document.getElementById('aiSearchPanel').classList.toggle('page-hidden', !isAI);
      exploreGrid.innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
    };
  });

  // Admin Tabs
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelector('.admin-tab-btn.active').classList.remove('active');
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('adminUsersTab').classList.toggle('page-hidden', tab !== 'users');
      document.getElementById('adminSessionsTab').classList.toggle('page-hidden', tab !== 'sessions');
      document.getElementById('adminLogsTab').classList.toggle('page-hidden', tab !== 'logs');
      document.getElementById('adminAchievementsTab').classList.toggle('page-hidden', tab !== 'achievements');
      document.getElementById('adminSettingsTab').classList.toggle('page-hidden', tab !== 'settings');
      if (tab === 'settings') loadAppSettings();
    };
  });

  document.getElementById('exploreClearBtn').onclick = () => {
    exploreInputs.forEach(input => {
      if (input.id === 'exploreLimit') {
        input.value = '20';
      } else if (input.id === 'exploreSort') {
        input.value = 'popularity.desc';
      } else {
        input.value = '';
      }
    });
    exploreGrid.innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
  };
}

/* --- Session System Logic moved to SessionController.js --- */
/* --- Movie/Achievement Logic moved to MovieController.js --- */

init();

// renderCemetery removed (now handled by HomeView)

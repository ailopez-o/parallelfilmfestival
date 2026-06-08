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

let proposalLazyRenderToken = 0;
let proposalLazyObserver = null;
let proposalLazyFallbackTimer = null;

const INITIAL_PROPOSAL_CHUNK_SIZE = 10;
const INITIAL_PROPOSAL_FALLBACK_MS = 2200;
const INITIAL_PROPOSAL_ROOT_MARGIN = '900px 0px';

// Fallback images (imported from constants)
// Limits configuration

// Initialization
async function init() {
  initExplore();
  initAdmin();
  initAuth();
  initSessions();
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

async function enrichMovieData(movies, options = {}) {
  const { lazyProposals = false } = options;

  // Find movies that need enrichment (missing scores, duration, trailers, or providers)
  const moviesToEnrich = movies.filter(m => m.tmdb_id && (
    m.vote_average === undefined || m.vote_average === null || m.vote_average === 0 ||
    !m.runtime ||
    !m.trailer_url ||
    !m.watch_providers
  ));
  
  if (moviesToEnrich.length === 0) return;

  console.log(`[Enrichment] Found ${moviesToEnrich.length} movies needing TMDB data.`);

  for (const movie of moviesToEnrich) {
    try {
      const data = await TMDBService.invokeTMDBCall(`/movie/${movie.tmdb_id}`, {
        append_to_response: 'videos,watch/providers'
      });
      
      const updates = {};
      
      // 1. Enriched Scores
      if (data.vote_average !== undefined) {
        movie.vote_average = data.vote_average;
        updates.average_rating = data.vote_average;
        // Don't overwrite local vote_count with TMDB's global count
      }

      if (data.runtime) {
        movie.runtime = data.runtime;
        updates.runtime = data.runtime;
      }
      
      // 2. Trailers
      const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        movie.trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
        updates.trailer_url = movie.trailer_url;
      }
      
      // 3. Watch Providers (Spain priority)
      const providers = data['watch/providers']?.results?.ES;
      if (providers) {
        movie.watch_providers = providers;
        updates.watch_providers = providers;
      }
      
      if (Object.keys(updates).length > 0) {
        console.log(`[Enrichment] Data updated for ${movie.title}`);
        await MovieService.updateMovieData(movie.id, updates);
        movie.vote_average = updates.average_rating || movie.vote_average;
      }
    } catch (e) {
      console.error(`[Enrichment] Failed for ${movie.title}:`, e);
    }
  }

  // Re-render
  renderProposals({ lazy: lazyProposals });
  renderHistory();
}

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

// Rendering
function renderProposals(options = {}) {
  const { lazy = false } = options;

  if (!movieGrid) return;

  if (!lazy) {
    clearProposalLazyRenderState();
    HomeView.renderProposals(proposedMovies, movieGrid, { isAdmin, user, userVotes });
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (!proposedMovies.length) {
    clearProposalLazyRenderState();
    HomeView.renderProposals(proposedMovies, movieGrid, { isAdmin, user, userVotes });
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  clearProposalLazyRenderState();
  HomeView.renderMovieGridSkeletons(movieGrid, Math.min(6, proposedMovies.length));

  const token = proposalLazyRenderToken;
  let hasStarted = false;

  const renderChunks = (startIndex = 0) => {
    if (token !== proposalLazyRenderToken) return;

    const chunk = proposedMovies.slice(startIndex, startIndex + INITIAL_PROPOSAL_CHUNK_SIZE);
    if (startIndex === 0) {
      movieGrid.innerHTML = buildProposalChunkHTML(chunk);
    } else {
      movieGrid.insertAdjacentHTML('beforeend', buildProposalChunkHTML(chunk));
    }

    if (window.lucide) window.lucide.createIcons();

    const nextIndex = startIndex + INITIAL_PROPOSAL_CHUNK_SIZE;
    if (nextIndex < proposedMovies.length) {
      queueProposalChunkRender(() => renderChunks(nextIndex));
    }
  };

  const startLazyRender = () => {
    if (hasStarted || token !== proposalLazyRenderToken) return;
    hasStarted = true;

    if (proposalLazyObserver) {
      proposalLazyObserver.disconnect();
      proposalLazyObserver = null;
    }

    if (proposalLazyFallbackTimer) {
      window.clearTimeout(proposalLazyFallbackTimer);
      proposalLazyFallbackTimer = null;
    }

    renderChunks(0);
  };

  proposalLazyFallbackTimer = window.setTimeout(startLazyRender, INITIAL_PROPOSAL_FALLBACK_MS);

  if (typeof window.IntersectionObserver === 'function') {
    proposalLazyObserver = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startLazyRender();
      }
    }, { rootMargin: INITIAL_PROPOSAL_ROOT_MARGIN });

    proposalLazyObserver.observe(movieGrid);
  } else {
    startLazyRender();
  }
}

async function renderTopVotedShowcase() {
  const container = document.getElementById('topVotedShowcase');
  const grid = document.getElementById('topVotedGrid');
  HomeView.renderTopVotedShowcase(proposedMovies, container, grid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function renderHistory() {
  HomeView.renderHistory(seenMovies, historyGrid, { isAdmin, user, userVotes, userAttendance });
  if (window.lucide) window.lucide.createIcons();
}

function renderCemetery(droppedMovies) {
  HomeView.renderCemetery(droppedMovies, cemeteryGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}


// Actions
window.deleteMovie = async (movieId) => {
  if (!isAdmin) {
    return window.dropMovie(movieId);
  }
  const movie = allMovies.find(m => m.id === movieId);
  const title = movie ? movie.title : "this movie";
  if (!confirm("Are you sure you want to delete this proposal? This action cannot be undone.")) return;

  try {
    await MovieService.deleteMovie(movieId);
    showNotification("Proposal deleted successfully.");
    refreshData();
  } catch (e) {
    showNotification("Error deleting movie", "error");
  }
};

window.dropMovie = async (movieId) => {
  const movie = allMovies.find(m => m.id === movieId);
  if (!movie) return;
  if (!confirm("Move this movie to the Cemetery? (It can be recovered later)")) return;

  try {
    await MovieService.updateMovieData(movieId, { is_dropped: true });

    // Permanently delete votes for this movie to free up slots
    await supabase.from('votes').delete().eq('movie_id', movieId);

    showNotification("Movie sent to Cemetery.");
    refreshData();
  } catch (e) {
    showNotification("Error dropping movie", "error");
  }
};

// Profile Logic

window.unmarkAsSeen = async (movieId) => {
  if (!isAdmin) return;
  try {
    await MovieService.updateMovieData(movieId, { is_seen: false });
    showNotification('Movie moved back to proposals', 'success');
    await refreshData();
  } catch (e) {
    showNotification('Failed to revert status', 'error');
  }
};

function renderActivityGrid(movies) {
  ProfileView.renderActivityGrid(movies, profileActivityGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

// TMDB Search Logic
let searchTimeout;
async function handleMovieSearch(query) {
  if (!user || !query) {
    searchResults.classList.remove('active');
    return;
  }

  try {
    const dataResults = await TMDBService.searchTMDB(query);
    
    // No restrictive filtering - just sort by popularity (desc) and take top 20
    const results = dataResults
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20);

    const enrichedResults = await Promise.all(results.map(async movie => {
      try {
        const detailsData = await TMDBService.invokeTMDBCall(`/movie/${movie.id}`, {
          append_to_response: 'credits'
        });
        const directors = (detailsData.credits?.crew || [])
          .filter(person => person.job === 'Director')
          .map(d => d.name)
          .join(', ');
        
        // Map genres
        const genreNames = detailsData.genres?.map(genre => genre.name)
          || movie.genre_ids.map(id => genreMap[id]).filter(Boolean);

        return {
          ...movie,
          runtime: detailsData.runtime,
          director: directors || 'Unknown Director',
          genres: genreNames,
          synopsis: detailsData.overview || movie.overview
        };
      } catch (e) {
        return { ...movie, director: 'Unknown Director', genres: [], synopsis: movie.overview };
      }
    }));

    renderSearchResults(enrichedResults);
  } catch (err) {
    console.error('TMDB Search error:', err);
  }
}

function renderSearchResults(results) {
  HomeView.renderSearchResults(results, searchResults, formatScore, FALLBACK_IMAGE);
  if (window.lucide) window.lucide.createIcons();
}

// Actions
window.proposeMovie = async (tmdbMovie, el) => {
  if (!user) {
    window.navigateTo('auth');
    return;
  }

  // Check limits with a fresh DB query to avoid race conditions
  const { count, error: countError } = await supabase
    .from('movies')
    .select('*', { count: 'exact', head: true })
    .eq('proposed_by', user.id)
    .eq('is_seen', false)
    .eq('is_dropped', false);

  if (countError) {
    console.error('Error checking proposal limits:', countError);
  }

  const currentCount = count !== null ? count : proposedMovies.filter(m => m.proposed_by === user.id).length;

  if (currentCount >= MAX_PROPOSALS && !isAdmin) {
    showNotification(`Proposal limit reached! You already have the maximum allowed (${MAX_PROPOSALS}). You must delete or wait for one of your current proposals to be screened to add more.`, 'warning');
    return;
  }

  const card = el?.closest('.movie-card');

  // 🪦 RESURRECTION LOGIC: Check if movie is in the cemetery
  try {
    const existing = await MovieService.findMovieByTMDBId(tmdbMovie.id);

    if (existing && existing.is_dropped) {
      if (confirm(`"${tmdbMovie.title}" is currently in the Cinema Cemetery. Do you want to rescue it and bring it back to active proposals?`)) {
        await MovieService.rescueMovie(existing.id, user.id);

        // Ensure user has a vote on the rescued movie (auto-vote)
        const hasVoted = await MovieService.fetchVotesForUser(user.id);
        if (!hasVoted.some(v => v.movie_id === existing.id)) {
          await MovieService.addVote(user.id, existing.id);
          userVotes.add(existing.id);
        }

        showNotification(`"${tmdbMovie.title}" has been rescued from the cemetery!`, 'success');
        refreshData();
        return;
      } else {
        return; // User cancelled rescue
      }
    }
  } catch (checkErr) {
    console.error('Error checking for existing movie:', checkErr);
  }

  // SAFE INSERT LOGIC
  const payload = {
    title: tmdbMovie.title,
    release_year: tmdbMovie.release_date ? parseInt(tmdbMovie.release_date.split('-')[0]) : null,
    poster_url: tmdbMovie.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` : null,
    tmdb_id: tmdbMovie.id,
    proposed_by: user.id,
    director: tmdbMovie.director,
    genres: tmdbMovie.genres,
    synopsis: tmdbMovie.synopsis,
    runtime: tmdbMovie.runtime
  };

  try {
    const data = await MovieService.createMovie({
      ...payload,
      average_rating: tmdbMovie.vote_average || 0
    });
    
    showNotification(`"${tmdbMovie.title}" proposed!`, 'success');

    // Automatically add user's vote to their own proposal
    try {
      if (data && data.id) {
        await MovieService.addVote(user.id, data.id);
        userVotes.add(data.id);
      }
    } catch (vErr) {
      console.warn('Auto-vote failed:', vErr);
    }

    if (card) {
      card.style.transform = 'scale(1.05)';
      card.style.borderColor = 'var(--success)';
      setTimeout(() => {
        card.style.transform = '';
        card.style.borderColor = '';
      }, 500);
    }
    searchInput.value = '';
    searchResults.classList.remove('active');
    await refreshData();
  } catch (error) {
    if (error.code === '23505') {
      showNotification('Already in the lineup!', 'warning');
      if (card) {
        card.style.animation = 'shake 0.5s ease';
        setTimeout(() => card.style.animation = '', 500);
      }
    } else {
      console.error('Error proposing movie:', error);
      showNotification('Something went wrong', 'error');
    }
  }
};

window.toggleVote = async (movieId) => {
  if (!user) {
    window.navigateTo('auth');
    return;
  }

  const movie = proposedMovies.find(m => m.id === movieId);
  if (!movie) return;

  const btn = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-btn`);
  const countEl = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-count`);

  if (userVotes.has(movieId)) {
    // Unvote is ALWAYS allowed
    try {
      await MovieService.removeVote(user.id, movieId);
      userVotes.delete(movieId);
      
      movie.vote_count = (movie.vote_count || 1) - 1;
      if (btn) btn.classList.remove('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    } catch (err) {
      console.error('Failed to remove vote:', err);
      showNotification('Failed to remove vote', 'error');
    }
  } else {
    // Check vote limits
    console.log(`[Vote] User Votes: ${userVotes.size} / ${MAX_VOTES} | Admin: ${isAdmin}`);
    
    if (userVotes.size >= MAX_VOTES && !isAdmin) {
      showNotification(`You've run out of votes! You have already used your ${MAX_VOTES} available votes. Remove a vote from another movie if you want to support this new proposal.`, 'warning');
      return;
    }

    // Vote
    try {
      await MovieService.addVote(user.id, movieId);
      userVotes.add(movieId);
      
      movie.vote_count = (movie.vote_count || 0) + 1;
      if (btn) btn.classList.add('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    } catch (err) {
      console.error('Failed to add vote:', err);
      showNotification('Failed to add vote', 'error');
    }
  }
  updateAuthUI();
};

window.markAsSeen = async (movieId) => {
  if (!confirm('Mark this movie as SEEN?')) return;
  try {
    await MovieService.updateMovieData(movieId, { is_seen: true });
    showNotification('Movie marked as seen!', 'success');
    await refreshData();
  } catch (e) {
    console.error('Error marking as seen:', e);
  }
};

window.selectRating = (movieId, rating) => {
  const valLabel = document.getElementById(`rating-val-${movieId}`);
  if (valLabel) valLabel.textContent = rating;
  
  const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
  if (container) {
    container.setAttribute('onmouseleave', `window.resetStars('${movieId}', ${rating})`);
  }
  
  window.resetStars(movieId, rating);
};

window.rateMovie = async (movieId, rating) => {
  if (!user) return;
  
  // Update state for immediate feedback
  const movie = seenMovies.find(m => m.id === movieId);
  const isFirstReview = !movie?.user_rating;
  if (movie) movie.user_rating = rating;

  const commentInput = document.getElementById(`comment-input-${movieId}`);
  const comment = commentInput ? commentInput.value : null;

  const { error } = await supabase
    .from('user_ratings')
    .upsert({ 
      movie_id: movieId, 
      user_id: user.id, 
      rating: parseInt(rating),
      comment: comment
    }, { onConflict: 'movie_id,user_id' });

  if (error) {
    console.error('Error rating movie:', error);
    showNotification('Error saving rating', 'error');
  } else {
    showNotification('Rating saved!', 'success');
    await refreshData();
  }
};

function syncLocalRating(movieId, rating) {
  const movie = seenMovies.find(m => m.id === movieId);
  if (movie) movie.user_rating = rating;
}

window.hoverStars = (movieId, count) => {
  const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
  const stars = container.querySelectorAll('.star-btn');
  const valLabel = document.getElementById(`rating-val-${movieId}`);
  if (valLabel) valLabel.textContent = `${count} / 10`;
  
  stars.forEach((star, i) => {
    if (i < count) star.classList.add('star-filled');
    else star.classList.remove('star-filled');
  });
};

window.resetStars = (movieId, currentRating) => {
  const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
  const stars = container.querySelectorAll('.star-btn');
  const valLabel = document.getElementById(`rating-val-${movieId}`);
  if (valLabel) valLabel.textContent = `${currentRating || 0} / 10`;
  
  stars.forEach((star, i) => {
    if (i < currentRating) star.classList.add('star-filled');
    else star.classList.remove('star-filled');
  });
};

async function updateCommunityAverage(movieId) {
  const { data, error } = await supabase
    .from('user_ratings')
    .select('rating')
    .eq('movie_id', movieId);

  if (!error && data.length > 0) {
    const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
    const avgLabel = document.getElementById(`comm-avg-${movieId}`);
    if (avgLabel) avgLabel.textContent = avg.toFixed(1);
  }
}

function clearProposalLazyRenderState() {
  proposalLazyRenderToken += 1;

  if (proposalLazyObserver) {
    proposalLazyObserver.disconnect();
    proposalLazyObserver = null;
  }

  if (proposalLazyFallbackTimer) {
    window.clearTimeout(proposalLazyFallbackTimer);
    proposalLazyFallbackTimer = null;
  }
}

function buildProposalChunkHTML(movies) {
  return (movies || []).map((movie) => {
    const isOwner = user && movie.proposed_by === user.id;
    return createMovieCardHTML(movie, {
      context: 'proposal',
      showDelete: isOwner || isAdmin,
      isAdmin,
      user,
      userVotes
    });
  }).join('');
}

function queueProposalChunkRender(renderFn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(renderFn, { timeout: 120 });
    return;
  }

  window.setTimeout(renderFn, 16);
}

function setupEventListeners() {
  supabase.auth.onAuthStateChange((event, session) => {
    scheduleAuthStateSync(session);
  });

  window.addEventListener('hashchange', handleRouting);
  window.addEventListener('app:refresh', (e) => refreshData(e.detail || {}));

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

/* --- Achievements System Logic --- */


/**
 * Calculates achievement progress for a specific user.
 */
async function calculateUserAchievements(userId) {
  return AchievementService.calculateUserAchievements(userId || user?.id, sessions);
}

async function calculateGlobalAchievementStats() {
  return AchievementService.calculateGlobalStats(allMovies);
}

async function renderHomeAchievements() {
  const grid = document.getElementById('homeAchievementsGrid');
  if (!grid) return;
  
  // Show skeletons while calculating
  if (grid.innerHTML.trim() === "" || grid.querySelector('.empty-state')) {
    ProfileView.renderAchievementSkeletons(grid, 4);
  }

  const stats = await calculateGlobalAchievementStats();
  HomeView.renderHomeAchievements(stats, grid, ACHIEVEMENT_LIST);
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Fetches recent achievement events
 */
async function fetchRecentAchievementEvents() {
  try {
    const events = await AchievementService.fetchRecentEvents();
    
    // Sort and render
    events.sort((a, b) => b.date - a.date);
    
    // Home Timeline (Top 5)
    renderAchievementTimeline(events.slice(0, 5));

    // Admin Audit List (Full history)
    const adminList = document.getElementById('adminAchievementsList');
    if (adminList) {
      // Need a map for admin view if it expects one
      const { data: activeProfiles } = await supabase.from('profiles').select('id, full_name, email');
      const activeUserMap = {};
      activeProfiles?.forEach(p => activeUserMap[p.id] = p.full_name || p.email.split('@')[0]);
      
      AdminView.renderAchievementsAudit(events, adminList, activeUserMap);
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error('Error fetching achievement events:', err);
  }
}

async function renderAchievementTimeline(events) {
  const body = document.getElementById('timelineBody');
  HomeView.renderTimeline(events, body);
  if (window.lucide) window.lucide.createIcons();
}

/* --- Session System Logic moved to SessionController.js --- */

init();

// renderCemetery removed (now handled by HomeView)

import { supabase } from './src/config/supabase.js';
import { normalize, formatScore, timeAgo, showNotification } from './src/utils/index.js';
import { FALLBACK_IMAGE, TBD_POSTER, DEFAULT_MAX_PROPOSALS, DEFAULT_MAX_VOTES } from './src/config/constants.js';
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
import { ACHIEVEMENT_LIST } from './src/config/constants.js';

// Configuration removed (now in src/config/supabase.js)

// Edge Function Proxy Helper
async function invokeTMDBCall(path, params = {}) {
  // Helper for timeout
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Request Timeout')), ms));
  
  try {
    // Race between the actual call and a 12-second timeout
    const response = await Promise.race([
      supabase.functions.invoke('tmdb-proxy', { body: { path, params } }),
      timeout(12000)
    ]);

    const { data, error } = response;
    
    if (error) {
      const msg = error.message || "Unknown Proxy Error";
      console.error(`[TMDB Proxy Error]: ${msg}`, error);
      throw new Error(`TMDB Proxy Error: ${msg}`);
    }
    
    if (data && data.error) {
      console.error(`[TMDB Proxy Logic Error]: ${data.error}`, data.details);
      throw new Error(data.error);
    }

    return data;
  } catch (e) {
    if (e.message === 'Request Timeout') {
      console.warn(`[TMDB Proxy] Timeout reached for ${path}`);
    }
    throw e;
  }
}

// State
let allMovies = [];
let proposedMovies = [];
let seenMovies = [];
let userVotes = new Set(); // Set of movie IDs the user voted for
let user = null;
let userProfile = null; // Cache for profile data (name, avatar, role)
let isAdmin = false;
let rankedUsers = []; // Global leaderboard data
let currentView = 'home';
let genreMap = {}; // Map of genre ID to name
let providerMap = {}; // Map of provider ID to data (name, logo)
let sessions = [];
let currentSession = null;

async function fetchAppSettings() {
  try {
    const settings = await AdminService.fetchAppSettings();
    if (settings.maxProposals) MAX_PROPOSALS = settings.maxProposals;
    if (settings.maxVotes) MAX_VOTES = settings.maxVotes;
  } catch (err) {
    console.error('Error fetching settings:', err);
  }
}

function loadAppSettings() {
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  if (maxPropInput) maxPropInput.value = MAX_PROPOSALS;
  if (maxVoteInput) maxVoteInput.value = MAX_VOTES;
}

window.saveAppSettings = async () => {
  if (!isAdmin) return;
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  
  const newValProp = maxPropInput.value;
  const newValVote = maxVoteInput.value;

  try {
    showNotification('Updating system settings...', 'warning');
    
    await Promise.all([
      supabase.from('app_settings').update({ value: newValProp.toString() }).eq('key', 'max_proposals'),
      supabase.from('app_settings').update({ value: newValVote.toString() }).eq('key', 'max_votes')
    ]);

    // Update local state
    MAX_PROPOSALS = parseInt(newValProp);
    MAX_VOTES = parseInt(newValVote);

    showNotification('System settings updated successfully!', 'success');
    
    // Refresh UI components that use these limits
    updateAuthUI();
    if (currentView === 'profile') loadUserActivity();

  } catch (err) {
    console.error('Error saving app settings:', err);
    showNotification('Error updating settings', 'error');
  }
};

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
let MAX_PROPOSALS = DEFAULT_MAX_PROPOSALS;
let MAX_VOTES = DEFAULT_MAX_VOTES;

// Initialization
async function init() {
  const dismissPreloader = () => {
    const preloader = document.getElementById('preloader');
    if (preloader && !preloader.classList.contains('fade-out')) {
      preloader.classList.add('fade-out');
      setTimeout(() => preloader.remove(), 800);
    }
  };

  try {
    // 1. Critical path: User and Genre/Provider maps (Parallel)
    await Promise.all([
      fetchGenreMap(),
      fetchProvidersMap(),
      fetchAppSettings(),
      checkUser()
    ]);

    // 2. Essential data: First batch of movies
    await refreshData();

    // 3. Dismiss preloader NOW - user can see movies
    dismissPreloader();

    // 4. Background tasks: Ranking and Sessions (don't block the UI)
    updateGlobalRanking();
    fetchSessions().then(() => renderSessions());
    fetchRecentAchievementEvents();

  } catch (err) {
    console.error('Initialization error:', err);
    dismissPreloader(); // Dismiss anyway to show error state or partial content
  }

  setupEventListeners();
  handleRouting();
}

async function fetchGenreMap() {
  try {
    const data = await invokeTMDBCall('/genre/movie/list');
    if (data.genres) {
      exploreGenreSelect.innerHTML = '<option value="">All Genres</option>';
      data.genres.forEach(g => {
        genreMap[g.id] = g.name;
        const option = document.createElement('option');
        option.value = g.id;
        option.textContent = g.name;
        exploreGenreSelect.appendChild(option);
      });
    }
  } catch (e) {
    console.error('Error fetching genre map:', e);
  }
}

async function fetchProvidersMap() {
  try {
    const data = await invokeTMDBCall('/watch/providers/movie', { watch_region: 'ES' });
    const select = document.getElementById('exploreProvider');
    if (data.results && select) {
      select.innerHTML = '<option value="">Any Platform</option>';
      // Sort and take top providers or specific ones
      const topProviders = data.results.slice(0, 50); 
      topProviders.forEach(p => {
        providerMap[p.provider_id] = p;
        const option = document.createElement('option');
        option.value = p.provider_id;
        option.textContent = p.provider_name;
        select.appendChild(option);
      });
    }
  } catch (e) {
    console.error('Error fetching providers map:', e);
  }
}

async function checkUser(session) {
  if (session === undefined) {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  }
  
  user = session?.user || null;
  
  if (user) {
    // 🛡️ Dynamic RBAC: Fetch role from profiles table
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // If no profile exists (e.g., new Google login), create one automatically
    if (!profile) {
      console.log('[Auth] Profile missing, creating default profile...');
      const metadata = user.user_metadata || {};
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert([{
          id: user.id,
          full_name: metadata.full_name || user.email.split('@')[0],
          role: 'user'
        }])
        .select()
        .single();
      
      if (!insertError) profile = newProfile;
    }

    userProfile = profile;
    isAdmin = userProfile?.role === 'admin';
    console.log(`[ACL] User: ${user.email} | Role: ${userProfile?.role || 'user'} | Admin: ${isAdmin}`);

    const { data: votes } = await supabase.from('votes').select('movie_id').eq('user_id', user.id);
    userVotes = new Set(votes?.map(v => v.movie_id) || []);
  } else {
    userProfile = null;
    isAdmin = false;
    userVotes = new Set();
  }
  updateAuthUI();
  if (isAdmin) {
    window.cleanupInactiveMovies(true);
  }
}

async function refreshData() {
  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error) allMovies = data || [];

  if (error) {
    console.error('Error fetching movies:', error);
    return;
  }

  // Hydrate with ratings if user logged in
  let individualRatings = [];
  let allRatings = [];

  if (user) {
    const { data: ratings } = await supabase.from('user_ratings').select('*').eq('user_id', user.id);
    individualRatings = ratings || [];
  }

  const { data: globalRatings } = await supabase.from('user_ratings').select('movie_id, rating');
  allRatings = globalRatings || [];

  allMovies.forEach(m => {
    const userV = individualRatings.find(r => r.movie_id === m.id);
    m.user_rating = userV ? userV.rating : 0;
    
    const mRatings = allRatings.filter(r => r.movie_id === m.id);
    m.average_community_rating = mRatings.length > 0 
      ? mRatings.reduce((sum, r) => sum + r.rating, 0) / mRatings.length 
      : 0;

    // Harmonize score fields (favoring vote_average if present, then average_rating)
    if (m.vote_average === undefined || m.vote_average === null || m.vote_average === 0) {
      if (typeof m.average_rating === 'number' && m.average_rating !== 0) {
        m.vote_average = m.average_rating;
      }
    }
  });

  // Background enrichment for movies with missing data
  enrichMovieData(allMovies);

  // 1. TEMPORARY: Sanitization of corrupted vote counts from TMDB global data
  const corrupted = allMovies.filter(m => !m.is_seen && m.vote_count > 50);
  if (corrupted.length > 0) {
    console.log(`[Migration] Sanitizing ${corrupted.length} corrupted movie counts...`);
    supabase.from('movies').update({ vote_count: 0 }).in('id', corrupted.map(m => m.id)).then(() => {
      corrupted.forEach(m => m.vote_count = 0);
      renderProposals();
    });
  }

  proposedMovies = allMovies.filter(m => !m.is_seen && !m.is_dropped);
  seenMovies = allMovies.filter(m => m.is_seen);
  const droppedMovies = allMovies.filter(m => m.is_dropped);

  renderProposals();
  renderHistory();
  renderCemetery(droppedMovies);
  if (currentView === 'profile') loadUserActivity();
  
  // Also refresh ranking on any state change
  updateGlobalRanking();

  // Achievements rendering
  renderHomeAchievements();
  renderTopVotedShowcase();
  fetchRecentAchievementEvents();
  if (currentView === 'profile') renderProfileAchievements();

  // Sessions rendering
  await fetchSessions();
  renderSessions();
  renderNextSessionHero();
  updateAuthUI();
  updateAdminSessions();
}

// Rendering Helpers
// formatScore imported from utils

async function enrichMovieData(movies) {
  // Find movies that need enrichment (missing scores, trailers, or providers)
  const moviesToEnrich = movies.filter(m => m.tmdb_id && (
    m.vote_average === undefined || m.vote_average === null || m.vote_average === 0 ||
    !m.trailer_url || 
    !m.watch_providers
  ));
  
  if (moviesToEnrich.length === 0) return;

  console.log(`[Enrichment] Found ${moviesToEnrich.length} movies needing TMDB data.`);

  for (const movie of moviesToEnrich) {
    try {
      const data = await invokeTMDBCall(`/movie/${movie.tmdb_id}`, {
        append_to_response: 'videos,watch/providers'
      });
      
      const updates = {};
      
      // 1. Enriched Scores
      if (data.vote_average !== undefined) {
        movie.vote_average = data.vote_average;
        updates.average_rating = data.vote_average;
        // Don't overwrite local vote_count with TMDB's global count
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
        await supabase.from('movies').update(updates).eq('id', movie.id);
      }
    } catch (e) {
      console.error(`[Enrichment] Failed for ${movie.title}:`, e);
    }
  }

  // Re-render
  renderProposals();
  renderHistory();
}

// Routing
window.navigateTo = (viewId, targetUserId = null) => {
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

window.viewUserProfile = (userId) => {
  if (!isAdmin) return;
  console.log(`[Admin] Auditing user profile: ${userId}`);
  window.navigateTo('profile', userId);
};

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
function renderProposals() {
  HomeView.renderProposals(proposedMovies, movieGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

async function renderTopVotedShowcase() {
  const container = document.getElementById('topVotedShowcase');
  const grid = document.getElementById('topVotedGrid');
  HomeView.renderTopVotedShowcase(proposedMovies, container, grid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function renderHistory() {
  HomeView.renderHistory(seenMovies, historyGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function renderCemetery(droppedMovies) {
  HomeView.renderCemetery(droppedMovies, cemeteryGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function updateAuthUI() {
  if (user) {
    const name = userProfile?.full_name || user.user_metadata?.full_name || user.email.split('@')[0];
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
    const myScore = userProfile?.score || 0;
    
    // Calculate current usage
    const myProposalsCount = proposedMovies.filter(m => m.proposed_by === user.id).length;
    const votesLeft = MAX_VOTES - userVotes.size;
    const proposalsLeft = MAX_PROPOSALS - myProposalsCount;

    if (isAdmin) {
      userHeader.innerHTML = `
        <div class="user-profile">
          <div class="score-badge header-score" style="background:rgba(255,165,0,0.1); color:#ffa500; border: 1px solid rgba(255,165,0,0.3);">
            <i data-lucide="shield-check" style="width:12px; height:12px; margin-right:4px;"></i>
            ADMIN MODE
          </div>
          <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')" title="View Cinema Sessions">
            <i data-lucide="calendar" style="width:12px; height:12px; margin-right:4px;"></i>
            Sessions
          </div>
          <div class="user-profile-info" onclick="window.navigateTo('profile')">
            <img src="${avatar}" class="user-avatar" />
            <div style="display:flex; flex-direction:column; line-height: 1.2;">
              <span style="font-weight:700;">${name}</span>
              <span style="font-size: 0.7rem; color:var(--success); font-weight:800;">ADMINISTRATOR</span>
            </div>
          </div>
        </div>
      `;
      if (searchInput) {
        searchInput.disabled = false;
        searchInput.style.opacity = '1';
        searchInput.style.cursor = 'text';
        searchInput.placeholder = "Search movies (Admin Mode)...";
      }
      const proposalsLabel = document.getElementById('proposalsCountLabel');
      if (proposalsLabel) proposalsLabel.style.opacity = '0';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    userHeader.innerHTML = `
      <div class="user-profile">
        <div class="score-badge header-score" style="background:rgba(0, 212, 255, 0.1); color:#00d4ff; border: 1px solid rgba(0, 212, 255, 0.3);" title="Your available votes">
          <i data-lucide="check-square" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label">${votesLeft > 0 ? votesLeft : 0} <span class="hide-mobile">Votes Left</span></span>
        </div>
        <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')" title="View Cinema Sessions">
          <i data-lucide="calendar" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label hide-mobile">Sessions</span>
        </div>
        <div class="score-badge header-score" onclick="event.stopPropagation(); window.navigateTo('ranking')" title="View Global Ranking">
          <i data-lucide="award" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label">${myScore}</span>
        </div>
        <div class="user-profile-info" onclick="window.navigateTo('profile')">
          <img src="${avatar}" class="user-avatar" />
          <div class="user-name-wrapper hide-mobile" style="display:flex; flex-direction:column; line-height: 1.2;">
            <span style="font-weight:700;">${name}</span>
            ${userProfile?.rank ? `<span style="font-size: 0.7rem; color:var(--warning); font-weight:800;">#${userProfile.rank}</span>` : ""}
          </div>
        </div>
      </div>
    `;

    if (searchInput) {
      const isLimitReached = proposalsLeft <= 0;
      searchInput.disabled = isLimitReached;
      searchInput.style.opacity = isLimitReached ? '0.5' : '1';
      searchInput.style.cursor = isLimitReached ? 'not-allowed' : 'text';
      searchInput.placeholder = proposalsLeft > 0 
        ? `Search for movies to propose...`
        : "Max proposals reached (3/3)";
    }

    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) {
      proposalsLabel.style.opacity = '1';
      const green = '#10b981';
      const red = '#ef4444';
      proposalsLabel.innerHTML = `
        <span style="color:${proposalsLeft > 0 ? green : red}">
          ${proposalsLeft > 0 ? `Available Proposals: ${proposalsLeft} / ${MAX_PROPOSALS}` : `Limit Reached: ${MAX_PROPOSALS} / ${MAX_PROPOSALS} Proposals Used`}
        </span>
      `;
    }
  } else {
    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) proposalsLabel.style.opacity = '0';
    userHeader.innerHTML = `<button class="auth-btn" onclick="window.navigateTo('auth')">Sign In</button>`;
    
    searchResults.classList.remove('active');
    
    // 🛡️ Lock only the Proposal-specific search (Home/Header) 
    if (searchInput) {
      searchInput.disabled = true;
      searchInput.placeholder = "Sign in to propose movies...";
    }
    
    // ✅ Re-enable Explore/Discover features for everyone (already enabled by default)
    if (aiSearchInput) {
      aiSearchInput.disabled = false;
      aiSearchInput.placeholder = "e.g. Movies about space and loneliness from the 70s similar to 2001...";
    }
    if (aiSearchBtn) aiSearchBtn.disabled = false;
    
    exploreInputs.forEach(input => {
      if (input) {
        input.disabled = false;
        if (input.id === 'exploreTitle') input.placeholder = "Movie title...";
        if (input.id === 'exploreDirector') input.placeholder = "Director name...";
        if (input.id === 'exploreYearFrom') input.placeholder = "From";
        if (input.id === 'exploreYearTo') input.placeholder = "To";
      }
    });
    exploreButtons.forEach(btn => {
      if (btn) btn.disabled = false;
    });
  }

  // Restore interaction if user returns
  if (user) {
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = "Search movies to propose...";
    }
    // ... AI & Explore already enabled above ...
  }
}

// Actions
window.deleteMovie = async (movieId) => {
  if (!isAdmin) {
    return window.dropMovie(movieId);
  }
  const movie = allMovies.find(m => m.id === movieId);
  const title = movie ? movie.title : "this movie";
  if (!confirm(`ADMIN ACTION: Permanently delete "${title}"? This cannot be undone.`)) return;
  const { error } = await supabase.from("movies").delete().eq("id", movieId);
  if (error) {
    showNotification("Error deleting movie", "error");
  } else {
    showNotification("Movie permanently deleted", "success");
    refreshData();
  }
};

window.dropMovie = async (movieId) => {
  const movie = allMovies.find(m => m.id === movieId);
  if (!movie) return;
  if (!confirm(`Move "${movie.title}" to the Cemetery? It will no longer be an active proposal.`)) return;
  const { error } = await supabase.from("movies").update({ is_dropped: true }).eq("id", movieId);
  if (error) {
    showNotification("Error dropping movie", "error");
  } else {
    showNotification("Movie moved to the Cemetery", "info");
    refreshData();
  }
};

// Auth Logic
window.signInWithGoogle = async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
};

window.handleLogin = async () => {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) alert(error.message);
  else window.navigateTo('home');
};

window.handleSignup = async () => {
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const { data, error } = await supabase.auth.signUp({ email, password });
  
  if (error) {
    alert(error.message);
    return;
  }
  
  // If email confirmation is disabled, 'data.session' will be present
  if (data?.session) {
    window.navigateTo('home');
  } else {
    alert('Check your email for confirmation!');
  }
};

window.handleLogout = async () => {
  await supabase.auth.signOut();
  // Clear local state instantly
  await checkUser(null);
  window.navigateTo('auth');
};

// Profile Logic
async function loadUserActivity(targetUserId = null) {
  if (!user && !targetUserId) return;
  
  const isAudit = targetUserId && targetUserId !== user?.id;
  const activeUid = targetUserId || user.id;

  // Fetch target profile data from the DB
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', activeUid).single();
  
  ProfileView.renderHeader(profile, {
    profileName,
    profileEmail,
    profileAvatar,
    countProposals,
    countVotes,
    maxProposals: MAX_PROPOSALS,
    maxVotes: MAX_VOTES,
    proposalsCount: 0, // Will update after fetch
    votesCount: 0
  });

  // Show audit badge if viewing another user
  const auditBadge = document.getElementById('auditBadge') || document.createElement('div');
  if (isAudit) {
    auditBadge.id = 'auditBadge';
    auditBadge.className = 'audit-badge';
    auditBadge.innerHTML = `<i data-lucide="shield-check"></i> Auditing User Profile <button onclick="window.navigateTo('profile')">Exit Audit</button>`;
    profileName.parentElement.prepend(auditBadge);
    document.getElementById('editProfileBtn')?.classList.add('page-hidden');
  } else {
    auditBadge.remove();
    document.getElementById('editProfileBtn')?.classList.remove('page-hidden');
  }

  // Pre-fill edit form
  if (!isAudit) {
    editName.value = profile?.full_name || '';
    const displayEmailInput = document.getElementById('displayEmail');
    if (displayEmailInput) displayEmailInput.value = user.email;
  }

  const { data: proposals } = await supabase.from('movies').select('*').eq('proposed_by', activeUid).eq('is_dropped', false);
  const { data: votes } = await supabase.from('votes').select('movie_id, movies(*)').eq('user_id', activeUid);

  if (countProposals) countProposals.textContent = `${proposals?.length || 0} / ${MAX_PROPOSALS}`;
  if (countVotes) countVotes.textContent = `${votes?.length || 0} / ${MAX_VOTES}`;

  renderActivityGrid(proposals || []);
  
  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.activity-tab.active').classList.remove('active');
      tab.classList.add('active');
      const view = tab.dataset.view;
      renderActivityGrid(view === 'myProposals' ? (proposals || []) : (votes?.map(v => v.movies) || []));
    };
  });

  if (isAdmin) {
    adminDashboard.classList.remove('page-hidden');
    await fetchUserList();
    await fetchParticipationLog();
  } else {
    adminDashboard.classList.add('page-hidden');
  }

  await renderProfileAchievements(activeUid);
  if (window.lucide) window.lucide.createIcons();
}

window.toggleEditProfile = (show) => {
  const profileDisplay = document.getElementById('profileDisplay');
  const profileEditForm = document.getElementById('profileEditForm');
  if (profileDisplay) profileDisplay.classList.toggle('page-hidden', show);
  if (profileEditForm) profileEditForm.classList.toggle('page-hidden', !show);
};


window.saveProfile = async () => {
  const newName = editName.value.trim();
  const newAvatar = window.pendingAvatarUrl || profileAvatar.src;

  if (!newName) {
    showNotification('Name cannot be empty', 'error');
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ 
      full_name: newName
    })
    .eq('id', user.id);

  if (error) {
    console.error('Error updating profile:', error);
    showNotification('Failed to update profile', 'error');
  } else {
    showNotification('Profile updated successfully!', 'success');
    window.toggleEditProfile(false);
    window.pendingAvatarUrl = null;
    
    // Refresh local cache and UI
    const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    userProfile = updatedProfile;
    
    await loadUserActivity();
    updateAuthUI(); // Update header too
  }
};

async function fetchParticipationLog() {
  if (!isAdmin) return;
  
  try {
    // Fetch everything in parallel since automatic joins are failing due to missing schema FKs
    const [proposalsRes, votesRes, ratingsRes, profilesRes] = await Promise.all([
      supabase.from('movies').select('title, created_at, proposed_by, tmdb_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('votes').select('created_at, user_id, movie_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('user_ratings').select('created_at, rating, user_id, movie_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('profiles').select('id, full_name, email')
    ]);

    if (profilesRes.error) throw profilesRes.error;

    // Create a quick lookup map for profiles and movies
    const profileMap = {};
    (profilesRes.data || []).forEach(p => profileMap[p.id] = p);

    // We also need movie data for lookup
    const allMovies = [...proposedMovies, ...seenMovies];
    const movieLookup = {};
    allMovies.forEach(m => movieLookup[m.id] = { title: m.title, tmdb_id: m.tmdb_id });

    let logItems = [];

    // Process Proposals
    if (proposalsRes.data) {
      proposalsRes.data.forEach(p => {
        const prof = profileMap[p.proposed_by];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: '<span class="action-tag proposal">Proposed</span>',
          points: '+5',
          movieTitle: p.title,
          tmdbId: p.tmdb_id,
          date: new Date(p.created_at)
        });
      });
    }

    // Process Votes
    if (votesRes.data) {
      votesRes.data.forEach(v => {
        const prof = profileMap[v.user_id];
        const mData = movieLookup[v.movie_id];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: '<span class="action-tag vote">Voted</span>',
          points: '+1',
          movieTitle: mData?.title || 'Unknown Movie',
          tmdbId: mData?.tmdb_id,
          date: new Date(v.created_at)
        });
      });
    }

    // Process Ratings
    if (ratingsRes.data) {
      ratingsRes.data.forEach(r => {
        const prof = profileMap[r.user_id];
        const mData = movieLookup[r.movie_id];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: `<span class="action-tag rating">Rated (${r.rating}/10)</span>`,
          points: '+3',
          movieTitle: mData?.title || 'Unknown Movie',
          tmdbId: mData?.tmdb_id,
          date: new Date(r.created_at)
        });
      });
    }

    // Sort combined log by date descending
    logItems.sort((a, b) => b.date - a.date);
    
    // Take top 40 recent actions
    const recentItems = logItems.slice(0, 40);

    if (recentItems.length === 0) {
      adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-secondary);">No recent activity recorded.</td></tr>`;
      return;
    }

    adminParticipationLog.innerHTML = recentItems.map(item => {
      const name = item.user;
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      const movieLink = item.tmdbId ? `https://www.themoviedb.org/movie/${item.tmdbId}` : null;
      
      const movieDisplay = movieLink 
        ? `<a href="${movieLink}" target="_blank" class="movie-title-cell link">${item.movieTitle}</a>`
        : `<span class="movie-title-cell">${item.movieTitle}</span>`;

      return `
        <tr>
          <td>
            <div class="user-cell">
              <img src="${avatar}" alt="${name}">
              <span class="user-name">${name}</span>
            </div>
          </td>
          <td>${item.action}</td>
          <td>${movieDisplay}</td>
          <td><span class="points-badge">${item.points}</span></td>
          <td><span class="user-date">${item.date.toLocaleString()}</span></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--error);">Failed to load participation log. Check console for details.</td></tr>`;
  }
}

async function updateGlobalRanking() {
  try {
    const [profilesRes, votesRes, moviesRes, ratingsRes, participationRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('votes').select('user_id, movie_id, movies(is_seen)'),
      supabase.from('movies').select('proposed_by, is_dropped, is_seen'),
      supabase.from('user_ratings').select('user_id'),
      supabase.from('participation_log').select('user_id, action_type')
    ]);
    
    if (profilesRes.error) throw profilesRes.error;
    // Exclude admins from the competitive ranking
    const profiles = (profilesRes.data || []).filter(p => p.role !== 'admin');
    const votes = votesRes.data || [];
    const allMoviesList = moviesRes.data || [];
    const ratings = ratingsRes.data || [];
    const attendance = (participationRes.data || []).filter(p => p.action_type === 'attendance');

    // Calculate activity per user
    const userStats = {};
    profiles.forEach(p => {
      userStats[p.id] = { 
        votesNormal: 0, 
        votesSeen: 0, 
        proposalsActive: 0, 
        proposalsDropped: 0, 
        seenProposals: 0,
        ratings: 0,
        sessionsCount: 0,
        achievementsCount: 0,
        achievementPoints: 0
      };
    });

    votes.forEach(v => {
      if (!userStats[v.user_id]) return;
      if (v.movies?.is_seen) userStats[v.user_id].votesSeen++;
      else userStats[v.user_id].votesNormal++;
    });

    allMoviesList.forEach(m => {
      if (!userStats[m.proposed_by]) return;
      if (m.is_dropped) {
        userStats[m.proposed_by].proposalsDropped++;
      } else {
        userStats[m.proposed_by].proposalsActive++;
        if (m.is_seen) userStats[m.proposed_by].seenProposals++;
      }
    });

    ratings.forEach(r => {
      if (userStats[r.user_id]) userStats[r.user_id].ratings++;
    });

    attendance.forEach(a => {
      if (userStats[a.user_id]) userStats[a.user_id].sessionsCount++;
    });

    // Calculate Achievements for each user
    (profiles || []).forEach(p => {
      const stats = userStats[p.id];
      if (!stats) return;

      const earnedAchievements = ACHIEVEMENT_LIST.filter(def => {
        if (def.type === 'static') return true;
        if (def.type === 'ratings') return (stats.ratings || 0) >= def.target;
        if (def.type === 'attendance') return (stats.sessionsCount || 0) >= def.target;
        if (def.type === 'visionary') return (stats.seenProposals || 0) >= def.target;
        if (def.type === 'streak') return (stats.sessionsCount || 0) >= 3; 
        return false;
      });
      stats.achievementsCount = earnedAchievements.length;
      stats.achievementPoints = earnedAchievements.reduce((sum, ach) => sum + (ach.points || 0), 0);
    });

    // Final Score Calculation
    (profiles || []).forEach(p => {
      const s = userStats[p.id];
      if (!s) { p.score = 0; return; }
      p.score = (s.proposalsActive * 5) + 
                (s.proposalsDropped * 1) + 
                (s.votesNormal * 1) + 
                (s.votesSeen * 2) + 
                (s.ratings * 3) + 
                (s.achievementPoints);
    });

    // Sort by score descending
    profiles.sort((a, b) => b.score - a.score);
    
    // Assign Rank
    profiles.forEach((p, idx) => {
      p.rank = idx + 1;
    });

    rankedUsers = profiles;
    
    // Update current user profile cache with new rank and score
    if (user && userProfile) {
      const me = rankedUsers.find(u => u.id === user.id);
      if (me) {
        userProfile.rank = me.rank;
        userProfile.score = me.score;
        updateAuthUI(); // Keep header in sync
      }
    }

    renderRankingView();
  } catch (err) {
    console.error('Error updating global ranking:', err);
  }
}

function renderRankingView() {
  AdminView.renderRankingView(rankedUsers, rankingList);
  if (window.lucide) window.lucide.createIcons();
}

async function fetchUserList() {
  try {
    const profiles = await AdminService.fetchAllProfiles();
    // Re-calculate ranks and scores locally for display consistency
    // (This logic could eventually move to the store/state layer)
    AdminView.renderUserList(rankedUsers, adminUserList, adminUserCount, user);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching user list:', err);
  }
}

// Attendance Logic
window.toggleCheckinDropdown = (userId) => {
  const dropdown = document.getElementById(`checkin-${userId}`);
  const allDropdowns = document.querySelectorAll('.checkin-dropdown');
  
  // Close others
  allDropdowns.forEach(d => { if (d.id !== `checkin-${userId}`) d.classList.remove('active'); });

  if (dropdown.classList.contains('active')) {
    dropdown.classList.remove('active');
  } else {
    // Populate with seen movies
    const sessions = [...seenMovies].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    
    if (sessions.length === 0) {
      dropdown.innerHTML = '<div style="padding:0.5rem; font-size:0.7rem; color:var(--text-secondary);">No sessions available. Mark a movie as "Seen" first.</div>';
    } else {
      dropdown.innerHTML = sessions.map(m => `
        <button class="checkin-option" onclick="window.markAttendance('${userId}', '${m.id}')">
          <i data-lucide="play"></i> ${m.title}
        </button>
      `).join('');
    }
    
    dropdown.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  }
};

window.markAttendance = async (userId, movieId) => {
  if (!isAdmin) return;

  try {
    showNotification('Recording attendance...', 'info');
    
    // Check if already attended
    const { data: existing } = await supabase
      .from('participation_log')
      .select('*')
      .eq('user_id', userId)
      .eq('movie_id', movieId)
      .eq('action_type', 'attendance')
      .single();
    
    if (existing) {
      showNotification('User already checked-in for this session.', 'warning');
      return;
    }

    const { error } = await supabase.from('participation_log').insert([{
      user_id: userId,
      movie_id: movieId,
      action_type: 'attendance',
      points: 10
    }]);

    if (error) throw error;

    showNotification('Attendance recorded! (+10 pts)', 'success');
    
    // Auto-refresh UI
    const dropdown = document.getElementById(`checkin-${userId}`);
    if (dropdown) dropdown.classList.remove('active');
    
    refreshData();
    
  } catch (err) {
    console.error('Error marking attendance:', err);
    showNotification('Failed to record attendance.', 'error');
  }
};

window.confirmDeleteUser = async (userId, userName) => {
  if (!isAdmin) return;
  
  const confirmed = window.confirm(`⚠️ DANGER ZONE: Are you sure you want to delete user "${userName}"? \n\nThis will also remove all their movie proposals, votes and ratings. This action cannot be undone.`);
  if (!confirmed) return;

  try {
    showNotification(`Deleting user ${userName}...`, 'warning');
    // 1. Delete user's votes (Standard table: votes)
    console.log(' - Cleaning votes...');
    await supabase.from('votes').delete().eq('user_id', userId);
    
    // 2. Delete user's ratings (stars on seen movies)
    console.log(' - Cleaning user_ratings...');
    await supabase.from('user_ratings').delete().eq('user_id', userId);

    // 3. Delete user's participation logs (points and attendance history)
    console.log(' - Cleaning participation_log...');
    await supabase.from('participation_log').delete().eq('user_id', userId);
    
    // 5. Delete user's movie proposals
    console.log(' - Cleaning movie proposals...');
    const { error: e5 } = await supabase.from('movies').delete().eq('proposed_by', userId);
    if (e5) console.error('Error cleaning movies:', e5);
    
    // 6. Finally, delete user's profile
    console.log(' - Deleting profile record...');
    const { error: profileError } = await supabase.from('profiles').delete().eq('id', userId);
    
    if (profileError) {
      console.error('CRITICAL: Error deleting profile:', profileError);
      throw profileError;
    }

    console.log(`[Admin] User ${userName} successfully removed from the system.`);
    showNotification(`User ${userName} and all their data have been removed.`, 'success');
    
    // Refresh UI
    await updateGlobalRanking();
    await fetchUserList();
    await fetchParticipationLog();
    await refreshData();
  } catch (err) {
    console.error('Error deleting user:', err);
    showNotification(`Error: ${err.message || 'System error deleting user'}`, 'error');
  }
};

window.unmarkAsSeen = async (movieId) => {
  if (!isAdmin) return;
  const { error } = await supabase.from('movies').update({ is_seen: false }).eq('id', movieId);
  if (error) {
    console.error('Error unmarking as seen:', error);
    showNotification('Failed to revert status', 'error');
  } else {
    showNotification('Movie moved back to proposals', 'success');
    await refreshData();
  }
};

function renderActivityGrid(movies) {
  ProfileView.renderActivityGrid(movies, profileActivityGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

// TMDB Search Logic
let searchTimeout;
async function searchTMDB(query) {
  if (!user || !query) {
    searchResults.classList.remove('active');
    return;
  }

  try {
    const data = await invokeTMDBCall('/search/movie', { query, include_adult: 'false' });
    

    // No restrictive filtering - just sort by popularity (desc) and take top 20
    const results = (data.results || [])
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20);

    const enrichedResults = await Promise.all(results.map(async movie => {
      try {
        const creditsData = await invokeTMDBCall(`/movie/${movie.id}/credits`);
        const directors = creditsData.crew
          .filter(person => person.job === 'Director')
          .map(d => d.name)
          .join(', ');
        
        // Map genres
        const genreNames = movie.genre_ids.map(id => genreMap[id]).filter(Boolean);

        return { ...movie, director: directors || 'Unknown Director', genres: genreNames, synopsis: movie.overview };
      } catch (e) {
        return { ...movie, director: 'Unknown Director', genres: [], synopsis: movie.overview };
      }
    }));

    renderSearchResults(enrichedResults);
  } catch (err) {
    console.error('TMDB Search error:', err);
  }
}

// Explore Logic
async function fetchExploreResults() {
  const query = document.getElementById('exploreTitle').value.trim();
  const directorName = document.getElementById('exploreDirector').value.trim();
  const actorName = document.getElementById('exploreActor').value.trim();
  const genreId = exploreGenreSelect.value;
  const yearFrom = document.getElementById('exploreYearFrom').value;
  const yearTo = document.getElementById('exploreYearTo').value;
  const limitValue = document.getElementById('exploreLimit').value;
  const sortValue = document.getElementById('exploreSort').value;
  const providerId = document.getElementById('exploreProvider').value;
  const limit = parseInt(limitValue) || 20;

  exploreGrid.innerHTML = '<div class="loading-state">Scanning the cinematic multiverse...</div>';

  let discoverParams = {
    sort_by: sortValue || 'popularity.desc',
    include_adult: 'false',
    'vote_count.gte': 10 
  };

  if (genreId) discoverParams.with_genres = genreId;
  if (yearFrom) discoverParams['primary_release_date.gte'] = `${yearFrom}-01-01`;
  if (yearTo) discoverParams['primary_release_date.lte'] = `${yearTo}-12-31`;
  
  if (providerId) {
    discoverParams.with_watch_providers = providerId;
    discoverParams.watch_region = 'ES';
    discoverParams.with_watch_monetization_types = 'flatrate|free|ads';
  }

  try {
    let results = [];
    let directorId = null;
    let actorId = null;
    
    // 1. Resolve Person IDs
    if (directorName || actorName) {
      const personRequests = [];
      if (directorName) personRequests.push(invokeTMDBCall('/search/person', { query: directorName }));
      if (actorName) personRequests.push(invokeTMDBCall('/search/person', { query: actorName }));
      
      const [directorRes, actorRes] = await Promise.all([
        directorName ? invokeTMDBCall('/search/person', { query: directorName }) : null,
        actorName ? invokeTMDBCall('/search/person', { query: actorName }) : null
      ]);

      if (directorRes?.results?.length > 0) {
        // Prioritize people in the 'Directing' department
        let directors = directorRes.results.filter(p => p.known_for_department === 'Directing');
        let bestDirector = directors.length > 0 ? directors : directorRes.results;
        directorId = bestDirector.sort((a,b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_crew = directorId;
      }
      if (actorRes?.results?.length > 0) {
        // Prioritize people in the 'Acting' department
        let actors = actorRes.results.filter(p => p.known_for_department === 'Acting');
        let bestActor = actors.length > 0 ? actors : actorRes.results;
        actorId = bestActor.sort((a,b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_cast = actorId;
      }
    }

    // 2. Fetch Results
    if (query && !directorId && !actorId) {
      // Title search only
      const pagesToFetch = Math.max(1, Math.ceil(limit / 20));
      const pages = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) => 
          invokeTMDBCall('/search/movie', { query, page: i + 1 })
        )
      );
      results = pages.flatMap(p => p.results || []);
    } else {
      // Discover (supports combinations of Director, Actor, Genre, Year, Provider)
      const pagesToFetch = Math.max(1, Math.min(5, Math.ceil(limit / 20)));
      const responses = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) => 
          invokeTMDBCall('/discover/movie', { ...discoverParams, page: i + 1 })
        )
      );
      results = responses.flatMap(r => r.results || []);
    }

    // Secondary client-side title filter if Title + Person were provided
    if (query && (directorId || actorId)) {
      results = results.filter(m => normalize(m.title).includes(normalize(query)));
    }

    // 3. Final Enrichment & Detail Fetching (More resilient batching)
    const finalResults = results.slice(0, limit);
    const enriched = [];
    
    // Process in small chunks to avoid hanging the server
    for (let i = 0; i < finalResults.length; i += 5) {
      const chunk = finalResults.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(async movie => {
        try {
          const details = await invokeTMDBCall(`/movie/${movie.id}`, {
            append_to_response: 'videos,watch/providers,credits'
          });
          
          const directors = details.credits?.crew
            ?.filter(p => p.job === 'Director')
            .map(d => d.name) || [];
          const movieGenres = details.genres?.map(g => g.name) || [];
          const trailer = details.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          
          return {
            ...movie,
            ...details,
            director: directors.join(', ') || 'Unknown Director',
            genres: movieGenres,
            synopsis: details.overview,
            trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            watch_providers: details['watch/providers']?.results?.ES
          };
        } catch (e) {
          console.warn(`[Explore] Failed to enrich ${movie.title}, using basic data.`, e);
          return { ...movie, director: 'Unknown', genres: [], synopsis: movie.overview };
        }
      }));
      enriched.push(...chunkResults);
      // Give the browser a tiny breath
      await new Promise(r => setTimeout(r, 10));
    }

    renderExploreResults(enriched);
  } catch (err) {
    console.error('Explore error:', err);
    exploreGrid.innerHTML = '<div class="empty-state">Discovery session failed. Try adjusting your filters.</div>';
  } finally {
    // If it's still showing the loader, clean it up
    if (exploreGrid.innerHTML.includes('loading-state')) {
      exploreGrid.innerHTML = '<div class="empty-state">Connection timeout. Please try again.</div>';
    }
  }
}

// AI Scout Engine
function shouldUseWebSearch(query) {
  const currentTriggers = ['2025', '2026', 'oscars', 'actualidad', 'estrenos', 'hoy', 'reciente', 'winners', '2027'];
  return currentTriggers.some(t => query.toLowerCase().includes(t));
}

async function fetchAIRecommendations() {
  const query = document.getElementById('aiSearchInput').value;
  if (!query) return;

  const apertureOverlay = document.getElementById('apertureOverlay');
  if (apertureOverlay) apertureOverlay.classList.add('active');

  // Clear previous results
  exploreGrid.innerHTML = ''; 

  const statusText = document.querySelector('.status-text');
  const controller = new AbortController();
  const renderedIds = new Set();
  const renderedTitles = new Set();

  const updateStatus = (msg) => {
    if (statusText) statusText.textContent = msg;
    console.log(`[AI Scout]: ${msg}`);
  };

  // Cancel Logic
  const cancelBtn = document.getElementById('cancelAISearch');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      controller.abort();
      if (apertureOverlay) apertureOverlay.classList.remove('active');
      document.querySelector('.mode-tab[data-mode="manual"]').click();
    };
  }

  try {
    const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const useWeb = shouldUseWebSearch(query);
    
    const prompt = `Today is ${today}. You are the "Cinematic Bible", the world's most erudite and precise movie authority. 
    Analyze the request and provide an extensive list of exactly 40-50 specific movie titles.
    ${useWeb ? "Use your WEB_SEARCH tool to verify recent data/winners." : "Provide results based on your extensive cinematic knowledge."}
    
    FORMAT: Return MANDATORY a JSON array of strings: ["Title 1", "Title 2", ..., "Title 50"]
    USER REQUEST: "${query}"`;

    updateStatus(useWeb ? "Activating Satellite Search..." : "Reasoning with Cinematic Bible...");
    
    // Call Secure AI Edge Function
    const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-scout', {
      body: { query, useWeb }
    });

    if (aiError) throw new Error(`AI Scout Mission Failed: ${aiError.message}`);
    const titles = aiData.titles || [];

    updateStatus("Distilling cinematic knowledge...");
    if (apertureOverlay) apertureOverlay.classList.remove('active');

    // Process in chunks for immediate feedback
    const chunkSize = 5;
    for (let i = 0; i < titles.length; i += chunkSize) {
      if (controller.signal.aborted) break;
      
      const chunk = titles.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(async t => {
        const title = typeof t === 'object' ? (t.title || t.name) : String(t);
        if (renderedTitles.has(title.toLowerCase())) return null;

        try {
          // 1. Search for ID via Proxy
          const searchData = await invokeTMDBCall('/search/movie', { query: title });
          const found = searchData.results?.[0];

          if (found && !renderedIds.has(found.id)) {
            // 2. Fetch Rich Details via Proxy
            const detailData = await invokeTMDBCall(`/movie/${found.id}`, {
              append_to_response: 'videos,watch/providers,credits'
            });
            
            renderedIds.add(detailData.id);
            renderedTitles.add(title.toLowerCase());
            
            const directors = detailData.credits?.crew?.filter(p => p.job === 'Director').map(d => d.name).join(', ') || 'Unknown';
            const genreNames = (detailData.genres || []).map(g => g.name);
            
            const trailer = detailData.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
            const providers = detailData['watch/providers']?.results?.ES;

            return { 
              ...detailData, 
              director: directors, 
              genres: genreNames, 
              synopsis: detailData.overview,
              trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
              watch_providers: providers,
              poster_path: detailData.poster_path,
              vote_average: detailData.vote_average,
              release_date: detailData.release_date
            };
          }
        } catch (e) { console.error('AI Detail Fetch Error:', e); return null; }
        return null;
      }));

      // Append valid results
      chunkResults.filter(Boolean).forEach(movie => {
        const card = createExploreCard(movie);
        exploreGrid.insertBefore(card, document.getElementById('scoutLoader'));
      });

      if (i === 0) {
        exploreGrid.innerHTML += `
          <div id="scoutLoader" class="scout-loader">
            <div class="scout-ring"></div>
            <div class="scout-loading-text">Discovery in progress...</div>
          </div>`;
      }
      if (window.lucide) window.lucide.createIcons();
    }

    const finalLoader = document.getElementById('scoutLoader');
    if (finalLoader) finalLoader.remove();

  } catch (err) {
    if (apertureOverlay) apertureOverlay.classList.remove('active');
    if (err.name === 'AbortError') return;
    
    exploreGrid.innerHTML = ''; 
    console.error('AI Scout error:', err);
    exploreGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-circle" style="width:48px; height:48px; color:#f87171; margin-bottom:1rem;"></i>
        <p>The AI Scout reached its limits.</p>
        <p style="font-size: 0.85rem; color: #94a3b8;">${err.message}</p>
        <button class="auth-btn" style="margin-top:1.5rem;" onclick="window.fetchAIRecommendations()">Retry Scout</button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

function createExploreCard(movie) {
  const div = document.createElement('div');
  div.innerHTML = createMovieCardHTML(movie, { 
      context: 'explore',
      isAdmin,
      user,
      userVotes
    });
  return div.firstElementChild;
}

function renderExploreResults(results) {
  exploreGrid.innerHTML = '';
  ExploreView.renderResults(results, exploreGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-result-item">No movies found</div>';
  } else {
    searchResults.innerHTML = results.map(movie => `
      <div class="search-result-item" onclick="window.proposeMovie(${JSON.stringify(movie).replace(/"/g, '&quot;')})">
        <img class="result-poster" src="${movie.poster_path ? 'https://image.tmdb.org/t/p/w92' + movie.poster_path : FALLBACK_IMAGE}">
        <div class="result-info">
          <div class="result-title">${movie.title}</div>
          <div class="result-meta">
            <span>${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'}</span>
            <span style="color: rgba(255,255,255,0.2);">•</span>
            <div class="rating-badge" style="margin:0; padding:0; background:transparent; border:none; font-size: 0.75rem;">
              <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
              <span style="color:#fbbf24;">${formatScore(movie.vote_average)}</span>
            </div>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">${movie.director}</div>
        </div>
      </div>
    `).join('');
  }
  searchResults.classList.add('active');
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
  const { data: existing, error: checkError } = await supabase
    .from('movies')
    .select('*')
    .eq('tmdb_id', tmdbMovie.id)
    .single();

  if (existing && existing.is_dropped) {
    if (confirm(`"${tmdbMovie.id}" is currently in the Cinema Cemetery. Do you want to rescue it and bring it back to active proposals?`)) {
      const { error: rescueError } = await supabase
        .from('movies')
        .update({ is_dropped: false, proposed_by: user.id })
        .eq('id', existing.id);
      
      if (!rescueError) {
        showNotification(`"${tmdbMovie.title}" has been rescued from the cemetery!`, 'success');
        refreshData();
        return;
      }
    } else {
      return; // User cancelled rescue
    }
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
    synopsis: tmdbMovie.synopsis
  };

  // Insert logic matching actual schema
  let { data, error } = await supabase.from('movies').insert([{
    ...payload,
    average_rating: tmdbMovie.vote_average || 0,
    vote_count: 0 // Start with zero festival votes
  }]).select();

  if (error) {
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
  } else {
    showNotification(`"${tmdbMovie.title}" proposed!`, 'success');

    // Automatically add user's vote to their own proposal
    try {
      if (data && data[0]) {
        await supabase.from('votes').insert([{ user_id: user.id, movie_id: data[0].id }]);
      }
    } catch (vErr) {
      console.error('Auto-vote failed:', vErr);
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
    const { error } = await supabase.from('votes').delete().match({ user_id: user.id, movie_id: movieId });
    if (!error) {
      userVotes.delete(movieId);
      movie.vote_count = (movie.vote_count || 1) - 1;
      if (btn) btn.classList.remove('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  } else {
    // Check vote limits
    console.log(`[Vote] User Votes: ${userVotes.size} / ${MAX_VOTES} | Admin: ${isAdmin}`);
    
    if (userVotes.size >= MAX_VOTES && !isAdmin) {
      showNotification(`You've run out of votes! You have already used your ${MAX_VOTES} available votes. Remove a vote from another movie if you want to support this new proposal.`, 'warning');
      return;
    }

    // Vote
    const { error } = await supabase.from('votes').insert([{ user_id: user.id, movie_id: movieId }]);
    if (!error) {
      userVotes.add(movieId);
      movie.vote_count = (movie.vote_count || 0) + 1;
      if (btn) btn.classList.add('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  }
  updateAuthUI();
};

window.markAsSeen = async (movieId) => {
  const { error } = await supabase.from('movies').update({ is_seen: true }).eq('id', movieId);
  if (error) console.error('Error marking as seen:', error);
  else await refreshData();
};

window.rateMovie = async (movieId, rating) => {
  if (!user) return;
  
  // Update state for immediate feedback
  const movie = seenMovies.find(m => m.id === movieId);
  if (movie) movie.user_rating = rating;

  const { error } = await supabase
    .from('user_ratings')
    .upsert({ 
      movie_id: movieId, 
      user_id: user.id, 
      rating: parseInt(rating) 
    }, { onConflict: 'movie_id,user_id' });

  if (error) {
    console.error('Error rating movie:', error);
    showNotification('Error saving rating', 'error');
  } else {
    showNotification('Rating saved!', 'success');
    // Instant UI update
    syncLocalRating(movieId, rating);
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${rating} / 10`;
    
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    if (container) {
      container.setAttribute('onmouseleave', `window.resetStars('${movieId}', ${rating})`);
    }
    
    // Refresh the star visuals
    window.resetStars(movieId, rating);
    
    // Update community average
    await updateCommunityAverage(movieId);
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

function setupEventListeners() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    await checkUser(session);
    refreshData();
  });

  window.addEventListener('hashchange', handleRouting);

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchTMDB(e.target.value), 500);
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
  return AchievementService.calculateGlobalStats(proposedMovies);
}

async function renderHomeAchievements() {
  const grid = document.getElementById('homeAchievementsGrid');
  if (!grid) return;
  const stats = await calculateGlobalAchievementStats();
  HomeView.renderHomeAchievements(stats, grid, ACHIEVEMENT_LIST);
  if (window.lucide) window.lucide.createIcons();
}

async function renderProfileAchievements(userId) {
  const grid = document.getElementById('profileAchievementsGrid');
  if (!grid) return;
  const achievements = await calculateUserAchievements(userId || user?.id);
  ProfileView.renderAchievements(achievements, grid);
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

/* --- Session System Logic --- */

async function fetchSessions() {
  try {
    sessions = await SessionService.fetchAll();
  } catch (err) {
    console.error('Error fetching sessions:', err);
  }
}

function renderSessions() {
  SessionsView.renderSessions(sessions, sessionsGrid, { user });
  if (window.lucide) window.lucide.createIcons();
}

function renderNextSessionHero() {
  const upcoming = sessions
    .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];

  HomeView.renderNextSessionHero(upcoming, nextSessionHero, { user });
  if (window.lucide) window.lucide.createIcons();
}

window.viewSessionDetails = async (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  currentSession = session;
  sessionModal.classList.remove('page-hidden');
  document.body.style.overflow = 'hidden';

  try {
    const details = await SessionService.fetchDetails(sessionId);
    sessionModalBody.innerHTML = SessionsView.renderDetail(session, details, { user, isAdmin });
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching session details:', err);
  }
};



window.closeSessionModal = () => {
  sessionModal.classList.add('page-hidden');
  document.body.style.overflow = '';
};

window.switchSessionTab = async (tab) => {
  const btns = document.querySelectorAll('.session-tab-btn');
  btns.forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(tab)));

  const content = document.getElementById('sessionTabContent');
  
  if (tab === 'comments') {
    const { data } = await supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
    content.innerHTML = SessionsView.renderCommentsHTML(data || []);
  } else if (tab === 'photos') {
    const { data } = await supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
    content.innerHTML = SessionsView.renderGalleryHTML(data || []);
  } else if (tab === 'participants') {
    const isUpcoming = currentSession.is_upcoming;
    const table = isUpcoming ? 'session_signups' : 'session_attendance';
    const { data } = await supabase.from(table).select('*, profiles(full_name)').eq('session_id', currentSession.id);
    content.innerHTML = SessionsView.renderParticipantsHTML(data || [], isUpcoming);
  }
  
  if (window.lucide) window.lucide.createIcons();
};

window.signupForSession = async (sessionId) => {
  if (!user) {
    showNotification('Please log in to sign up!', 'error');
    return;
  }

  try {
    const res = await SessionService.toggleSignup(sessionId, user.id);
    showNotification(res.action === 'added' ? 'You are now signed up!' : 'Signup removed.');
    
    // Refresh
    await fetchSessions();
    renderSessions();
    if (currentSession?.id === sessionId) window.viewSessionDetails(sessionId);
  } catch (err) {
    console.error('Error signing up:', err);
    showNotification('Action failed.', 'error');
  }
};

window.addSessionComment = async () => {
  const input = document.getElementById('sessionCommentInput');
  const content = input?.value.trim();
  if (!content || !user || !currentSession) return;

  try {
    await SessionService.addComment(currentSession.id, user.id, content);
    input.value = '';
    showNotification('Comment added!');
    window.switchSessionTab('comments');
  } catch (err) {
    console.error('Error adding comment:', err);
  }
};

window.addSessionPhoto = async () => {
  const url = window.prompt("Enter photo URL (implementing full upload in Supabase Storage requires more setup, so for now we use URLs):");
  if (!url || !user || !currentSession) return;

  try {
    await SessionService.addPhoto(currentSession.id, user.id, url);
    showNotification('Photo added to gallery!');
    window.switchSessionTab('photos');
  } catch (err) {
    console.error('Error adding photo:', err);
  }
};

/* --- Admin Session Logic --- */

window.showCreateSessionModal = () => {
  createSessionModal.classList.remove('page-hidden');
  
  // Reset form
  document.getElementById('sessionMovieSelect').value = "";
  document.getElementById('sessionDate').value = "";
  document.getElementById('sessionDescription').value = "";

  // Fill movie select with proposed movies
  sessionMovieSelect.innerHTML = `
    <option value="">-- To Be Decided --</option>
    ${proposedMovies.map(m => `
      <option value="${m.id}">${m.title}</option>
    `).join('')}
  `;
};

window.closeCreateSessionModal = () => {
  createSessionModal.classList.add('page-hidden');
};

window.handleCreateSession = async () => {
  const movieId = sessionMovieSelect.value;
  const date = document.getElementById('sessionDate').value;
  const desc = document.getElementById('sessionDescription').value;
  const keywordInput = document.getElementById('sessionKeyword');
  const keyword = keywordInput ? keywordInput.value.trim() : '';

  console.log('[Admin] Creating session:', { date, keyword });

  if (!date) {
    showNotification('Date is required', 'error');
    return;
  }

  const { error } = await supabase.from('sessions').insert([{
    movie_id: movieId || null,
    session_date: new Date(date).toISOString(),
    description: desc,
    keyword: keyword,
    is_upcoming: true
  }]);

  if (!error) {
    showNotification('Session created successfully!');
    window.closeCreateSessionModal();
    refreshData();
  } else {
    showNotification('Error creating session', 'error');
  }
};

async function updateAdminSessions() {
  if (!isAdmin || !adminSessionsList) return;

  adminSessionsList.innerHTML = sessions.map(session => {
    const title = session.movie_id ? session.movies?.title : 'TBD';
    
    return `
      <div class="admin-session-item">
        <div>
          <div style="font-weight:700;">${title}</div>
          <div style="font-size:0.8rem; opacity:0.6;">${new Date(session.session_date).toLocaleString()}</div>
        </div>
        <div class="admin-session-actions">
          <button class="btn-admin-action" onclick="window.showEditSessionModal('${session.id}')" title="Edit Session">
            <i data-lucide="edit"></i>
          </button>
          <button class="btn-admin-action" onclick="window.manageAttendance('${session.id}')" title="Mark Attendance">
            <i data-lucide="users"></i>
          </button>
          <button class="btn-admin-action delete" onclick="window.handleDeleteSession('${session.id}')" title="Delete Session">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.handleDeleteSession = async (sessionId) => {
  if (!confirm('Are you sure you want to delete this session?')) return;

  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (!error) {
    showNotification('Session deleted');
    refreshData();
  }
};

window.manageAttendance = async (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  const { data: signups } = await supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId);
  const { data: attendance } = await supabase.from('session_attendance').select('user_id').eq('session_id', sessionId);
  
  const attendedSet = new Set(attendance?.map(a => a.user_id) || []);

  const html = `
    <div style="padding: 2rem;">
      <h3>Attendance: ${session.movies?.title}</h3>
      <p style="margin-bottom: 2rem;">Confirm who actually attended the session.</p>
      
      <div style="display:grid; gap:1rem;">
        ${signups?.length ? signups.map(s => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem;">
            <span>${s.profiles.full_name}</span>
            <button class="btn-signup-hero ${attendedSet.has(s.user_id) ? 'success' : 'secondary'}" 
                    style="padding:0.5rem 1rem; font-size:0.8rem;"
                    onclick="window.toggleAttendance('${sessionId}', '${s.user_id}', this)">
              ${attendedSet.has(s.user_id) ? 'Confirmed' : 'Confirm Attendance'}
            </button>
          </div>
        `).join('') : '<p>No signups for this session yet.</p>'}
      </div>
      
      <button class="submit-btn" style="margin-top:2rem;" onclick="window.closeSessionModal()">Done</button>
    </div>
  `;

  sessionModalBody.innerHTML = html;
  sessionModal.classList.remove('page-hidden');
};

window.toggleAttendance = async (sessionId, userId, btn) => {
  const isConfirmed = btn.classList.contains('success');

  if (isConfirmed) {
    await supabase.from('session_attendance').delete().match({ session_id: sessionId, user_id: userId });
    btn.classList.remove('success');
    btn.classList.add('secondary');
    btn.textContent = 'Confirm Attendance';
  } else {
    await supabase.from('session_attendance').insert([{ session_id: sessionId, user_id: userId }]);
    btn.classList.remove('secondary');
    btn.classList.add('success');
    btn.textContent = 'Confirmed';
    
    const session = sessions.find(s => s.id === sessionId);
    const logData = {
      user_id: userId,
      action_type: "attendance",
      points: 50
    };
    if (session.movie_id) logData.movie_id = session.movie_id;
    await supabase.from("participation_log").insert([logData]);
  }
};
window.showEditSessionModal = (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  currentSession = session;
  createSessionModal.classList.remove('page-hidden');
  
  // Fill movie select
  sessionMovieSelect.innerHTML = `
    <option value="">-- To Be Decided --</option>
    ${proposedMovies.map(m => `
      <option value="${m.id}" ${m.id === session.movie_id ? 'selected' : ''}>${m.title}</option>
    `).join('')}
    ${session.movie_id && !proposedMovies.some(m => m.id === session.movie_id) ? `
      <option value="${session.movie_id}" selected>${session.movies?.title}</option>
    ` : ''}
  `;

  // Pre-fill date (convert ISO to datetime-local format)
  const date = new Date(session.session_date);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('sessionDate').value = localDate;
  
  document.getElementById('sessionDescription').value = session.description || '';
  const kwInput = document.getElementById('sessionKeyword');
  if (kwInput) kwInput.value = session.keyword || '';
  
  // Update button text
  const submitBtn = createSessionModal.querySelector('.submit-btn');
  submitBtn.textContent = 'Update Session';
  submitBtn.onclick = () => window.handleUpdateSession(sessionId);
  
  createSessionModal.querySelector('h2').textContent = 'Edit Session';
};

window.handleUpdateSession = async (sessionId) => {
  const movieId = sessionMovieSelect.value;
  const date = document.getElementById('sessionDate').value;
  const desc = document.getElementById('sessionDescription').value;
  const keyword = document.getElementById('sessionKeyword').value.trim();

  if (!date) {
    showNotification('Date is required', 'error');
    return;
  }

  const { error } = await supabase.from('sessions').update({
    movie_id: movieId || null,
    session_date: new Date(date).toISOString(),
    description: desc,
    keyword: keyword
  }).eq('id', sessionId);

  if (!error) {
    showNotification('Session updated successfully!');
    window.closeCreateSessionModal();
    refreshData();
  } else {
    showNotification('Error updating session', 'error');
  }
};

init();

// renderCemetery removed (now handled by HomeView)

window.cleanupInactiveMovies = async (silent = false) => {
  if (!isAdmin) return;
  if (!silent) showNotification('Checking for inactive movies...', 'info');
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  const { data: moviesToClean, error: fetchErr } = await supabase
    .from('movies')
    .select('id, title, created_at, vote_count, is_dropped, is_seen')
    .eq('is_dropped', false)
    .eq('is_seen', false);
  if (fetchErr || !moviesToClean) return;
  const { data: allVotes, error: votesErr } = await supabase
    .from('votes')
    .select('movie_id, created_at');
  if (votesErr) return;
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
    if (!silent) showNotification('All movies are active!', 'success');
    return;
  }
  const ids = toDrop.map(m => m.id);
  const { error: updateErr } = await supabase
    .from('movies')
    .update({ is_dropped: true })
    .in('id', ids);
  if (!updateErr) {
    if (!silent) showNotification(`Cleaned up ${toDrop.length} inactive movies`, 'success');
    refreshData();
  }
};

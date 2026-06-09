import { supabase } from '../config/supabase.js';
import { AuthService, MovieService, SessionService } from '../api/index.js';
import { store } from '../state/store.js';
import { ProfileView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { getUserDisplayName } from '../utils/index.js';
import { buildUserScoreStatsMap, buildUserPointsAudit, createEmptyScoreStats } from './RankingController.js';
import { fetchParticipationLog, fetchUserList } from './AdminController.js';

export function updateAuthUI() {
  const { user, userProfile, isAdmin, userVotes, proposedMovies, maxProposals: MAX_PROPOSALS, maxVotes: MAX_VOTES } = store.getState();

  const userHeader = document.getElementById('userHeader');
  const searchInput = document.getElementById('movieSearch');
  const searchResults = document.getElementById('searchResults');
  const aiSearchInput = document.getElementById('aiSearchInput');
  const aiSearchBtn = document.getElementById('aiSearchBtn');
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

  if (user) {
    const name = getUserDisplayName(userProfile, user);
    const safeName = escapeHtml(name);
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
	              <span style="font-weight:700;">${safeName}</span>
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
	            <span style="font-weight:700;">${safeName}</span>
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
	        : `Max proposals reached (${MAX_PROPOSALS}/${MAX_PROPOSALS})`;
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

export async function checkUser(session) {
  if (session === undefined) {
    session = await AuthService.getCurrentSession();
  }

  const currentUser = session?.user || null;

  if (currentUser) {
    const displayName = getUserDisplayName(null, currentUser);
    const profile = await AuthService.getOrCreateUserProfile(currentUser, displayName);

    const currentIsAdmin = profile?.role === 'admin';
    store.setState({
      user: currentUser,
      userProfile: profile,
      isAdmin: currentIsAdmin
    });
    console.log(`[ACL] User: ${currentUser.email} | Role: ${profile?.role || 'user'} | Admin: ${currentIsAdmin}`);

    const [votes, attendance] = await Promise.all([
      MovieService.fetchVotesForUser(currentUser.id),
      SessionService.fetchUserAttendance(currentUser.id)
    ]);
    store.setUserVotes(new Set(votes?.map(v => v.movie_id) || []));
    store.setState({ userAttendance: new Set(attendance || []) });
  } else {
    store.setState({
      user: null,
      userProfile: null,
      isAdmin: false
    });
    store.setUserVotes(new Set());
    store.setState({ userAttendance: new Set() });
  }
  updateAuthUI();
}

export function scheduleAuthStateSync(session) {
  const syncId = store.getState().authSyncSequence + 1;
  store.setState({ authSyncSequence: syncId });

  window.setTimeout(async () => {
    try {
      await checkUser(session);
      if (syncId !== store.getState().authSyncSequence) return;
      window.dispatchEvent(new CustomEvent('app:refresh', { detail: { lazy: true } }));
    } catch (error) {
      console.error('Error syncing auth state:', error);
    }
  }, 0);
}

export async function loadUserActivity(targetUserId = null) {
  const { user, isAdmin, maxProposals: MAX_PROPOSALS, maxVotes: MAX_VOTES } = store.getState();
  const profileAuditMode = store.getState().profileAuditMode;

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
  const editName = document.getElementById('editName');

  if (!user && !targetUserId) return;

  const activeUid = targetUserId || user.id;
  const isAudit = targetUserId && targetUserId !== user?.id;

  // 1. Show skeletons immediately
  ProfileView.renderSkeletonHeader({ profileName, profileEmail, profileAvatar, countProposals, countVotes });
  ProfileView.renderActivitySkeletons(profileActivityGrid);
  ProfileView.renderAchievementSkeletons(document.getElementById('profileAchievementsGrid'));
  if (isAudit && profileAuditMode === 'points') {
    profilePointsAuditSection?.classList.remove('page-hidden');
    ProfileView.renderPointsAuditSkeleton(profilePointsAuditContent);
  } else {
    profilePointsAuditSection?.classList.add('page-hidden');
  }

  // Fetch target profile data from the DB
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', activeUid).single();

  // Remove skeleton class from avatar wrapper once we have the image
  if (profileAvatar) profileAvatar.parentElement.classList.remove('skeleton');

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
    auditBadge.innerHTML = `<i data-lucide="shield-check"></i> Auditing User Profile <button onclick="window.exitUserAudit()">Exit Audit</button>`;
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

  const { data: proposals } = await supabase
    .from('movies')
    .select('*')
    .eq('proposed_by', activeUid)
    .eq('is_dropped', false)
    .eq('is_seen', false);

  const { data: votes } = await supabase
    .from('votes')
    .select('movie_id, movies(*)')
    .eq('user_id', activeUid);

  const activeVotes = (votes || []).filter(vote => vote.movies && !vote.movies.is_dropped && !vote.movies.is_seen);

  const proposalsLimitLabel = Number.isInteger(MAX_PROPOSALS) ? MAX_PROPOSALS : '—';
  const votesLimitLabel = Number.isInteger(MAX_VOTES) ? MAX_VOTES : '—';
  if (countProposals) countProposals.textContent = `${proposals?.length || 0} / ${proposalsLimitLabel}`;
  if (countVotes) countVotes.textContent = `${activeVotes.length || 0} / ${votesLimitLabel}`;

  renderActivityGrid(proposals || []);

  if (isAudit && profileAuditMode === 'points') {
    if (profilePointsAuditSubtitle) {
      const displayName = getUserDisplayName(profile);
      profilePointsAuditSubtitle.textContent = `Detailed score audit for ${displayName}.`;
    }
    await loadProfilePointsAudit(profile);
    profilePointsAuditSection?.classList.remove('page-hidden');
    window.setTimeout(() => {
      profilePointsAuditSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  } else {
    profilePointsAuditSection?.classList.add('page-hidden');
  }

  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.activity-tab.active').classList.remove('active');
      tab.classList.add('active');
      const view = tab.dataset.view;
      renderActivityGrid(view === 'myProposals' ? (proposals || []) : activeVotes.map(v => v.movies));
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

export async function loadProfilePointsAudit(profile) {
  const profilePointsAuditContent = document.getElementById('profilePointsAuditContent');
  if (!profile?.id || !profilePointsAuditContent) return;

  try {
    const [votesRes, moviesRes, ratingsRes, attendanceRes, sessionsRes] = await Promise.all([
      supabase.from('votes').select('user_id, movie_id, movies(id, title, is_dropped)').eq('user_id', profile.id),
      supabase.from('movies').select('id, title, proposed_by, is_dropped, is_seen').eq('proposed_by', profile.id),
      supabase.from('user_ratings').select('user_id, movie_id, movies(title)').eq('user_id', profile.id),
      supabase.from('session_attendance').select('user_id, session_id, sessions(session_date, movie_id, movies(title))').eq('user_id', profile.id),
      supabase.from('sessions').select('id, session_date, movie_id, movies(title)').order('session_date', { ascending: true })
    ]);

    const errors = [votesRes.error, moviesRes.error, ratingsRes.error, attendanceRes.error, sessionsRes.error].filter(Boolean);
    if (errors.length > 0) {
      throw new Error(errors.map(error => error.message || 'Unknown points audit error').join(' | '));
    }

    const attendance = (attendanceRes.data || []).map((entry) => ({
      user_id: entry.user_id,
      session_id: entry.session_id
    }));

    const statsMap = buildUserScoreStatsMap(
      [profile],
      votesRes.data || [],
      moviesRes.data || [],
      ratingsRes.data || [],
      attendance,
      sessionsRes.data || []
    );

    const stats = statsMap[profile.id] || createEmptyScoreStats();
    const audit = buildUserPointsAudit(profile, stats, {
      votes: votesRes.data || [],
      movies: moviesRes.data || [],
      ratings: ratingsRes.data || [],
      attendanceEntries: attendanceRes.data || []
    });

    ProfileView.renderPointsAudit(audit, profilePointsAuditContent);
  } catch (error) {
    console.error('Error loading points audit:', error);
    profilePointsAuditContent.innerHTML = '<div class="empty-state">Failed to load points audit.</div>';
  }
}

function renderActivityGrid(movies) {
  const { isAdmin, user, userVotes } = store.getState();
  const profileActivityGrid = document.getElementById('profileActivityGrid');
  ProfileView.renderActivityGrid(movies, profileActivityGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

async function renderProfileAchievements(userId) {
  const { user } = store.getState();
  const grid = document.getElementById('profileAchievementsGrid');
  if (!grid) return;
  const { AchievementService } = await import('../api/index.js');
  const { sessions } = store.getState();
  const achievements = await AchievementService.calculateUserAchievements(userId || user?.id, sessions);
  ProfileView.renderAchievements(achievements, grid);
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  supabase.auth.onAuthStateChange((event, session) => {
    scheduleAuthStateSync(session);
  });

  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.auth-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').classList.toggle('page-hidden', !isLogin);
      document.getElementById('signupForm').classList.toggle('page-hidden', isLogin);
    };
  });

  window.addEventListener('authui:update', () => updateAuthUI());

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

  window.toggleEditProfile = (show) => {
    const profileDisplay = document.getElementById('profileDisplay');
    const profileEditForm = document.getElementById('profileEditForm');
    if (profileDisplay) profileDisplay.classList.toggle('page-hidden', show);
    if (profileEditForm) profileEditForm.classList.toggle('page-hidden', !show);
  };

  window.saveProfile = async () => {
    const { user, userProfile } = store.getState();
    const editName = document.getElementById('editName');
    const profileAvatar = document.getElementById('profileAvatar');
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
      store.setState({ userProfile: updatedProfile });

      await loadUserActivity();
      updateAuthUI(); // Update header too
    }
  };

  window.viewUserProfile = (userId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    store.setState({ profileAuditMode: 'activity' });
    console.log(`[Admin] Auditing user profile: ${userId}`);
    window.navigateTo('profile', userId);
  };

  window.viewUserPointsAudit = (userId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    store.setState({ profileAuditMode: 'points' });
    console.log(`[Admin] Auditing user points: ${userId}`);
    window.navigateTo('profile', userId);
  };

  window.exitUserAudit = () => {
    store.setState({ profileAuditMode: 'activity' });
    window.navigateTo('profile');
  };
}

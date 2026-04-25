import { supabase } from './config/supabase.js';
import { SessionService } from './api/sessions.js';
import { SessionsView } from './views/SessionsView.js';
import { AuthService } from './api/auth.js';
import { showNotification } from './utils/ui.js';

// Global state for the standalone page
const state = {
  user: null,
  userProfile: null,
  isAdmin: false,
  activeTab: 'comments'
};

let currentSession = null; // Store current session object
let sessionData = null;    // Store detailed session info

async function init() {
  const dismissPreloader = () => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.classList.add('fade-out');
      setTimeout(() => preloader.remove(), 800);
    }
  };

  const container = document.getElementById('sessionContainer');

  try {
    // 1. Auth check (OPTIONAL for viewing)
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      state.user = user;
      state.userProfile = profile;
      state.isAdmin = profile?.role === 'admin';
      updateAuthUI();
    }

    // 2. Fetch "Next" Session Data (Soonest Upcoming)
    const allSessions = await SessionService.fetchAll();
    currentSession = allSessions
      .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
      .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];

    if (!currentSession) {
      container.innerHTML = '<div class="empty-state">No upcoming sessions found.</div>';
      dismissPreloader();
      return;
    }

    sessionData = await SessionService.fetchDetails(currentSession.id);

    // 3. Render Initial Detail
    renderAll();
    
    dismissPreloader();
  } catch (err) {
    console.error('Error loading session:', err);
    container.innerHTML = '<div class="empty-state">Error loading session details.</div>';
    dismissPreloader();
  }
}

window.handleStandaloneLogin = async () => {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const errorEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');

  try {
    submitBtn.disabled = true;
    submitBtn.innerText = 'Signing In...';
    errorEl.classList.add('page-hidden');

    const { data, error } = await AuthService.signInWithEmail(email, password);
    if (error) throw error;

    // Refresh page to apply auth state
    window.location.reload();
  } catch (err) {
    console.error('Login error:', err);
    errorEl.innerText = err.message;
    errorEl.classList.remove('page-hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Sign In';
  }
};

function renderAll() {
  const container = document.getElementById('sessionContainer');
  if (!container || !currentSession || !sessionData) return;

  container.innerHTML = SessionsView.renderNextSessionPage(currentSession, sessionData, state);
  if (window.lucide) window.lucide.createIcons();
}

function updateAuthUI() {
  if (state.user) {
    const name = state.userProfile?.full_name || state.user.email.split('@')[0];
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
    
    userHeader.innerHTML = `
      <div class="user-profile">
        <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="window.location.href='/?view=sessions'">
          <i data-lucide="calendar" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label">Sessions</span>
        </div>
        <div class="user-profile-info" onclick="window.location.href='/?view=profile'">
          <img src="${avatar}" class="user-avatar" />
          <div class="user-name-wrapper hide-mobile" style="display:flex; flex-direction:column; line-height: 1.2;">
            <span style="font-weight:700;">${name}</span>
            <span style="font-size: 0.7rem; color:var(--text-secondary);">${state.isAdmin ? 'ADMIN' : 'USER'}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    userHeader.innerHTML = `<button class="auth-btn" onclick="window.showLoginModal()">Sign In</button>`;
  }
  if (window.lucide) window.lucide.createIcons();
}

// Wire up global window functions needed by SessionsView
window.switchSessionTab = (tab) => {
  const content = document.getElementById('sessionTabContent');
  if (!content || !sessionData) return;

  const tabs = document.querySelectorAll('.session-tab-btn');
  tabs.forEach(t => t.classList.remove('active'));
  
  const activeBtn = Array.from(tabs).find(t => t.innerText.toLowerCase().includes(tab));
  if (activeBtn) activeBtn.classList.add('active');

  if (tab === 'comments') {
    content.innerHTML = SessionsView.renderCommentsHTML(sessionData.comments);
  } else if (tab === 'photos') {
    content.innerHTML = SessionsView.renderGalleryHTML(sessionData.photos);
  } else if (tab === 'participants') {
    // Show interested (signups) if it's upcoming, otherwise show attendance
    const isUpcoming = currentSession.is_upcoming;
    const participants = isUpcoming ? sessionData.signups : sessionData.attendance;
    content.innerHTML = SessionsView.renderParticipantsHTML(participants || [], isUpcoming);
  }
  
  if (window.lucide) window.lucide.createIcons();
};

// Global override for native alerts to ensure consistent UI
window.alert = (message) => {
  showNotification(message, 'info');
};

window.signupForSession = async (sessionId) => {
  if (!state.user) {
    showNotification('Please sign in to register interest.', 'warning');
    window.showLoginModal();
    return;
  }

  try {
    const res = await SessionService.toggleSignup(sessionId, state.user.id);
    sessionData = await SessionService.fetchDetails(sessionId);
    renderAll();
    
    const msg = res.action === 'added' ? 'You have successfully signed up!' : 'Signup cancelled.';
    showNotification(msg, 'success');
  } catch (err) {
    console.error('Error signing up:', err);
    showNotification('Error processing your signup.', 'error');
  }
};

window.addSessionComment = async () => {
  if (!state.user) {
    showNotification('Sign in to leave a comment.', 'warning');
    window.showLoginModal();
    return;
  }
  
  const input = document.getElementById('sessionCommentInput');
  const content = input?.value.trim();
  
  if (!content) return;

  try {
    await SessionService.addComment(currentSession.id, state.user.id, content);
    sessionData = await SessionService.fetchDetails(currentSession.id);
    window.switchSessionTab('comments');
    showNotification('Comment added successfully!', 'success');
  } catch (err) {
    console.error('Error adding comment:', err);
    showNotification('Error posting your comment.', 'error');
  }
};


window.addSessionPhoto = async (input) => {
  if (!state.user) {
    showNotification('Sign in to upload photos.', 'warning');
    window.showLoginModal();
    return;
  }

  const file = input.files[0];
  if (!file) return;

  try {
    showNotification('Uploading photo...', 'warning');
    
    // Simulate upload or use a real storage service. 
    // In this app, we typically use a URL for simplicity or Supabase Storage.
    // For now, let's assume we use a placeholder or the logic in main.js
    // I'll just show a notification that it's a feature coming soon or use a placeholder.
    const placeholderUrl = 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=800';
    await SessionService.addPhoto(currentSession.id, state.user.id, placeholderUrl);
    
    sessionData = await SessionService.fetchDetails(currentSession.id);
    window.switchSessionTab('photos');
    showNotification('Photo uploaded successfully!', 'success');
  } catch (err) {
    console.error('Error uploading photo:', err);
    showNotification('Error uploading your photo.', 'error');
  }
};

window.toggleAttendance = async (sessionId, userId) => {
  if (!state.isAdmin) return;

  try {
    await SessionService.toggleAttendance(sessionId, userId);
    sessionData = await SessionService.fetchDetails(sessionId);
    window.switchSessionTab('participants');
    showNotification('Attendance status updated.', 'success');
  } catch (err) {
    console.error('Error toggling attendance:', err);
    showNotification('Error updating attendance.', 'error');
  }
};

window.showLoginModal = () => {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('page-hidden');
};

window.hideLoginModal = () => {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.add('page-hidden');
};

window.loginWithGoogle = async () => {
  try {
    await AuthService.signInWithGoogle();
  } catch (err) {
    console.error('Google login error:', err);
    showNotification('Error signing in with Google.', 'error');
  }
};

// Start the page
init();

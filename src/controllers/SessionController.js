import { supabase } from '../config/supabase.js';
import { SessionService } from '../api/index.js';
import { store } from '../state/store.js';
import { SessionsView, HomeView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { getUserDisplayName } from '../utils/index.js';

export async function fetchSessions() {
  const sessionsGrid = document.getElementById('sessionsGrid');
  if (sessionsGrid && (sessionsGrid.innerHTML.trim() === "" || sessionsGrid.querySelector('.empty-state'))) {
    SessionsView.renderSkeletons(sessionsGrid, 3);
  }
  try {
    const sessions = await SessionService.fetchAll();
    store.setState({ sessions });
  } catch (err) {
    console.error('Error fetching sessions:', err);
  }
}

export function renderSessions() {
  const { sessions, user } = store.getState();
  const sessionsGrid = document.getElementById('sessionsGrid');
  SessionsView.renderSessions(sessions, sessionsGrid, { user });
  if (window.lucide) window.lucide.createIcons();
}

export function renderNextSessionHero() {
  const { sessions, user } = store.getState();
  const nextSessionHero = document.getElementById('nextSessionHero');
  const upcoming = sessions
    .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];

  HomeView.renderNextSessionHero(upcoming, nextSessionHero, { user });
  if (window.lucide) window.lucide.createIcons();
}

export function updateAdminSessions() {
  const { sessions, isAdmin } = store.getState();
  const adminSessionsList = document.getElementById('adminSessionsList');
  if (!isAdmin || !adminSessionsList) return;

  adminSessionsList.innerHTML = sessions.map(session => {
    const title = escapeHtml(session.movie_id ? session.movies?.title : 'TBD');

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

function resetSessionModalToCreateMode() {
  const createSessionModal = document.getElementById('createSessionModal');
  const sessionMovieSelect = document.getElementById('sessionMovieSelect');
  const modalTitle = createSessionModal?.querySelector('h2');
  const submitBtn = createSessionModal?.querySelector('.submit-btn');
  const dateInput = document.getElementById('sessionDate');
  const descriptionInput = document.getElementById('sessionDescription');
  const keywordInput = document.getElementById('sessionKeyword');

  if (modalTitle) modalTitle.textContent = 'Create Session';
  if (submitBtn) {
    submitBtn.textContent = 'Create Session';
    submitBtn.onclick = () => window.handleCreateSession();
  }

  if (sessionMovieSelect) sessionMovieSelect.value = '';
  if (dateInput) dateInput.value = '';
  if (descriptionInput) descriptionInput.value = '';
  if (keywordInput) keywordInput.value = '';
}

export function init() {
  window.viewSessionDetails = async (sessionId) => {
    const { sessions } = store.getState();
    const availableSessions = sessions || [];
    const session = availableSessions.find(s => s.id === sessionId);

    if (!session) {
      console.warn('Session not found in local state:', sessionId);
      return;
    }

    store.setState({ currentSession: session });

    const sessionModal = document.getElementById('sessionModal');
    if (sessionModal) {
      sessionModal.classList.remove('page-hidden');
      document.body.style.overflow = 'hidden';
    }

    try {
      const details = await SessionService.fetchDetails(sessionId);
      const sessionModalBody = document.getElementById('sessionModalBody');
      const { user, isAdmin } = store.getState();
      if (sessionModalBody) {
        sessionModalBody.innerHTML = SessionsView.renderDetail(session, details, {
          user,
          isAdmin
        });
        if (window.lucide) window.lucide.createIcons();
      }
    } catch (err) {
      console.error('Error fetching session details:', err);
    }
  };

  window.closeSessionModal = () => {
    const sessionModal = document.getElementById('sessionModal');
    sessionModal.classList.add('page-hidden');
    document.body.style.overflow = '';
  };

  window.switchSessionTab = async (tab) => {
    const { currentSession, user, isAdmin } = store.getState();
    const btns = document.querySelectorAll('.session-tab-btn, .cinematic-tab');
    btns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));

    const content = document.getElementById('sessionTabContent');

    if (tab === 'comments') {
      const { data } = await supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
      content.innerHTML = SessionsView.renderCommentsHTML(data || []);
    } else if (tab === 'photos') {
      const { data } = await supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
      content.innerHTML = SessionsView.renderGalleryHTML(data || [], user, isAdmin);
    } else if (tab === 'participants') {
      const isUpcoming = currentSession.is_upcoming;
      const table = isUpcoming ? 'session_signups' : 'session_attendance';
      const { data } = await supabase.from(table).select('*, profiles(full_name)').eq('session_id', currentSession.id);
      content.innerHTML = SessionsView.renderParticipantsHTML(data || [], isUpcoming);
    }

    if (window.lucide) window.lucide.createIcons();
  };

  window.openPhotoLightbox = (url) => {
    let lightbox = document.getElementById('photoLightbox');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'photoLightbox';
      lightbox.className = 'photo-lightbox';
      lightbox.onclick = () => lightbox.classList.remove('active');
      document.body.appendChild(lightbox);
    }

    lightbox.innerHTML = `
      <div class="lightbox-content">
        <img src="${url}" alt="Full size photo">
        <button class="close-lightbox"><i data-lucide="x"></i></button>
      </div>
    `;

    lightbox.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  };

  window.signupForSession = async (sessionId) => {
    const { user } = store.getState();
    if (!user) {
      showNotification('Please log in to sign up!', 'error');
      return;
    }

    try {
      const res = await SessionService.toggleSignup(sessionId, user.id);
      showNotification(res.action === 'added' ? 'You are now signed up!' : 'Signup removed.');

      await fetchSessions();
      renderSessions();
      const { currentSession } = store.getState();
      if (currentSession?.id === sessionId) window.viewSessionDetails(sessionId);
    } catch (err) {
      console.error('Error signing up:', err);
      showNotification('Action failed.', 'error');
    }
  };

  window.addSessionComment = async () => {
    const { user, currentSession } = store.getState();
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

  window.addSessionPhoto = async (input) => {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const { user, currentSession } = store.getState();
    if (!user || !currentSession) return;

    try {
      showNotification('Uploading photo...', 'warning');
      await SessionService.uploadSessionPhoto(currentSession.id, user.id, file);
      showNotification('Photo uploaded successfully!', 'success');
      window.switchSessionTab('photos');
    } catch (err) {
      console.error('Error uploading photo:', err);
      showNotification('Error uploading photo: ' + err.message, 'error');
    } finally {
      input.value = '';
    }
  };

  window.deleteSessionPhoto = async (photoId, photoUrl) => {
    const { isAdmin } = store.getState();
    if (!isAdmin || !confirm('Are you sure you want to delete this photo?')) return;

    try {
      showNotification('Deleting photo...', 'warning');
      await SessionService.deletePhoto(photoId, photoUrl);
      showNotification('Photo deleted!', 'success');
      window.switchSessionTab('photos');
    } catch (err) {
      console.error('Error deleting photo:', err);
      showNotification('Error deleting photo: ' + err.message, 'error');
    }
  };

  window.showCreateSessionModal = () => {
    const { proposedMovies } = store.getState();
    const createSessionModal = document.getElementById('createSessionModal');
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    resetSessionModalToCreateMode();
    createSessionModal.classList.remove('page-hidden');

    sessionMovieSelect.innerHTML = `
      <option value="">-- To Be Decided --</option>
      ${proposedMovies.map(m => `
        <option value="${m.id}">${escapeHtml(m.title)}</option>
      `).join('')}
    `;
  };

  window.closeCreateSessionModal = () => {
    const createSessionModal = document.getElementById('createSessionModal');
    resetSessionModalToCreateMode();
    store.setState({ currentSession: null });
    createSessionModal.classList.add('page-hidden');
  };

  window.handleCreateSession = async () => {
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    const movieId = sessionMovieSelect.value || null;
    const dateStr = document.getElementById('sessionDate').value;
    const desc = document.getElementById('sessionDescription').value;
    const keyword = document.getElementById('sessionKeyword')?.value || null;
    const isUpcoming = new Date(dateStr) > new Date();

    if (!dateStr) {
      showNotification('Date is required', 'error');
      return;
    }

    try {
      await SessionService.createSession({
        movie_id: movieId,
        session_date: dateStr,
        description: desc,
        keyword: keyword,
        location: 'Paral·lel Cinema',
        is_upcoming: isUpcoming
      });

      showNotification('Session created successfully!');
      await fetchSessions();
      renderSessions();
      renderNextSessionHero();
      updateAdminSessions();

      window.closeCreateSessionModal();
    } catch (err) {
      console.error('Error creating session:', err);
      showNotification('Failed to create session', 'error');
    }
  };

  window.showEditSessionModal = (sessionId) => {
    const { sessions, proposedMovies } = store.getState();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const createSessionModal = document.getElementById('createSessionModal');
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');

    store.setState({ currentSession: session });
    createSessionModal.classList.remove('page-hidden');

    sessionMovieSelect.innerHTML = `
      <option value="">-- To Be Decided --</option>
      ${proposedMovies.map(m => `
        <option value="${m.id}" ${m.id === session.movie_id ? 'selected' : ''}>${escapeHtml(m.title)}</option>
      `).join('')}
      ${session.movie_id && !proposedMovies.some(m => m.id === session.movie_id) ? `
        <option value="${session.movie_id}" selected>${escapeHtml(session.movies?.title || 'Film To Be Decided')}</option>
      ` : ''}
    `;

    const date = new Date(session.session_date);
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('sessionDate').value = localDate;

    document.getElementById('sessionDescription').value = session.description || '';
    const kwInput = document.getElementById('sessionKeyword');
    if (kwInput) kwInput.value = session.keyword || '';

    const submitBtn = createSessionModal.querySelector('.submit-btn');
    submitBtn.textContent = 'Update Session';
    submitBtn.onclick = () => window.handleUpdateSession(sessionId);

    createSessionModal.querySelector('h2').textContent = 'Edit Session';
  };

  window.handleUpdateSession = async (sessionId) => {
    const { currentSession } = store.getState();
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    const sessionModal = document.getElementById('sessionModal');
    const movieId = sessionMovieSelect.value || null;
    const dateStr = document.getElementById('sessionDate').value;
    const desc = document.getElementById('sessionDescription').value;
    const keyword = document.getElementById('sessionKeyword')?.value || null;
    const isUpcoming = dateStr ? new Date(dateStr) > new Date() : false;

    if (!dateStr) {
      showNotification('Date is required', 'error');
      return;
    }

    try {
      const shouldRefreshDetailModal = sessionModal && !sessionModal.classList.contains('page-hidden');
      const updatedSession = await SessionService.updateSession(sessionId, {
        movie_id: movieId,
        session_date: dateStr,
        description: desc,
        keyword: keyword,
        location: currentSession?.location || 'Paral·lel Cinema',
        is_upcoming: isUpcoming
      });

      showNotification('Session updated!');
      await fetchSessions();
      renderSessions();
      renderNextSessionHero();
      updateAdminSessions();
      store.setState({ currentSession: updatedSession });
      window.closeCreateSessionModal();

      if (shouldRefreshDetailModal) {
        await window.viewSessionDetails(sessionId);
      }
    } catch (err) {
      console.error('Error updating session:', err);
      showNotification(err.message || 'Failed to update session', 'error');
    }
  };

  window.handleDeleteSession = async (sessionId) => {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      await SessionService.deleteSession(sessionId);
      showNotification('Session deleted.');

      const { currentSession } = store.getState();
      if (currentSession?.id === sessionId) {
        document.getElementById('sessionDetailsModal')?.classList.add('page-hidden');
        store.setState({ currentSession: null });
      }

      await fetchSessions();
      renderSessions();
    } catch (err) {
      console.error('Error deleting session:', err);
      showNotification('Failed to delete session', 'error');
    }
  };

  window.manageAttendance = async (sessionId) => {
    const { sessions } = store.getState();
    const session = sessions.find(s => s.id === sessionId);
    const { data: signups } = await supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId);
    const { data: attendance } = await supabase.from('session_attendance').select('user_id').eq('session_id', sessionId);

    const attendedSet = new Set(attendance?.map(a => a.user_id) || []);

    const html = `
      <div style="padding: 2rem;">
        <h3>Attendance: ${escapeHtml(session.movies?.title || 'Film To Be Decided')}</h3>
        <p style="margin-bottom: 2rem;">Confirm who actually attended the session.</p>

        <div style="display:grid; gap:1rem;">
          ${signups?.length ? signups.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem;">
              <span>${escapeHtml(getUserDisplayName(s.profiles))}</span>
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

    const sessionModalBody = document.getElementById('sessionModalBody');
    const sessionModal = document.getElementById('sessionModal');
    sessionModalBody.innerHTML = html;
    sessionModal.classList.remove('page-hidden');
  };

  window.toggleAttendance = async (sessionId, userId, btn) => {
    try {
      const res = await SessionService.toggleAttendance(sessionId, userId);

      if (res.action === 'added') {
        showNotification('Attendance confirmed!', 'success');
      } else {
        showNotification('Attendance removed', 'info');
      }

      await fetchSessions();
      renderSessions();
      window.viewSessionDetails(sessionId);
    } catch (err) {
      console.error('Error toggling attendance:', err);
      showNotification('Action failed', 'error');
    }
  };
}

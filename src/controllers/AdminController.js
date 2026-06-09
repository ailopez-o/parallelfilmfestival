import { AdminService } from '../api/index.js';
import { store } from '../state/store.js';
import { AdminView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';

export async function fetchAppSettings() {
  try {
    const settings = await AdminService.fetchAppSettings();
    store.setState({ maxProposals: settings.maxProposals, maxVotes: settings.maxVotes });
  } catch (err) {
    console.error('Error fetching settings:', err);
    showNotification('Error: faltan ajustes de límites en la BBDD (app_settings).', 'error');
  }
}

export function loadAppSettings() {
  const { maxProposals, maxVotes } = store.getState();
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  if (maxPropInput) maxPropInput.value = maxProposals;
  if (maxVoteInput) maxVoteInput.value = maxVotes;
}

export async function saveAppSettings() {
  const { isAdmin } = store.getState();
  if (!isAdmin) return;
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  const newValProp = maxPropInput.value;
  const newValVote = maxVoteInput.value;
  try {
    showNotification('Updating system settings...', 'warning');
    await AdminService.updateAppSettings(newValProp, newValVote);
    store.setState({ maxProposals: parseInt(newValProp), maxVotes: parseInt(newValVote) });
    showNotification('System settings updated successfully!', 'success');
    window.dispatchEvent(new CustomEvent('authui:update'));
  } catch (err) {
    console.error('Error saving app settings:', err);
    showNotification('Error updating settings', 'error');
  }
}

export async function fetchUserList() {
  try {
    const { rankedUsers } = store.getState();
    const profiles = await AdminService.fetchAllProfiles();
    const rankedById = new Map(rankedUsers.map(p => [p.id, p]));
    const profilesWithRanking = profiles.map(profile => ({
      ...profile,
      score: rankedById.get(profile.id)?.score || 0,
      rank: rankedById.get(profile.id)?.rank || null
    }));
    const { user } = store.getState();
    const adminUserList = document.getElementById('adminUserList');
    const adminUserCount = document.getElementById('adminUserCount');
    AdminView.renderUserList(profilesWithRanking, adminUserList, adminUserCount, user);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching user list:', err);
  }
}

export async function fetchParticipationLog() {
  const { isAdmin } = store.getState();
  if (!isAdmin) return;
  const adminParticipationLog = document.getElementById('adminParticipationLog');
  try {
    const logs = await AdminService.fetchParticipationLogs(50);
    AdminView.renderParticipationLog(logs, adminParticipationLog);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching activity log:', err);
    if (adminParticipationLog) adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--error);">Failed to load activity log.</td></tr>`;
  }
}

export function init() {
  window.saveAppSettings = saveAppSettings;

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

  window.confirmDeleteUser = async (userId, userName) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    if (!window.confirm(`⚠️ DANGER ZONE: Are you sure you want to delete user "${userName}"?\n\nThis will also remove all their movie proposals, votes and ratings. This action cannot be undone.`)) return;
    try {
      showNotification(`Deleting user ${userName}...`, 'warning');
      await AdminService.deleteUser(userId);
      showNotification(`User ${userName} and all their data have been removed.`, 'success');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (err) {
      console.error('Error deleting user:', err);
      showNotification(`Error: ${err.message || 'System error deleting user'}`, 'error');
    }
  };

  window.handleDeployMetadata = async () => {
    const { isAdmin, sessions } = store.getState();
    if (!isAdmin) { showNotification('Admin privileges required', 'error'); return; }
    const upcoming = sessions
      .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
      .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];
    if (!upcoming) { showNotification('No upcoming sessions found to update.', 'warning'); return; }
    try {
      showNotification('Updating social metadata in Supabase...', 'warning');
      const result = await AdminService.updateSocialMetadata(upcoming);
      if (result.success) showNotification(`Social preview for "${result.movieTitle}" updated successfully!`, 'success');
    } catch (err) {
      showNotification(`Update failed: ${err.message}`, 'error');
    }
  };

  window.cleanupInactiveMovies = async (silent = false) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    if (!silent) showNotification('Checking for inactive movies...', 'info');
    try {
      const { cleanedCount } = await AdminService.cleanupInactiveMovies();
      if (cleanedCount > 0) {
        if (!silent) showNotification(`Cleaned up ${cleanedCount} inactive movies`, 'success');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      } else {
        if (!silent) showNotification('All movies are active!', 'success');
      }
    } catch (err) {
      console.error('Error cleaning up movies:', err);
      if (!silent) showNotification('Failed to clean inactive movies', 'error');
    }
  };

  window.toggleCheckinDropdown = (userId) => {
    const dropdown = document.getElementById(`checkin-${userId}`);
    const allDropdowns = document.querySelectorAll('.checkin-dropdown');
    allDropdowns.forEach(d => { if (d.id !== `checkin-${userId}`) d.classList.remove('active'); });
    if (dropdown.classList.contains('active')) {
      dropdown.classList.remove('active');
    } else {
      const { seenMovies } = store.getState();
      const recent = [...seenMovies].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
      if (recent.length === 0) {
        dropdown.innerHTML = '<div style="padding:0.5rem; font-size:0.7rem; color:var(--text-secondary);">No sessions available. Mark a movie as "Seen" first.</div>';
      } else {
        dropdown.innerHTML = recent.map(m => `<button class="checkin-option" onclick="window.markAttendance('${userId}', '${m.id}')"><i data-lucide="play"></i> ${escapeHtml(m.title)}</button>`).join('');
      }
      dropdown.classList.add('active');
      if (window.lucide) window.lucide.createIcons();
    }
  };

  window.markAttendance = async (userId, movieId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    const { SessionService } = await import('../api/index.js');
    try {
      showNotification('Recording attendance...', 'info');
      const result = await SessionService.recordAttendanceByMovie(userId, movieId);
      if (result.action === 'existing') { showNotification('User already checked-in for this session.', 'warning'); return; }
      showNotification('Attendance recorded! (+10 pts)', 'success');
      const dropdown = document.getElementById(`checkin-${userId}`);
      if (dropdown) dropdown.classList.remove('active');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (err) {
      console.error('Error marking attendance:', err);
      showNotification('Failed to record attendance.', 'error');
    }
  };
}

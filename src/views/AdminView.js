import { createRankingRowHTML } from '../components/index.js';

/**
 * Admin View Module.
 * Manages the administrator dashboard and auditing tools.
 */
export const AdminView = {
  /**
   * Renders the user directory table.
   */
  renderUserList(profiles, container, countElement) {
    if (!container) return;
    if (countElement) countElement.textContent = `${profiles?.length || 0} Users`;

    container.innerHTML = (profiles || []).map(p => {
      const name = p.full_name || p.email.split('@')[0];
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : 'N/A';
      const roleLabel = p.role === 'admin' ? '<span style="color:var(--success); font-size: 0.7rem; font-weight:700;">ADMIN</span>' : '<span style="color:var(--text-secondary); font-size: 0.7rem;">USER</span>';
      const rankClass = p.rank <= 3 ? `top-${p.rank}` : '';

      return `
        <tr class="admin-user-row clickable" onclick="window.viewUserProfile('${p.id}')">
          <td>
            <div class="user-cell">
              <span class="user-rank ${rankClass}">#${p.rank}</span>
              <img src="${avatar}" alt="${p.full_name || 'User'}">
              <div style="display:flex; flex-direction:column;">
                <span class="user-name">${name}</span>
                ${roleLabel}
              </div>
            </div>
          </td>
          <td><span style="font-size:0.85rem; color:var(--text-secondary);">${p.email}</span></td>
          <td><span class="score-badge">${p.score || 0} pts</span></td>
          <td><span style="font-size:0.8rem; color:var(--text-tertiary);">${date}</span></td>
          <td>
            <button class="delete-user-btn" onclick="event.stopPropagation(); window.confirmDeleteUser('${p.id}', '${name}')" title="Delete User">
              <i data-lucide="user-minus"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  /**
   * Renders the participation log audit table.
   */
  renderParticipationLog(logs, container) {
    if (!container) return;
    if (!logs || logs.length === 0) {
      container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-secondary);">No participation records found.</td></tr>';
      return;
    }

    container.innerHTML = logs.map(log => {
      // Handle cases where profiles might be an object or an array (Supabase join behavior)
      const profile = Array.isArray(log.profiles) ? log.profiles[0] : log.profiles;
      const name = profile?.full_name || profile?.email?.split('@')[0] || 'User';
      let actionLabel = log.action_type;
      let points = '0';
      let pointsClass = 'muted';

      if (log.action_type === 'vote') {
        actionLabel = 'Voted';
        points = '+1';
        pointsClass = 'info';
      } else if (log.action_type === 'proposal') {
        actionLabel = 'Proposed';
        points = '+5';
        pointsClass = 'success';
      } else if (log.action_type === 'attendance') {
        actionLabel = 'Attended';
        points = '+10';
        pointsClass = 'success';
      } else if (log.action_type === 'cemetery_drop') {
        actionLabel = 'Proposal Dropped';
        points = '-4';
        pointsClass = 'danger';
      } else if (log.action_type === 'cemetery_vote_loss') {
        actionLabel = 'Vote Invalidated';
        points = '-1';
        pointsClass = 'danger';
      } else if (log.action_type === 'proposal_rescue') {
        actionLabel = 'Proposal Rescued';
        points = '+4';
        pointsClass = 'success';
      } else if (log.action_type === 'proposal_lost') {
        actionLabel = 'Proposal Lost';
        points = '-1';
        pointsClass = 'danger';
      } else if (log.action_type === 'vote_removed') {
        actionLabel = 'Vote Removed';
        points = '-1';
        pointsClass = 'danger';
      } else if (log.action_type === 'review') {
        actionLabel = 'Reviewed';
        points = '+5';
        pointsClass = 'success';
      }
      
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      
      const movieTitle = log.movies?.title || (log.movie_id ? 'Archived Movie' : 'System');
      const movieDisplay = log.movies?.tmdb_id 
        ? `<a href="https://www.themoviedb.org/movie/${log.movies.tmdb_id}" target="_blank" class="movie-title-cell link">${movieTitle}</a>`
        : `<span class="movie-title-cell">${movieTitle}</span>`;

      return `
        <tr>
          <td>
            <div class="user-cell">
              <img src="${avatar}" alt="${name}">
              <span class="user-name">${name}</span>
            </div>
          </td>
          <td><span class="audit-action-tag ${log.action_type}">${actionLabel}</span></td>
          <td>${movieDisplay}</td>
          <td><span class="score-badge ${pointsClass}">${points}</span></td>
          <td style="font-size:0.8rem; color:var(--text-tertiary);">${new Date(log.created_at).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  },

  /**
   * Renders the achievements audit table.
   */
  renderAchievementsAudit(events, container, activeUserMap) {
    if (!container) return;
    if (!events || events.length === 0) {
      container.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem; color:var(--text-secondary);">No achievement records found.</td></tr>';
      return;
    }

    container.innerHTML = events.map(e => {
      const userName = activeUserMap[e.userId] || 'Unknown';
      const medalName = e.text.match(/<span class="event-medal-name">(.*?)<\/span>/)?.[1] || 'Achievement';
      return `
        <tr>
          <td>
            <div style="display:flex; flex-direction:column;">
              <span class="user-name">${userName}</span>
            </div>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <div class="achievement-icon-small" style="background:var(--accent); color:white; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                <i data-lucide="${e.icon}"></i>
              </div>
              <span style="font-weight:600;">${medalName}</span>
            </div>
          </td>
          <td>${e.date.toLocaleString()}</td>
          <td><span class="score-badge">+10</span></td>
        </tr>
      `;
    }).join('');
  },

  /**
   * Renders the global ranking table.
   */
  renderRankingView(rankedUsers, container) {
    if (!container) return;
    if (!rankedUsers || rankedUsers.length === 0) {
      container.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-secondary);">No rankings available yet.</td></tr>';
      return;
    }

    container.innerHTML = rankedUsers.slice(0, 10).map(user => createRankingRowHTML(user)).join('');
  }
};

import { escapeHtml, getUserDisplayName } from '../utils/index.js';

/**
 * Generates HTML for a ranking row.
 * 
 * @param {Object} user - User data including rank and score.
 * @returns {string} HTML string for the table row.
 */
export function createRankingRowHTML(user) {
  const name = getUserDisplayName(user);
  const safeName = escapeHtml(name);
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
  const rankClass = user.rank <= 3 ? `top-${user.rank}` : '';
  
  return `
    <tr>
      <td><span class="user-rank ${rankClass}">#${user.rank}</span></td>
	      <td>
	        <div class="user-cell">
	          <img src="${avatar}" alt="${safeName}">
	          <span class="user-name">${safeName}</span>
	        </div>
	      </td>
      <td>
        <div class="score-badge" onclick="window.navigateTo('ranking')" title="View Global Ranking">
          <i data-lucide="award" style="width:12px; height:12px; margin-right:4px;"></i>
          ${user.score}
        </div>
      </td>
    </tr>
  `;
}

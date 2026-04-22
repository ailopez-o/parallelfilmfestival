/**
 * String normalization for robust comparison.
 * Trims, lowercases, and removes diacritics.
 * 
 * @param {string} str - The string to normalize.
 * @returns {string} The normalized string.
 */
export const normalize = (str) => {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};

/**
 * Formats a numeric score to one decimal place.
 * 
 * @param {number|string} score - The score to format.
 * @returns {string} Formatted score or "N/A".
 */
export function formatScore(score) {
  if (score === undefined || score === null || (typeof score === 'string' && score === 'N/A')) return 'N/A';
  const num = parseFloat(score);
  return isNaN(num) ? 'N/A' : num.toFixed(1);
}

/**
 * Returns a human-readable "time ago" string.
 * 
 * @param {Date|number} date - The date to compare.
 * @returns {string} Human-readable time difference.
 */
export function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return `${Math.floor(interval)} years ago`;
  interval = seconds / 2592000;
  if (interval > 1) return `${Math.floor(interval)} months ago`;
  interval = seconds / 86400;
  if (interval > 1) return `${Math.floor(interval)} days ago`;
  interval = seconds / 3600;
  if (interval > 1) return `${Math.floor(interval)} hours ago`;
  interval = seconds / 60;
  if (interval > 1) return `${Math.floor(interval)} min ago`;
  return 'just now';
}

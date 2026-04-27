/**
 * Resolves the display name for a user based on available data.
 * 
 * Priority:
 * 1. profile.full_name
 * 2. userAuth.user_metadata (immediate display after OAuth)
 * 3. profile.email (prefix)
 * 4. "Anonymous"
 * 
 * @param {Object} profile - User profile from database.
 * @param {Object} userAuth - Supabase auth user object.
 * @returns {string} The resolved display name.
 */
export function getUserDisplayName(profile, userAuth = null) {
  // Handle case where profile might be an array (Supabase join behavior)
  const p = Array.isArray(profile) ? profile[0] : profile;

  // 1. Database profile name
  if (p?.full_name) return p.full_name;

  // 2. Auth Metadata (useful for new OAuth logins before profile sync)
  const metadata = userAuth?.user_metadata || {};
  if (metadata.full_name) return metadata.full_name;
  if (metadata.name) return metadata.name;
  if (metadata.given_name) {
    return metadata.family_name ? `${metadata.given_name} ${metadata.family_name}` : metadata.given_name;
  }

  // 3. Email inference
  const email = p?.email || userAuth?.email;
  if (email) return email.split('@')[0];

  // 4. Fallback
  return 'Anonymous';
}

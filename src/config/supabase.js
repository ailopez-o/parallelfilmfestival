import { createClient } from '@supabase/supabase-js';

/**
 * Supabase configuration and client initialization.
 * Uses environment variables for security.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function assertRequiredEnv(name, value) {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `[Config] Missing required environment variable: ${name}. Please define it in your .env file.`
    );
  }
}

assertRequiredEnv('VITE_SUPABASE_URL', supabaseUrl);
assertRequiredEnv('VITE_SUPABASE_ANON_KEY', supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

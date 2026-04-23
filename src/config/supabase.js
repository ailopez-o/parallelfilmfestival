import { createClient } from '@supabase/supabase-js';

/**
 * Supabase configuration and client initialization.
 * Uses environment variables for security.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

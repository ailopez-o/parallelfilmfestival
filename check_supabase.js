import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  const { data, error, status } = await supabase.from('movies').select('*').limit(1);
  if (error) {
    console.log('Error:', error);
  } else {
    console.log('Success, found', data.length, 'movies');
  }
}
test();

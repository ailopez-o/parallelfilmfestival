import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") || Deno.env.get("VITE_TMDB_API_KEY")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS (Options)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { path, params = {} } = await req.json()
    
    if (!path) {
      throw new Error("Missing 'path' in request body.")
    }

    // Construct the fully qualified TMDB URL
    // We use a POST request with JSON body from client to avoid complex URL encoding issues
    const query = new URLSearchParams({ ...params, api_key: TMDB_API_KEY })
    const fullUrl = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}${query.toString()}`
    
    console.log(`[TMDB Proxy] Fetching: ${path}`)
    
    const resp = await fetch(fullUrl)
    const data = await resp.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: resp.status
    })

  } catch (err) {
    console.error(`[TMDB Proxy Error]: ${err.message}`)
    return new Response(JSON.stringify({ 
      error: err.message,
      details: "Ensure TMDB_API_KEY is set in Supabase Secrets (Dashboard -> Edge Functions)."
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('id')

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  // Bypassing RLS with service role to ensure movie data is always available for OG tags
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  )

  const { data: session } = await supabase
    .from('sessions')
    .select('*, movies(*)')
    .eq('id', sessionId)
    .single()

  const title = session?.movies?.title || 'Sesión | Paral·lel Film Festival'
  const description = session?.description || '¡Ven a ver esta película con nosotros!'
  const image = session?.movies?.poster_url || 'https://parallelfilmfestival.com/og-image.png'
  const escapedSessionId = encodeURIComponent(sessionId ?? '')
  const appUrl = `https://parallelfilmfestival.com/?view=sessions&session=${escapedSessionId}`

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:type" content="video.movie">
  <meta name="twitter:card" content="summary_large_image">
  <meta http-equiv="refresh" content="0;url=${appUrl}">
</head>
<body style="font-family:sans-serif; background:#0a0a0a; color:white; display:flex; align-items:center; justify-content:center; height:100vh;">
  <div style="text-align:center;">
    <p>Redirigiendo a la sesión...</p>
    <a href="${appUrl}" style="color:#4158d0;">Haz clic aquí si no eres redirigido</a>
  </div>
  <script>window.location.replace("${appUrl}");</script>
</body>
</html>`

  const encoder = new TextEncoder()
  const body = encoder.encode(html)

  return new Response(body, {
    headers: { 
      'Content-Type': 'text/html; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    }
  })
})

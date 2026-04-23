import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS options request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get the Auth Header to verify the caller
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error("Missing Authorization header")
    }

    const { targetUserId } = await req.json()
    if (!targetUserId) {
      throw new Error("Missing targetUserId in request body")
    }

    // 2. Initialize Supabase Admin Client using the Service Role Key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables")
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 3. Verify the caller is an Admin
    // We get the user object associated with the caller's JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: callerUser }, error: verifyError } = await supabaseAdmin.auth.getUser(token)
    
    if (verifyError || !callerUser) {
      throw new Error("Invalid or expired authorization token")
    }

    // Fetch caller's profile to verify admin role
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single()

    if (profileError || callerProfile?.role !== 'admin') {
      throw new Error("Forbidden: Only administrators can perform this action")
    }

    // 4. Perform the Cascade Deletion manually as Admin
    console.log(`[Admin Delete] Initiating deletion for user: ${targetUserId}`)

    // Delete orphaned data first to maintain referential integrity if needed
    await supabaseAdmin.from('votes').delete().eq('user_id', targetUserId)
    await supabaseAdmin.from('user_ratings').delete().eq('user_id', targetUserId)
    await supabaseAdmin.from('participation_log').delete().eq('user_id', targetUserId)
    await supabaseAdmin.from('session_signups').delete().eq('user_id', targetUserId)
    await supabaseAdmin.from('session_attendance').delete().eq('user_id', targetUserId)
    await supabaseAdmin.from('movies').delete().eq('proposed_by', targetUserId)
    
    // Delete from public profiles
    await supabaseAdmin.from('profiles').delete().eq('id', targetUserId)

    // 5. Delete the Auth User completely (if it still exists)
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId)
    
    // Ignore error if the user was already deleted from auth.users manually
    if (deleteAuthError && !deleteAuthError.message.includes('User not found')) {
      throw deleteAuthError
    }

    console.log(`[Admin Delete] Successfully deleted user: ${targetUserId}`)

    return new Response(JSON.stringify({ success: true, message: "User completely removed" }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('[Admin Delete] Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

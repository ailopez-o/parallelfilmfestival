import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")

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
    const { query, useWeb = false } = await req.json()
    
    if (!query) {
      throw new Error("Missing 'query' in request body.")
    }

    const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    console.log(`[AI Scout] Processing mission: "${query}" (Web search: ${useWeb})`)

    const prompt = `Today is ${today}. You are the "Cinematic Bible", the world's most erudite and precise movie authority. 
    Analyze the request and provide an extensive list of exactly 40-50 specific movie titles.
    ${useWeb ? "Actively look for recent data, award winners, or upcoming releases from 2024-2027." : "Provide results based on your extensive knowledge."}
    
    FORMAT: Return ONLY a JSON array of strings: ["Title 1", "Title 2", ..., "Title 50"]
    USER REQUEST: "${query}"`;

    // Forward to OpenAI securely
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: useWeb ? "gpt-4o" : "gpt-4o-mini", // GPT-4o for complex web-like reasoning
        messages: [
          { role: "system", content: "You are the Cinematic Bible. You only output JSON arrays of movie titles." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      })
    })

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI API responded with ${response.status}: ${errBody}`);
    }

    const data = await response.json()
    const text = data.choices[0].message.content
    
    // Extract the JSON structure from the AI response
    const jsonMatch = text.match(/\[.*\]/s)
    if (!jsonMatch) {
      throw new Error("AI response did not contain a valid movie array.")
    }
    
    const titles = JSON.parse(jsonMatch[0])

    return new Response(JSON.stringify({ titles }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    })

  } catch (err) {
    console.error(`[AI Scout Error]: ${err.message}`)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

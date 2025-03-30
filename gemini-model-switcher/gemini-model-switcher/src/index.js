export default {
	async fetch(request, env, ctx) {
	  if (request.method === "OPTIONS") {
		return new Response(null, {
		  status: 204,
		  headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		  },
		});
	  }
  
	  if (request.method === "POST") {
		try {
		  const { prompt, modelName } = await request.json();
		  const apiKey = env.GEMINI_API_KEY;
		  const model = modelName || "gemini-2.0-flash";
		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
		  const geminiRes = await fetch(geminiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
			  contents: [{ parts: [{ text: prompt }] }],
			}),
		  });
  
		  const json = await geminiRes.json();
		  const result = json?.candidates?.[0]?.content?.parts?.[0]?.text || "不明";
  
		  return new Response(JSON.stringify({ result }), {
			status: 200,
			headers: {
			  "Content-Type": "application/json",
			  "Access-Control-Allow-Origin": "*",
			},
		  });
		} catch (e) {
		  return new Response(JSON.stringify({ error: e.message }), {
			status: 500,
			headers: {
			  "Content-Type": "application/json",
			  "Access-Control-Allow-Origin": "*",
			},
		  });
		}
	  }
  
	  return new Response("Only POST and OPTIONS supported", { status: 405 });
	},
  };
  
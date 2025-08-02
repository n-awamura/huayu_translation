export default {
	async fetch(request, env, ctx) {
	  // CORS プリフライトリクエストの処理
	  if (request.method === "OPTIONS") {
		return handleOptions(request);
	  }
  
	  const apiKey = env.GEMINI_API_KEY;
	  if (!apiKey) {
		return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
		  status: 500,
		  headers: corsHeaders,
		});
	  }
  
	  // GET リクエストの処理 (グラウンディング用)
	  if (request.method === "GET") {
		try {
		  const url = new URL(request.url);
		  const prompt = url.searchParams.get("q");
		  const modelName = url.searchParams.get("model") || "gemini-2.5-flash";
		  const toolName = url.searchParams.get("tool");
  
		  if (!prompt) {
			return new Response(JSON.stringify({ error: 'Query parameter "q" is required.' }), {
			  status: 400,
			  headers: corsHeaders,
			});
		  }
  
		  const requestBody = {
			contents: [{ parts: [{ text: prompt }] }],
			tools: [],
		  };
  
		  if (toolName === "googleSearch") {
			requestBody.tools.push({
			  googleSearch: {},
			});
		  }
  
		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
		  const geminiRes = await fetch(geminiUrl, {
			method: "POST", // Gemini API自体は常にPOST
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBody),
		  });
  
		  if (!geminiRes.ok) {
			const errorText = await geminiRes.text();
			console.error(`Gemini API Error (${geminiRes.status}): ${errorText}`);
			return new Response(JSON.stringify({ error: `Gemini API failed with status ${geminiRes.status}` }), {
				status: geminiRes.status,
				headers: corsHeaders,
			});
		  }
  
		  const json = await geminiRes.json();
		  const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text || "不明";
		  const sources = json?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  
		  return new Response(JSON.stringify({ answer, sources }), {
			status: 200,
			headers: corsHeaders,
		  });
		} catch (e) {
		  console.error("Worker GET Error:", e);
		  return new Response(JSON.stringify({ error: e.message }), {
			status: 500,
			headers: corsHeaders,
		});
	  }
	  }
  
	  // POST リクエストの処理 (グラウンディングなし)
	  if (request.method === "POST") {
		try {
		  // フロントから送られてくるリクエストボディ全体を取得
		  const requestBody = await request.json();
		  
		  // リクエストボディからモデル名を取得、なければデフォルト値を使用
		  // "contents": [{ "role": "model", "parts": [...] }] のような形式からモデル名を取り出すのは複雑なので、
		  // フロント側でモデル名を指定してもらうか、固定のモデル名を使う。
		  // 今回は、柔軟性を持たせるため、リクエストボディに "modelName" を含めてもらい、
		  // なければデフォルトで 'gemini-2.5-flash' を使う戦略にする。
		  const modelName = requestBody.modelName || "gemini-2.5-flash";

		  // APIに渡す前に、リクエストボディから "modelName" を削除する
		  // Gemini APIは "modelName" フィールドを想定していないため
		  delete requestBody.modelName;

		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
		  const geminiRes = await fetch(geminiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// フロントから受け取ったリクエストボディをそのまま使用
			body: JSON.stringify(requestBody),
		  });
  
		   if (!geminiRes.ok) {
			const errorText = await geminiRes.text();
			console.error(`Gemini API Error (${geminiRes.status}): ${errorText}`);
			const errorJson = JSON.parse(errorText); // エラーレスポンスをJSONとしてパース
			return new Response(JSON.stringify({ 
				error: `Gemini API failed: ${errorJson.error?.message || 'Unknown error'}`,
				details: errorJson 
			}), {
				status: geminiRes.status,
				headers: corsHeaders,
			});
		  }
  
		  const json = await geminiRes.json();
		  // Gemini APIの応答形式に合わせてアンサーとソースを取得
		  const answer = json?.candidates?.[0]?.content?.parts?.[0]?.text || "応答がありませんでした。";
		  const sources = json?.candidates?.[0]?.groundingMetadata?.webSearchQueries;
  
		  return new Response(JSON.stringify({ answer, sources }), {
			status: 200,
			headers: corsHeaders,
		  });
		} catch (e) {
		  console.error("Worker POST Error:", e);
		  return new Response(JSON.stringify({ error: e.message }), {
			status: 500,
			headers: corsHeaders,
		  });
		}
	  }
  
	  return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
	},
  };
  
  const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
  };
  
  function handleOptions(request) {
	if (
	  request.headers.get("Origin") !== null &&
	  request.headers.get("Access-Control-Request-Method") !== null &&
	  request.headers.get("Access-Control-Request-Headers") !== null
	) {
	  // Handle CORS preflight requests.
	  return new Response(null, {
		headers: corsHeaders,
	  });
	} else {
	  // Handle simple requests
	  return new Response(null, {
		headers: {
		  Allow: "GET, POST, OPTIONS",
		},
	  });
	}
  }
  
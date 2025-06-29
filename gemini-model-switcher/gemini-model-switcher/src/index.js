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
		  const { prompt, modelName, useGrounding, toolName } = await request.json();
		  const apiKey = env.GEMINI_API_KEY;
		  const model = modelName || "gemini-1.5-pro-latest";
		  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
		  let requestBodyToGemini = {
			contents: [{ parts: [{ text: prompt }] }],
		  };
  
		  if (useGrounding && toolName === "google_search") {
			requestBodyToGemini.tools = [
			  {
				"googleSearchRetrieval": {}
			  }
			];
			console.log("Grounding with Google Search enabled for Gemini API call.");
		  } else if (useGrounding) {
			console.warn(`Unsupported toolName '${toolName}' for grounding. Proceeding without grounding.`);
		  }
  
		  const geminiRes = await fetch(geminiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(requestBodyToGemini),
		  });
  
		  const json = await geminiRes.json();
		  let resultText = "不明";
		  let sources = null;
  
		  if (json?.candidates?.[0]?.content?.parts) {
			const parts = json.candidates[0].content.parts;
			resultText = parts.find(part => part.text !== undefined && part.text !== null)?.text || "応答テキストなし";
  
			const groundingPart = parts.find(part => part.groundingMetadata);
			if (groundingPart?.groundingMetadata?.groundingAttributions) {
				sources = groundingPart.groundingMetadata.groundingAttributions.map(attr => ({
					title: attr.web?.title || "タイトルなし",
					uri: attr.web?.uri || "URIなし",
				}));
				console.log("Extracted sources from grounding metadata:", sources);
			} else if (groundingPart?.groundingMetadata?.retrievalQueries) {
				console.log("Retrieval Queries (not direct sources):", groundingPart.groundingMetadata.retrievalQueries);
			}
		  } else if (json?.error) {
			console.error("Error from Gemini API:", json.error);
			resultText = `Gemini APIエラー: ${json.error.message || '不明なエラー'}`;
		  }
  
		  return new Response(JSON.stringify({ result: resultText, sources: sources }), {
			status: 200,
			headers: {
			  "Content-Type": "application/json",
			  "Access-Control-Allow-Origin": "*",
			},
		  });
		} catch (e) {
		  console.error("Error in Worker:", e);
		  return new Response(JSON.stringify({ error: e.message, detail: e.stack }), {
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
  
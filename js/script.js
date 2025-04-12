// ==============================
// グローバル変数
// ==============================
let conversationSessions = []; 
let currentSession = null;     
let lastMessageDate = "";      

// ==============================
// ユーティリティ関数
// ==============================
function getTimestampValue(ts) {
  if (ts && typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return new Date(ts).getTime();
}

function getWeekday(dateObj) {
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return weekdays[dateObj.getDay()];
}

function scrollToBottom() {
  const messagesDiv = document.getElementById('chatMessages');
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// HTMLエスケープ用のヘルパー関数
function escapeHtml(unsafe) {
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
}

// インラインのマークダウン（太字、リンク）を処理するヘルパー関数
function processInlineFormatting(text) {
    // 1. Escape the entire text first to prevent HTML injection
    let escapedText = escapeHtml(text);

    // 2. Replace markdown **bold** with <strong> tags
    // Use a regex that avoids replacing already inside HTML tags (basic check)
    escapedText = escapedText.replace(/(?<!&lt;|<)\*\*(?![*])(.*?)(?<![*])\*\*(?!&gt;|>)/g, (match, content) => {
        // Avoid double-escaping content if escapeHtml handled '*' specially
        // Re-escape content just in case, though escapeHtml should handle it
        return `<strong>${escapeHtml(content)}</strong>`;
    });


    // 3. Replace URLs with <a> tags
    // Use a regex that looks for URLs but tries to avoid those already in href attributes
    const urlRegex = /(?<!href=["'])(https?:\/\/[^\s<>\"]+)/g; // Corrected regex
    escapedText = escapedText.replace(urlRegex, (url) => {
        // The URL itself is already escaped from step 1.
        // We need the raw URL for the href attribute.
        // Since we escaped first, we need to be careful here.
        // A simpler approach might be to escape *after* replacements, but that's less safe.
        // Let's stick to escaping first. The displayed URL will be escaped,
        // but the href needs the original URL (which we don't have easily after escaping).
        // Compromise: Use the escaped URL for both display and href. This is safer.
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        // If original URL needed: would require more complex parsing before escaping.
    });


    return escapedText;
}


// テキストセグメントをHTMLに変換するメイン関数
function processMarkdownSegment(segment) {
    let finalHtml = '';
    const lines = segment.trim().split('\n');
    let listOpen = false;

    lines.forEach(line => {
        line = line.trim();
        if (line === '') return;

        // --- Determine Line Type (based on raw Markdown line) ---

        // Rule 1: Title (starts with **)
        if (line.match(/^\*\*(.*?)\*\*$/)) { // Corrected regex
            if (listOpen) { finalHtml += '</ul>'; listOpen = false; }
            const titleContent = line.slice(2, -2).trim();
            // Escape content *before* putting in tags
            finalHtml += `<p class="chat-title"><strong>${escapeHtml(titleContent)}</strong></p>`;
        }
        // Rule 2: List item (starts with * or 1.)
        else if (line.match(/^(\*|\d+\.)\s+/)) { // Corrected regex
            if (!listOpen) { finalHtml += '<ul>'; listOpen = true; }
            const itemMatch = line.match(/^(\*|\d+\.)\s+(.*?)$/); // Corrected regex
            const itemContent = itemMatch ? itemMatch[2].trim() : '';
            // Process inline formatting (bold, links) for the content
            finalHtml += `<li>${processInlineFormatting(itemContent)}</li>`;
        }
        // Rule 3: Paragraph (default)
        else {
            if (listOpen) { finalHtml += '</ul>'; listOpen = false; }
            // Process inline formatting (bold, links) for the paragraph
            finalHtml += `<p>${processInlineFormatting(line)}</p>`;
        }
    });

    // Close list if it was the last element
    if (listOpen) { finalHtml += '</ul>'; }

    console.log("Processed Markdown Segment Result:", finalHtml);
    return finalHtml;
}


function addMessageRow(text, sender, timestamp = null) {
    console.log("--- addMessageRow Start (Corrected Code Block Handling) ---");
    console.log("Original Text:", text);

    const chatMessagesDiv = document.getElementById('chatMessages');
    const messageDate = timestamp ? new Date(timestamp) : new Date();
    const now = new Date();

    // --- Date Header Logic ---
    let dateHeaderStr;
    if (messageDate.getFullYear() === now.getFullYear()) {
        dateHeaderStr = `${(messageDate.getMonth() + 1).toString().padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')} (${getWeekday(messageDate)})`;
    } else {
        dateHeaderStr = `${messageDate.getFullYear()}/${(messageDate.getMonth() + 1).toString().padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')} (${getWeekday(messageDate)})`;
    }
    if (dateHeaderStr !== lastMessageDate) {
        lastMessageDate = dateHeaderStr;
        const dateHeader = document.createElement('div');
        dateHeader.classList.add('date-header');
        dateHeader.innerText = dateHeaderStr;
        chatMessagesDiv.appendChild(dateHeader);
    }


    // --- Create Row and Icon ---
    const row = document.createElement('div');
    row.classList.add('message-row', sender);
    if (sender === 'other') {
        const icon = document.createElement('img');
        icon.classList.add('icon');
        icon.src = 'img/elephant.png';
        icon.alt = '相手アイコン';
        row.appendChild(icon);
    }


    // --- Bubble Creation ---
    const bubble = document.createElement('div');
    bubble.classList.add('bubble');
    const bubbleText = document.createElement('div');
    bubbleText.classList.add('bubble-text');

    // --- Text Processing --- (Revised Flow for Code Blocks) ---
    const originalTextForCopy = text;
    const codeBlocks = []; // Keep track of code blocks separately if needed later
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g; // FIX: Allow whitespace after lang name
    let lastIndex = 0;
    let match;
    let blockIndex = 0;
    const segments = []; // Array to hold alternating text and code block objects

    // 1. Extract Code Blocks and Identify Text Segments
    while ((match = codeBlockRegex.exec(text)) !== null) {
        // Add text segment before the code block
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        }

        // Add code block segment
        const lang = match[1] || 'plaintext';
        const code = match[2];
        segments.push({ type: 'code', lang: lang, content: code, index: blockIndex });
        codeBlocks.push({ lang, code }); // Optional: Store extracted code blocks

        lastIndex = codeBlockRegex.lastIndex; // Update index for next segment
        blockIndex++;
    }
    // Add the remaining text segment after the last code block
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.substring(lastIndex) });
    }

    console.log("Processed Segments (Text/Code):", segments);

    // 2. Process Segments and Build Final HTML
    let finalHtml = '';
    segments.forEach(segment => {
        if (segment.type === 'text') {
            // Process the text segment using the markdown helper
             if (segment.content && segment.content.trim()) { // Avoid processing empty/whitespace segments
                 finalHtml += processMarkdownSegment(segment.content);
             }
        } else if (segment.type === 'code') {
            // Generate HTML for the code block
            const codeId = `code-${Date.now()}-${segment.index}-${Math.random().toString(36).substring(2)}`;
            const escapedCode = escapeHtml(segment.content.trim()); // Trim code before escaping
            // FIX: Move button inside <pre>
            const codeBlockHtml = `<div class="code-block-container">
                                    <pre>
<button class="copy-code-btn" data-clipboard-target="#${codeId}" title="コードをコピー"><i class="bi bi-clipboard"></i></button>
<code id="${codeId}" class="language-${segment.lang}">${escapedCode}</code>
</pre>
                                  </div>`;
            finalHtml += codeBlockHtml; // Add code block HTML directly
        }
    });

    console.log("Final HTML with Code Blocks Correctly Interleaved:", finalHtml);
    bubbleText.innerHTML = finalHtml; // Set the final HTML

    // --- Timestamp Creation ---
    const bubbleTime = document.createElement('div');
    bubbleTime.classList.add('bubble-time');
    const nowTime = timestamp ? new Date(timestamp) : new Date();
    const hours = nowTime.getHours().toString().padStart(2, '0');
    const minutes = nowTime.getMinutes().toString().padStart(2, '0');
    bubbleTime.innerText = `${hours}:${minutes}`;
    console.log("Created Timestamp element:", bubbleTime.innerText);


    // --- Message Copy Button ---
    const copyMsgBtn = document.createElement('button');
    copyMsgBtn.classList.add('copy-msg-btn');
    copyMsgBtn.innerHTML = '<i class="bi bi-clipboard"></i>';
    copyMsgBtn.title = 'メッセージをコピー';
    copyMsgBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(originalTextForCopy)
            .then(() => {
                copyMsgBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
                copyMsgBtn.title = 'コピーしました';
                setTimeout(() => {
                    copyMsgBtn.innerHTML = '<i class="bi bi-clipboard"></i>';
                    copyMsgBtn.title = 'メッセージをコピー';
                }, 1500);
            })
            .catch(err => console.error('コピー失敗:', err));
    });


    // Append elements to bubble
    bubble.appendChild(bubbleText);
    bubble.appendChild(copyMsgBtn); // Copy button inside bubble
    bubble.appendChild(bubbleTime); // Timestamp inside bubble
    console.log("Appended text, copy button, and timestamp to bubble.");

    // Append bubble to row
    row.appendChild(bubble);

    // Append row to chat messages
    chatMessagesDiv.appendChild(row);
    console.log("Appended row to chat messages div.");

    // --- Highlight Code Blocks using Prism.js --- (修正: 同期的に実行)
    console.log("Executing Prism.highlightAllUnder...");
    try {
        // Ensure Prism is loaded before calling this
        if (typeof Prism !== 'undefined') {
            Prism.highlightAllUnder(bubble); // Highlight only within the new bubble
            console.log("Prism highlighting finished.");
        } else {
            console.warn("Prism object not found, skipping highlighting.");
        }
    } catch (e) {
        console.error("Error during Prism highlighting:", e);
    }

    // --- Code Block Copy Listener (Re-added) ---
    bubble.querySelectorAll('.copy-code-btn').forEach(btn => {
        if (!btn.dataset.listenerAttached) {
            btn.addEventListener('click', (event) => {
                const targetSelector = event.target.closest('button').getAttribute('data-clipboard-target');
                const codeElement = document.querySelector(targetSelector);
                if (codeElement) {
                    // Copy the *unescaped* text content for code blocks
                    navigator.clipboard.writeText(codeElement.textContent)
                        .then(() => {
                            const buttonElement = event.target.closest('button');
                            buttonElement.innerHTML = '<i class="bi bi-check-lg"></i>';
                            buttonElement.title = 'コピーしました';
                            setTimeout(() => {
                                buttonElement.innerHTML = '<i class="bi bi-clipboard"></i>';
                                buttonElement.title = 'コードをコピー';
                            }, 1500);
                        })
                        .catch(err => console.error('コードのコピー失敗:', err));
                }
            });
            btn.dataset.listenerAttached = 'true';
             // Assuming button HTML is generated with icon & title
        }
    });

    console.log("--- addMessageRow End (Corrected Code Block Handling) ---");
}

function buildPromptFromHistory() {
  if (!currentSession || !currentSession.messages?.length) return "";
  return currentSession.messages
    .map(m => `${m.sender}: ${m.text}`)
    .join("\n");
}

/* 
// 天気のAPI関連のコードは、グラウンディングで代替できるためコメントアウト
async function getWeatherInfoForCity(city) {
  try {
    const response = await fetch(
      `https://us-central1-fudaoxiang-chat.cloudfunctions.net/getWeatherInfo`
    );
    if (!response.ok) {
      throw new Error("Error fetching weather info");
    }
    const weatherInfo = await response.text();
    console.log("天気情報:", weatherInfo);
    return weatherInfo;
  } catch (error) {
    console.error(error);
  }
}
*/

async function endCurrentSession() {
  if (!currentSession) return;
  if (currentSession.sessionState === "finished") return;

  if (currentSession.messages && currentSession.messages.length > 0) {
    const newTitle = await summarizeSessionAsync(currentSession);
    if (typeof newTitle === "string") {
      currentSession.title = newTitle;
    } else {
      currentSession.title = currentSession.title || "無題";
    }
  } else {
    console.log("メッセージが空のため、要約は実施しません。");
  }

  currentSession.sessionState = "finished";
  currentSession.updatedAt = new Date().toISOString();

  await backupToFirebase();
  updateSideMenu();
}

async function onSendButton() {
  console.log("onSendButton called");
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  if (!currentSession) {
    console.log("現在のセッションが存在しないため、新規セッションを作成します。");
    createNewSession();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  else if (currentSession.sessionState !== "active") {
    console.log("終了済みセッションを再利用するため、active に切り替えます。");
    currentSession.sessionState = "active";
  }

  addMessageRow(message, 'self');
  input.value = '';
  scrollToBottom();

  if (currentSession.title === "無題" && message) {
    currentSession.title = message.slice(0, 10) + (message.length > 10 ? "..." : "");
  }

  currentSession.messages.push({
    sender: 'User',
    text: message,
    timestamp: new Date()
  });
  currentSession.updatedAt = new Date().toISOString();

  callGemini();

  backupToFirebase();
}

function toggleSideMenu() {
  console.log("toggleSideMenu called");
  const sideMenu = document.getElementById('side-menu');
  sideMenu.classList.toggle('open');
  if (sideMenu.classList.contains('open')) {
    updateSideMenuFromFirebase();
  }
}

async function updateSideMenuFromFirebase() {
  console.log("updateSideMenuFromFirebase called");
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。サイドメニューを更新できません。");
    return;
  }
  try {
    const querySnapshot = await db.collection("chatSessions")
                                  .where("userId", "==", currentUser.uid)
                                  .get();
    conversationSessions = [];
    querySnapshot.forEach(doc => {
      conversationSessions.push(doc.data());
    });
    updateSideMenu();

    if (currentSession) {
      const fresh = conversationSessions.find(s => s.id === currentSession.id);
      if (fresh) {
        currentSession = fresh;
      }
    }
  } catch (error) {
    console.error("サイドメニュー更新エラー:", error);
  }
}

function updateSideMenu() {
  console.log("updateSideMenu called");
  const historyDiv = document.getElementById('conversation-history');
  historyDiv.innerHTML = "";

  const activeSessions = currentSession ? [currentSession] : [];

  const finishedSessions = conversationSessions.filter(s => s.id !== currentSession?.id);

  const finishedSessionsFiltered = finishedSessions.filter(s => {
    const isEmpty = !s.messages || s.messages.length === 0;
    const isUntitled = s.title === "無題";
    return !(isEmpty && isUntitled);
  });

  activeSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  finishedSessionsFiltered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const sortedSessions = [...activeSessions, ...finishedSessionsFiltered];

  sortedSessions.forEach(session => {
    const link = document.createElement('a');
    link.href = "#";
    link.innerText = session.title;
    link.style.display = "block";
    link.style.marginBottom = "5px";
    link.style.paddingTop = "5px";
    link.style.paddingLeft = "5px";
    link.style.textDecoration = "none";
    link.style.color = "#FFFFFF";
    if (session.id === currentSession?.id) {
      link.style.fontWeight = "bold";
    }
    link.addEventListener('click', e => {
      e.preventDefault();
      loadSessionById(session.id);
      toggleSideMenu();
    });
    historyDiv.appendChild(link);
  });
}

function loadSessionById(id) {
  console.log("loadSessionById called, id=", id);
  const session = conversationSessions.find(s => s.id === id);
  if (!session) return;

  currentSession = session;

  const chatMessagesDiv = document.getElementById('chatMessages');
  chatMessagesDiv.innerHTML = "";
  lastMessageDate = "";

  (session.messages || []).forEach(item => {
    if (item.timestamp && item.timestamp.seconds) {
      item.timestamp = new Date(item.timestamp.seconds * 1000);
    }
    addMessageRow(
      item.text,
      item.sender === 'User' ? 'self' : 'other',
      item.timestamp
    );
  });
  scrollToBottom();
}

async function startNewChat() {
  console.log("startNewChat called");

  const activeEmptySession = conversationSessions.find(
    s => s.sessionState === "active" && (!s.messages || s.messages.length === 0)
  );

  if (activeEmptySession) {
    console.log("既存の空のアクティブセッションを再利用します:", activeEmptySession.id);
    currentSession = activeEmptySession;
    document.getElementById('chatMessages').innerHTML = "";
    lastMessageDate = "";
    scrollToBottom();
    return;
  }

  if (currentSession && currentSession.sessionState === "active") {
    await endCurrentSession();
  }

  createNewSession();
}

function createNewSession() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。セッションを作成できません。");
    return;
  }

  if (currentSession && currentSession.sessionState === "active" && (!currentSession.messages || currentSession.messages.length === 0)) {
    console.log("既存の空のアクティブセッションを再利用します。");
    return;
  }

  const now = new Date();
  const sessionId = Date.now().toString(36) + "-" + Math.random().toString(36).substring(2);
  const session = {
    id: sessionId,
    title: "無題",
    messages: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    sessionState: "active",
    userId: currentUser.uid
  };

  conversationSessions.push(session);
  currentSession = session;

  document.getElementById('chatMessages').innerHTML = "";
  lastMessageDate = "";

  db.collection("chatSessions").doc(sessionId).set(session).then(() => {
    console.log("新規セッションをFirestoreに作成:", sessionId);
    updateSideMenu();
  });
}

async function callGeminiApi(prompt, modelName, retryCount = 0) {
  console.log("callGeminiApi called with prompt:", prompt);

  const groundingUrl = "https://gemini-grounding.fudaoxiang-gym.workers.dev";

  try {
    const response = await fetch(`${groundingUrl}?q=${encodeURIComponent(prompt)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        console.warn("429 Too Many Requests. リトライ中...");
        await new Promise(r => setTimeout(r, 2000));
        return callGeminiApi(prompt, modelName, retryCount + 1);
      }
      throw new Error('Network response was not ok');
    }

    const resJson = await response.json();
    if (resJson && resJson.answer) {
      console.log("Grounding Gemini response:", resJson);
      return {
        answer: resJson.answer.trim(),
        sources: resJson.sources || []
      };
    } else {
      console.error("Grounding Gemini APIからの回答がありませんでした。");
      return null;
    }
  } catch (error) {
    console.error("callGeminiApiエラー:", error);
    return null;
  }
}

async function callGeminiModelSwitcher(prompt, modelName = 'gemini-2.0-flash', retryCount = 0) {
  const modelSwitcherUrl = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev";
  const payload = {
    prompt: prompt,
    model: modelName
  };

  try {
    const response = await fetch(modelSwitcherUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        console.warn("429 Too Many Requests. リトライ中...");
        await new Promise(r => setTimeout(r, 2000));
        return callGeminiModelSwitcher(prompt, modelName, retryCount + 1);
      }
      throw new Error('Network response was not ok');
    }

    const resJson = await response.json();
    if (resJson && resJson.result) {
      console.log("Model Switcher response:", resJson.result);
      return { answer: resJson.result.trim(), sources: [] };
    } else {
      console.error("Model Switcherからの回答がありませんでした。");
      return null;
    }
  } catch (error) {
    console.error("callGeminiModelSwitcherエラー:", error);
    return null;
  }
}

async function callGeminiSummary(prompt, retryCount = 0) {
  return await callGeminiModelSwitcher(prompt, retryCount);
}

async function callGemini() {
  console.log("callGemini called");
  
  const chatMessagesDiv = document.getElementById('chatMessages');
  
  const delayTime = 6000;
  let loadingRow = null;
  let loadingText = null;
  const updateTimeout = setTimeout(() => {
    loadingRow = document.createElement('div');
    loadingRow.classList.add('message-row', 'other');
    
    const elephantIcon = document.createElement('img');
    elephantIcon.classList.add('icon');
    elephantIcon.src = 'img/elephant.png';
    elephantIcon.alt = '象アイコン';
    loadingRow.appendChild(elephantIcon);
    
    const bubble = document.createElement('div');
    bubble.classList.add('bubble');
    
    loadingText = document.createElement('div');
    loadingText.classList.add('bubble-text', 'blinking-text');
    loadingText.innerText = "考え中だゾウ...";
    bubble.appendChild(loadingText);
    
    loadingRow.appendChild(bubble);
    chatMessagesDiv.appendChild(loadingRow);
    scrollToBottom();
  }, delayTime);
  
  const history = buildPromptFromHistory();
  const lastUserMessage = currentSession.messages.slice().reverse().find(m => m.sender === "User");
  const userInput = lastUserMessage ? lastUserMessage.text : "";

  let promptToSend = "";
  let skipRefinement = false;

  if (!userInput) {
    clearTimeout(updateTimeout);
    return;
  }

  const modeSelect = document.getElementById('model-select');
  const selectedMode = modeSelect ? modeSelect.value : 'normal';
  console.log("Selected Mode:", selectedMode);

  if (selectedMode === 'taiwan-mandarin') {
    promptToSend = `「${userInput}」を台湾華語に訳してください。`;
    console.log("Taiwan Mandarin Mode - Prompt:", promptToSend);
  } else if (selectedMode === 'research') {
    promptToSend = userInput;
    console.log("Research Mode - Prompt (using user input):", promptToSend);
  } else {
    promptToSend = userInput;
    console.log("Normal Mode - Prompt:", promptToSend);
  }

  // ★ モードに応じて呼び出すAPIを分岐
  let response = null;
  if (selectedMode === 'research') {
    console.log("Calling Gemini Model Switcher (for Pro model)...");
    response = await callGeminiModelSwitcher(promptToSend, 'gemini-2.5-pro-exp-03-25');
  } else {
    console.log("Calling Gemini API (Grounding - Flash model)...");
    // ★ 他のモードでは既存の callGeminiApi を使用
    response = await callGeminiApi(promptToSend, "gemini-1.5-pro"); // モデル名は現状維持 (必要なら調整)
  }

  // ★ response のチェックは共通
  if (!response || !response.answer) {
    clearTimeout(updateTimeout);
    if (loadingRow && loadingText) {
      loadingText.innerText = "回答が得られませんでした";
      setTimeout(() => loadingRow.remove(), 3000);
    }
    return;
  }
  
  let finalAnswer = response.answer;
  if (!skipRefinement) {
    const refinementPrompt = `次の回答を元に、会話の流れを参考にして語尾を「だゾウ」に変えて、自然な日本語にしてください。

【元の回答】
${response.answer}

【会話履歴（参考）】
${history}`;
    console.log("Generating refinement prompt...");
    const refined = await callGeminiApi(refinementPrompt, "gemini-1.5-pro");
    finalAnswer = refined?.answer || response.answer;
  } else {
    console.log("Skipping refinement prompt.");
  }
  
  clearTimeout(updateTimeout);
  
  if (!loadingRow) {
    addMessageRow(finalAnswer, 'other');
  } else {
    loadingText.classList.remove('blinking-text');
    loadingText.innerText = finalAnswer;

    const existingBubble = loadingRow.querySelector('.bubble');
    if (existingBubble) {
        const existingTime = existingBubble.querySelector('.bubble-time');
        if (existingTime) existingTime.remove();

        const finalBubbleTime = document.createElement('div');
        finalBubbleTime.classList.add('bubble-time');
        const finalNow = new Date();
        const finalHours = finalNow.getHours().toString().padStart(2, '0');
        const finalMinutes = finalNow.getMinutes().toString().padStart(2, '0');
        finalBubbleTime.innerText = `${finalHours}:${finalMinutes}`;
        existingBubble.appendChild(finalBubbleTime);
        console.log("Added timestamp to the final message bubble (loadingRow case).");
    }
  }
  scrollToBottom();
  
  currentSession.messages.push({
    sender: 'Gemini',
    text: finalAnswer,
    timestamp: new Date(),
    sources: response.sources || []
  });
  currentSession.updatedAt = new Date().toISOString();
  backupToFirebase();
}

async function summarizeSessionAsync(session) {
  const allText = (session.messages || []).map(m => m.text).join(" ");
  if (!allText) return session.title;
  
  const prompt = `以下の会話を15文字程度で自然な要約をしてください。タイトルの前後に括弧以外の記号は入れないこと。\n${allText}`;
  const summaryObj = await callGeminiSummary(prompt);

  let summary = summaryObj?.answer;
  if (typeof summary !== "string") {
    summary = "無題";
  }
  return summary.trim() || "無題";
}

async function updateUntitledSessions() {
  console.log("updateUntitledSessions called");
  for (const session of conversationSessions) {
    if (session.title === "無題" && session.messages && session.messages.length > 0) {
      console.log(`セッション ${session.id} のタイトルを要約処理で更新します。`);
      const summary = await summarizeSessionAsync(session);
      if (typeof summary === "string" && summary.trim() && summary.trim() !== "無題") {
        session.title = summary.trim();
        session.updatedAt = new Date().toISOString();
        await db.collection("chatSessions").doc(session.id).set(session);
      }
    }
  }
  updateSideMenu();
}

async function backupToFirebase() {
  console.log("backupToFirebase called");
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。バックアップできません。");
    return;
  }
  try {
    if (currentSession && currentSession.sessionState === "active") {
      currentSession.userId = currentUser.uid;
      await db.collection("chatSessions").doc(currentSession.id).set(currentSession);
      console.log(`アクティブなセッション "${currentSession.title}" (id=${currentSession.id}) のバックアップ成功 (ユーザー: ${currentUser.uid})`);
    } else {
      console.log("バックアップするアクティブなセッションは存在しません。");
    }
  } catch (error) {
    console.error("バックアップエラー:", error);
  }
}

function deleteLocalChats() {
  conversationSessions = [];
  currentSession = null;
  document.getElementById('chatMessages').innerHTML = "";
  updateSideMenu();
  console.log("ローカルのチャット履歴を削除しました。");
}

async function restoreFromFirebase() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。リストアできません。");
    return;
  }
  try {
    console.log("restoreFromFirebase called");
    const querySnapshot = await db.collection("chatSessions")
                                  .where("userId", "==", currentUser.uid)
                                  .get();
    conversationSessions = [];
    querySnapshot.forEach(doc => {
      conversationSessions.push(doc.data());
    });
    document.getElementById('chatMessages').innerHTML = "";
    currentSession = null;
    updateSideMenu();
    console.log("リストア完了");
  } catch (error) {
    console.error("リストアエラー:", error);
  }
}

async function summarizeAllSessions() {
  try {
    console.log("summarizeAllSessions called");
    for (const session of conversationSessions) {
      if (session.sessionState === "finished") {
        const newTitle = await summarizeSessionAsync(session);
        session.title = newTitle;
        session.updatedAt = new Date().toISOString();
      }
    }
    await backupToFirebase();
    updateSideMenu();
    console.log("全セッションの要約が完了しました。");
  } catch (error) {
    console.error("要約中にエラー:", error);
  }
}

// 吹き出しのテキストの長さに応じてフォントサイズを調整する関数
function adjustSpeechBubbleFontSize() {
  const bubble = document.getElementById('elephantBubble');
  if (!bubble) return;
  
  // 吹き出しの最大幅を取得
  const maxWidth = bubble.offsetWidth;
  
  // テキストの長さをチェック
  const textLength = bubble.textContent.length;
  
  // テキストの長さに応じてフォントサイズを調整
  if (textLength > 50) {
    bubble.classList.add('long');
  } else {
    bubble.classList.remove('long');
  }
  
  // 吹き出しの幅が最大幅を超えているかチェック
  if (bubble.scrollWidth > maxWidth) {
    // さらにフォントサイズを小さくするクラスを追加
    bubble.classList.add('long');
  }
}

// 吹き出しのテキストを設定する関数
function setSpeechBubbleText(text) {
  const bubble = document.getElementById('elephantBubble');
  if (!bubble) return;
  
  bubble.textContent = text;
  bubble.classList.add('visible');
  
  // フォントサイズを調整
  adjustSpeechBubbleFontSize();
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOMContentLoaded event fired");

  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      console.log("Send button clicked");
      onSendButton();
    });
  }

  const hamburger = document.getElementById('hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function() {
      console.log("Hamburger clicked");
      toggleSideMenu();
    });
  }

  const closeMenuBtn = document.getElementById('close-menu');
  if (closeMenuBtn) {
    closeMenuBtn.addEventListener('click', function() {
      console.log("Close menu clicked");
      toggleSideMenu();
    });
  }

  const newChatBtn = document.getElementById('new-chat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', function() {
      console.log("New chat clicked");
      startNewChat();
    });
  }

  const restoreBtn = document.getElementById('restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Restore clicked");
      restoreFromFirebase();
    });
  }

  const manualBackupBtn = document.getElementById('manual-backup-btn');
  if (manualBackupBtn) {
    manualBackupBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Manual backup clicked");
      backupToFirebase();
    });
  }

  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Delete all chats clicked");
      deleteLocalChats();
    });
  }

  const footerDropdown = document.getElementById('footer-dropdown');
  if (footerDropdown) {
    footerDropdown.addEventListener('click', function(e) {
      console.log("Footer dropdown clicked");
      this.classList.toggle('open');
      e.stopPropagation();
    });
  }

  document.addEventListener('click', function handleOutsideClick(e) {
    const sideMenu = document.getElementById('side-menu');
    const hamburger = document.getElementById('hamburger');
    const footerDropdown = document.getElementById('footer-dropdown');

    // サイドメニューが開いていて、クリックがメニュー内でもハンバーガーでもない場合
    if (sideMenu.classList.contains('open') && 
        !sideMenu.contains(e.target) && 
        !hamburger.contains(e.target)) {
      sideMenu.classList.remove('open');
    }

    // フッターのドロップダウンが開いていて、クリックがドロップダウン内でもアイコンでもない場合
    if (footerDropdown.classList.contains('open') && 
        !footerDropdown.contains(e.target)) {
      footerDropdown.classList.remove('open');
    }
  });

  window.addEventListener('beforeunload', function() {
    backupToFirebase();
  });

  restoreFromFirebase().then(() => {
    updateUntitledSessions();
    if (!conversationSessions.some(s => s.sessionState === "active")) {
      createNewSession();
    }
  });

  // ===============================
  // 象の吹き出し機能
  // ===============================
  const elephantImg = document.getElementById("elephantImg");
  const elephantBubble = document.getElementById("elephantBubble");

  // 都市の緯度経度
  const cities = [
    { name: "台南", latitude: 23.1417, longitude: 120.2513 },
    { name: "台北", latitude: 25.0330, longitude: 121.5654 },
    { name: "台中", latitude: 24.1477, longitude: 120.6736 },
    { name: "高雄", latitude: 22.6273, longitude: 120.3014 },
    { name: "台東", latitude: 22.7583, longitude: 121.1444 },
    { name: "花蓮", latitude: 23.9769, longitude: 121.5514 },
    { name: "ホノルル", latitude: 21.3069, longitude: -157.8583 },
    { name: "サンフランシスコ", latitude: 37.7749, longitude: -122.4194 },
    { name: "ニューヨーク", latitude: 40.7128, longitude: -74.0060 }
  ];

  // 方角を計算する関数
  function calculateDirection(lat1, lon1, lat2, lon2) {
    // 緯度経度をラジアンに変換
    const lat1Rad = lat1 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;
    
    // 方角を計算（度数法）
    const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);
    let bearing = Math.atan2(y, x) * (180 / Math.PI);
    bearing = (bearing + 360) % 360; // 0-360度に変換

    // 方角を日本語の16方位に変換
    const directions = [
      "北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
      "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"
    ];
    const index = Math.round(bearing / 22.5) % 16;
    return directions[index];
  }

  // 2点間の距離を計算する関数（Haversine formula）
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球の半径（km）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return Math.round(distance); // 整数に丸める
  }

  // ランダムな都市を選択する関数
  function getRandomCity() {
    const randomIndex = Math.floor(Math.random() * cities.length);
    return cities[randomIndex];
  }

  // GPS情報を取得して選択された都市との距離と方向を計算する関数
  function getCityInfo(city) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject("お使いのブラウザは位置情報をサポートしていません。");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const currentLat = position.coords.latitude;
          const currentLon = position.coords.longitude;
          
          const distance = calculateDistance(
            currentLat, currentLon, 
            city.latitude, city.longitude
          );
          
          const direction = calculateDirection(
            currentLat, currentLon, 
            city.latitude, city.longitude
          );
          
          resolve({ city: city.name, distance, direction });
        },
        (error) => {
          let errorMessage = "位置情報の取得に失敗しました。";
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "位置情報の利用が許可されていません。";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "位置情報を取得できませんでした。";
              break;
            case error.TIMEOUT:
              errorMessage = "位置情報の取得がタイムアウトしました。";
              break;
          }
          reject(errorMessage);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  }

  if (elephantImg && elephantBubble) {
    elephantImg.addEventListener("click", function() {
      // 吹き出しが表示されている場合は非表示に、非表示の場合は表示する
      if (elephantBubble.classList.contains("visible")) {
        elephantBubble.classList.remove("visible");
      } else {
        // ランダムな都市を選択
        const randomCity = getRandomCity();
        
        // 位置情報を取得して選択された都市との距離と方向を計算
        getCityInfo(randomCity)
          .then(info => {
            // 吹き出しの内容を設定
            setSpeechBubbleText(`${info.city}は${info.direction}${info.distance}kmだゾウ！`);
            
            // 6秒後に吹き出しを非表示にする
            setTimeout(() => {
              elephantBubble.classList.remove("visible");
            }, 6000);
          })
          .catch(error => {
            // エラーメッセージを表示
            setSpeechBubbleText(error);
            
            // 6秒後に吹き出しを非表示にする
            setTimeout(() => {
              elephantBubble.classList.remove("visible");
            }, 6000);
          });
      }
    });
  }

  // ウィンドウのリサイズ時にフォントサイズを再調整
  window.addEventListener('resize', adjustSpeechBubbleFontSize);

  // 認証状態の監視とUI更新 (単一ユーザー前提)
  firebase.auth().onAuthStateChanged((user) => {
    const userEmailSpan = document.getElementById('user-email');
    if (user) {
      console.log("ログイン中のユーザー:", user.email);
      if (userEmailSpan) {
        userEmailSpan.textContent = user.email;
      }
      // ログイン時にリストアなどを実行 (既存の処理があれば活かす)
      // restoreFromFirebase(); // 必要に応じてコメント解除
      // updateSideMenu(); // 必要に応じてコメント解除
    } else {
      console.log("ユーザーはログアウトしています。");
      if (userEmailSpan) {
        userEmailSpan.textContent = ''; // メールアドレスをクリア
      }
      // HTML側でも認証チェックしているので、ここでのリダイレクトは不要な場合が多い
      // if (window.location.pathname !== '/login.html') {
      //   window.location.href = "login.html";
      // }
    }
  });

  // ログアウトリンクのイベントリスナー
  const logoutLink = document.getElementById('logout-link');
  if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault(); // デフォルトのリンク動作をキャンセル
      logout();
    });
  } else {
    console.error("Logout link not found in DOMContentLoaded");
  }
});

// ===== ここから追加 =====
// ログアウト関数
function logout() {
  firebase.auth().signOut().then(() => {
    console.log("ログアウトしました");
    // ログアウト後の処理 (ログインページへリダイレクト)
    window.location.href = "login.html";
  }).catch((error) => {
    console.error("ログアウトエラー:", error);
  });
}
// ===== ここまで追加 =====

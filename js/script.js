// ==============================
// グローバル変数
// ==============================
let conversationSessions = []; 
let currentSession = null;     
let lastMessageDate = "";      
let isDeleteMode = false; // 追加: 削除モードの状態
let recognition = null; // 追加: SpeechRecognition インスタンス
let isRecording = false; // 追加: 録音状態フラグ
let isCreatingNewSession = false; // ★ New Chat 連打防止フラグ

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


function addMessageRow(text, sender, timestamp = null, sources = null) {
    console.log("--- addMessageRow Start (Grounding Enabled, Sources Hidden) ---");
    console.log("Original Text:", text);
    // sources はコンソールにはログ出力するが、表示しない
    if (sources) {
        console.log("Received Sources (Hidden from UI):", sources);
    }

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

    // Append bubble to row (grounding の後に追加するように変更)
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
    await createNewSession();
  }
  else if (currentSession.sessionState !== "active") {
    console.log("終了済みセッションを再利用するため、active に切り替えます。");
    currentSession.sessionState = "active";
    currentSession.updatedAt = new Date().toISOString();
  }

  addMessageRow(message, 'self');
  input.value = '';
  scrollToBottom();

  currentSession.messages.push({
    sender: 'User',
    text: message,
    timestamp: new Date()
  });
  currentSession.updatedAt = new Date().toISOString();

  await callGemini(message);
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
      let sessionData = doc.data();
      // --- Timestamp 変換処理を追加 ---
      if (sessionData.createdAt && sessionData.createdAt.toDate) {
          sessionData.createdAt = sessionData.createdAt.toDate();
      }
      if (sessionData.updatedAt && sessionData.updatedAt.toDate) {
          sessionData.updatedAt = sessionData.updatedAt.toDate();
      }
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
          sessionData.messages = sessionData.messages.map(msg => {
              const localMsg = { ...msg };
              if (localMsg.timestamp && localMsg.timestamp.toDate) {
                  localMsg.timestamp = localMsg.timestamp.toDate();
              }
              // sources は Firestore に保存していないので、何もしない
              return localMsg;
          });
      }
      // --- 変換処理ここまで ---
      conversationSessions.push(sessionData);
    });

    // ★ 追加: ローカルの currentSession の方が新しければ上書き ★
    if (currentSession) {
        const sessionIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
        if (sessionIndex !== -1) {
            // Firestore から取得したデータとローカルの updatedAt を比較
            const firestoreUpdatedAt = conversationSessions[sessionIndex].updatedAt;
            const localUpdatedAt = currentSession.updatedAt instanceof Date ? currentSession.updatedAt : new Date(currentSession.updatedAt);

            // getTime() で比較するのが確実
            if (firestoreUpdatedAt && localUpdatedAt && localUpdatedAt.getTime() > firestoreUpdatedAt.getTime()) {
                 console.log(`Local currentSession (ID: ${currentSession.id}) is newer. Updating conversationSessions array.`);
                 conversationSessions[sessionIndex] = { ...currentSession }; // ローカルのデータで上書き
            } else if (!firestoreUpdatedAt && localUpdatedAt) {
                 // Firestore に updatedAt がないがローカルにはある場合もローカル優先
                 console.log(`Local currentSession (ID: ${currentSession.id}) has updatedAt, Firestore version doesn't. Updating conversationSessions array.`);
                 conversationSessions[sessionIndex] = { ...currentSession };
            }
        } else {
             // Firestore にデータがないがローカルには currentSession が存在する場合 (バックアップ直後など)
             console.log(`Local currentSession (ID: ${currentSession.id}) not found in Firestore results after update. Adding it to conversationSessions array.`);
             conversationSessions.push({ ...currentSession });
        }
        // ★ currentSession を再設定 (上書きや追加で参照が変わる可能性があるため) ★
        currentSession = conversationSessions.find(s => s.id === currentSession.id);
    }
    // ★ 追加ここまで ★

    updateSideMenu(); // 削除モードの状態に関わらず更新

    /* 不要になった処理 (currentSession の再検索は上記で行う)
    if (currentSession) {
      const fresh = conversationSessions.find(s => s.id === currentSession.id);
      if (fresh) {
        currentSession = fresh;
      }
    }
    */
  } catch (error) {
    console.error("サイドメニュー更新エラー:", error);
  }
}

function updateSideMenu() {
  console.log("updateSideMenu called, deleteMode=", isDeleteMode); // 削除モードの状態をログ出力
  const historyDiv = document.getElementById('conversation-history');
  historyDiv.innerHTML = "";

  // 削除モードに応じてクラスをトグル
  if (isDeleteMode) {
    historyDiv.classList.add('delete-mode');
  } else {
    historyDiv.classList.remove('delete-mode');
  }

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
    link.style.display = "block"; // block のまま
    link.style.position = "relative"; // アイコンのposition:absolute用
    link.style.marginBottom = "5px";
    // link.style.paddingTop = "5px"; // CSSで管理するため削除
    // link.style.paddingLeft = "5px"; // CSSで管理するため削除
    link.style.padding = "5px 10px"; // 左右に少しパディングを追加
    link.style.textDecoration = "none";
    link.style.color = "#FFFFFF"; // CSSで管理するため削除 (CSS側で!importantがあれば不要)
    if (session.id === currentSession?.id) {
      link.style.fontWeight = "bold"; // CSSで管理するため削除 (CSS側で管理推奨)
    }

    // 削除モードでない場合のみ、セッション読み込みのイベントリスナーを追加
    if (!isDeleteMode) {
        link.addEventListener('click', e => {
            e.preventDefault();
            loadSessionById(session.id);
            toggleSideMenu();
        });
    }

    // 削除モードの場合、ゴミ箱アイコンを追加
    if (isDeleteMode) {
      const deleteIcon = document.createElement('i');
      deleteIcon.classList.add('bi', 'bi-trash', 'delete-thread-icon');
      deleteIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // リンクのクリックイベント発火を防ぐ
        deleteSessionById(session.id);
      });
      link.appendChild(deleteIcon);
    }

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
  // ★ 連打防止チェック
  if (isCreatingNewSession) {
    console.log("Already creating a new session, ignoring click.");
    return;
  }
  isCreatingNewSession = true; // フラグを立てる
  showThinkingIndicator(true); // インジケーター表示

  try {
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

    await createNewSession();
  } catch (error) {
    console.error("Error starting new chat:", error);
    // エラーメッセージをユーザーに表示する処理を追加しても良い
  } finally {
    showThinkingIndicator(false); // インジケーター非表示
    isCreatingNewSession = false; // フラグを下ろす
  }
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
  const firestoreTimestampNow = firebase.firestore.Timestamp.fromDate(now); 
  const sessionId = Date.now().toString(36) + "-" + Math.random().toString(36).substring(2);
  const sessionDataToSave = {
    id: sessionId,
    title: "無題",
    messages: [],
    createdAt: firestoreTimestampNow,
    updatedAt: firestoreTimestampNow,
    sessionState: "active",
    userId: currentUser.uid
  };
  const localSession = { ...sessionDataToSave };
  conversationSessions.push(localSession);
  currentSession = localSession;
  document.getElementById('chatMessages').innerHTML = "";
  lastMessageDate = "";

  // ★ パスを /chatSessions/{sessionId} に変更 ★
  db.collection("chatSessions").doc(sessionId).set(sessionDataToSave).then(() => {
    console.log("新規セッションをFirestoreに作成 (/chatSessions):", sessionId);
    updateSideMenu();
  }).catch(error => {
      console.error("新規セッションのFirestore書き込みエラー:", error);
  });
}

// ===== API呼び出し関数 (Model Switcher のみ) =====
// async function callGeminiApi(...) { /* 削除 */ }

// Gemini Model Switcher Workerを呼び出す関数 (デフォルトモデル名を 1.5-pro に変更)
async function callGeminiModelSwitcher(prompt, modelName = 'gemini-1.5-pro', useGrounding = false, toolName = null, retryCount = 0) {
    const workerUrl = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev"; 
    const maxRetries = 2;

    try {
        let response;
        let requestBody;
        let requestUrl = workerUrl;
        let requestMethod = 'POST';
        let headers = { 'Content-Type': 'application/json' };

        if (useGrounding && toolName) { 
            requestMethod = 'GET';
            const params = new URLSearchParams({
                q: prompt,
                model: modelName,
                tool: toolName 
            });
            requestUrl = `${workerUrl}?${params.toString()}`;
            console.log(`[DEBUG] Grounding Request - URL: ${requestUrl}`);
            headers = {};
            requestBody = undefined;
        } else {
            requestMethod = 'POST';
            // ★ Workerに渡すモデル名を引数で受け取ったものに固定 ★
            requestBody = JSON.stringify({ prompt: prompt, modelName: modelName }); 
            console.log(`[DEBUG] Normal Request - URL: ${requestUrl}, Model: ${modelName}, Body: ${requestBody}`);
        }

        console.log(`[DEBUG] Sending request to Worker:`, {
             url: requestUrl,
             method: requestMethod,
             headers: headers,
             body: (requestMethod === 'GET') ? '(GET request has no body)' : requestBody
         });

        response = await fetch(requestUrl, {
            method: requestMethod,
            headers: headers,
            body: requestBody
        });

        if (!response.ok) {
             const errorText = await response.text();
            console.error(`Worker Error (${response.status}): ${errorText}`);
            let errorMessage = `Worker request failed with status ${response.status}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error) errorMessage += `: ${errorJson.error}`;
            } catch (e) { /* ignore */ }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log("[DEBUG] Received data from Worker:", JSON.stringify(data, null, 2));

        if (data && data.answer !== undefined) {
            return data;
        } else {
            console.error("Unexpected response format from worker (expected { answer: ..., sources?: ... }):", data);
            throw new Error("Invalid response format from worker.");
        }

    } catch (error) {
        console.error(`Error calling Gemini Model Switcher (Attempt ${retryCount + 1}):`, error);
        if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return callGeminiModelSwitcher(prompt, modelName, useGrounding, toolName, retryCount + 1); 
        } else {
             throw error;
        }
    }
}

async function callGeminiSummary(prompt, retryCount = 0) {
  return await callGeminiModelSwitcher(prompt, 'gemini-1.5-flash', retryCount);
}

// ===== メインの Gemini 呼び出し関数 =====
async function callGemini(userInput) {
    // showThinkingIndicator(true); // ← 既存の静的インジケーターは一旦コメントアウトするか、併用を検討

    const modelSelect = document.getElementById('model-select');
    const selectedModelValue = modelSelect.value;
    const isGroundingModel = (selectedModelValue === 'gemini-1.5-pro' || selectedModelValue === 'gemini-2.0-flash');
    const isTaiwanMode = (selectedModelValue === 'gemini-1.5-pro-tw');

    // ★ 考え中メッセージ表示の準備 (old.js から移植) ★
    const chatMessagesDiv = document.getElementById('chatMessages');
    const delayTime = 3000; // 3秒後に表示（6秒は少し長いかもしれないので調整）
    let loadingRow = null;
    let loadingText = null;
    const updateTimeout = setTimeout(() => {
        // 他のメッセージがまだなければインジケーターを追加
        // (既に他のメッセージがあれば、すぐに応答が返ると期待し、ちらつき防止のため追加しないことも検討)
        // もしくは、常に最後に追加するようにする
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
        console.log("Displayed '考え中だゾウ...' message.");
    }, delayTime);
    // ★ ここまで追加 ★

    try {
        let targetModelForFirstCall = selectedModelValue;
        let promptToSendForFirstCall = "";
        let useGroundingForFirstCall = false;
        let toolNameForGrounding = null;

        console.log(`callGemini called`);
        console.log(`Selected Model Value: ${selectedModelValue}`);
        console.log(`Is Taiwan Mode?: ${isTaiwanMode}`);
        console.log(`Is Grounding Model?: ${isGroundingModel}`);

        // ★ モードに応じてパラメータを設定 ★
        if (isTaiwanMode) {
            // 台湾華語モード (第1段階: 翻訳のみ)
            targetModelForFirstCall = 'gemini-1.5-pro';
            promptToSendForFirstCall = `「${userInput}」を台湾で使われる繁体字中国語（台湾華語）に自然に訳してください。`;
            useGroundingForFirstCall = false;
            toolNameForGrounding = null;
            console.log(`Taiwan Mode - Translation Prompt: ${promptToSendForFirstCall}`);
        } else if (isGroundingModel) {
             // --- Grounding モデルの場合 (ノーマル または じっくり) ---
             promptToSendForFirstCall = buildPromptFromHistory();
             useGroundingForFirstCall = true;
             // ★ 選択された値に応じてモデルとツールを決定 ★
             if (selectedModelValue === 'gemini-1.5-pro') { // じっくり
                 targetModelForFirstCall = 'gemini-1.5-pro';
                 toolNameForGrounding = 'googleSearchRetrieval';
                 console.log(`Grounding Mode (1.5 Pro / じっくり) - Prompt: ${promptToSendForFirstCall}, Tool: ${toolNameForGrounding}`);
             } else { // ノーマル (gemini-2.0-flash)
                 targetModelForFirstCall = 'gemini-2.0-flash'; // value から -grounding を除く
                 toolNameForGrounding = 'googleSearch';
                 console.log(`Grounding Mode (2.0 Flash / ノーマル) - Prompt: ${promptToSendForFirstCall}, Tool: ${toolNameForGrounding}`);
             }
        } else {
             // --- Grounding でないモデル (現状ここには来ないはず) ---
             // もし Grounding しないモードを追加する場合はここに処理を書く
             promptToSendForFirstCall = buildPromptFromHistory();
             targetModelForFirstCall = selectedModelValue;
             useGroundingForFirstCall = false; 
             toolNameForGrounding = null;
             console.log(`Non-Grounding Mode: ${targetModelForFirstCall} - Prompt: ${promptToSendForFirstCall}`);
        }

        console.log(`[DEBUG] Checking parameters before API call: useGrounding = ${useGroundingForFirstCall}, Tool name = ${toolNameForGrounding}`);
        console.log(`Calling Model Switcher (Initial) with model: ${targetModelForFirstCall}, grounding: ${useGroundingForFirstCall}, tool: ${toolNameForGrounding}`);

        // --- API 呼び出し --- 
        const data = await callGeminiModelSwitcher(
            promptToSendForFirstCall,
            targetModelForFirstCall, 
            useGroundingForFirstCall, 
            toolNameForGrounding
        );
        
        // ★ 考え中メッセージをクリア ★
        clearTimeout(updateTimeout);
        // showThinkingIndicator(false); // ← 既存のインジケーターも非表示

        let finalAnswer = null;
        let finalSources = null;

        if (data && data.answer !== undefined) {
            finalAnswer = data.answer;
            finalSources = data.sources;
            
            // ★ 語尾変換処理 (Refinement) を復活 ★
            const shouldRefine = true; 
            if (shouldRefine) {
                 console.log(`Generating refinement prompt for: ${finalAnswer}`);
                 // buildRefinementPrompt は originalAnswer のみ受け取るように修正した想定
                 const refinementPrompt = await buildRefinementPrompt("語尾変更", finalAnswer); 
                 console.log('Building refinement prompt...');
                 const refinementModel = 'gemini-2.0-flash';
                 console.log(`Calling Model Switcher (Refinement) with model: ${refinementModel}, grounding: false`);
                 try {
                     // Refinement は Grounding なしで POST
                     const refinementData = await callGeminiModelSwitcher(refinementPrompt, refinementModel, false, null);
                     if (refinementData && refinementData.answer) {
                         finalAnswer = refinementData.answer; // 語尾変換後の回答で上書き
                         console.log('Refinement successful.');
                     } else {
                         console.warn('Refinement failed or returned no answer, using original answer.');
                     }
                 } catch (refinementError) {
                      console.error("Error during refinement call:", refinementError);
                      console.warn("Using original answer due to refinement error.");
                 }
            }

            // ★ AIの応答をセッションデータに追加 ★
            currentSession.messages.push({
                sender: 'Gemini',
                text: finalAnswer,
                timestamp: new Date(),
                sources: finalSources // sources は Refinement 前のものを保持
            });
            currentSession.updatedAt = new Date().toISOString(); // backupでTimestampになる

            // ★ 最終的な回答を表示 (考え中メッセージを更新 or 新規追加) ★
            if (loadingRow && loadingText) {
                console.log("Updating '考え中だゾウ...' message with final answer.");
                loadingText.classList.remove('blinking-text');
                // loadingText の内容を finalAnswer で更新する前に、
                // finalAnswer を addMessageRow と同様に HTML に変換する必要がある
                // addMessageRow のロジックを再利用するか、簡略化する
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = processMarkdownSegment(finalAnswer); // Markdown処理だけ行う
                // コードブロックなどの処理も必要なら addMessageRow のロジックを呼ぶ
                loadingText.innerHTML = tempDiv.innerHTML; 
                
                // タイムスタンプを追加 (old.js のロジック参考に)
                const existingBubble = loadingRow.querySelector('.bubble');
                if (existingBubble) {
                    const existingTime = existingBubble.querySelector('.bubble-time');
                    if (existingTime) existingTime.remove(); // 古いタイムスタンプがあれば削除

                    const finalBubbleTime = document.createElement('div');
                    finalBubbleTime.classList.add('bubble-time');
                    const finalNow = new Date(); // 応答表示時の時刻
                    const finalHours = finalNow.getHours().toString().padStart(2, '0');
                    const finalMinutes = finalNow.getMinutes().toString().padStart(2, '0');
                    finalBubbleTime.innerText = `${finalHours}:${finalMinutes}`;
                    existingBubble.appendChild(finalBubbleTime);
                    
                    // コピーボタンも必要なら追加
                    // ...
                    Prism.highlightAllUnder(existingBubble); // コードハイライトも忘れずに
                }
            } else {
                console.log("Adding new message row for final answer (no loading indicator was shown).");
                addMessageRow(finalAnswer, 'other', new Date().getTime(), finalSources);
            }
            scrollToBottom(); // ★ 表示後にスクロール ★

            // ★★★ セッションタイトル要約とバックアップを成功ブロック内に移動 ★★★
            if (currentSession && currentSession.title === "無題") {
                console.log("Current session is untitled, attempting to summarize...");
                summarizeSessionAsync(currentSession).then(async (summary) => {
                     if (summary && summary !== "無題") {
                         currentSession.title = summary;
                         currentSession.updatedAt = new Date().toISOString(); 
                         console.log("Session title updated by summary:", summary);
                         updateSideMenu();
                         await backupToFirebase(); // タイトル更新後にバックアップ
                     } else {
                         await backupToFirebase(); // 要約失敗/不要でもバックアップ
                     }
                }).catch(async (error) => {
                     console.error("Background session summary failed:", error);
                     await backupToFirebase(); // 要約エラーでもバックアップ
                });
            } else {
                 await backupToFirebase(); // タイトルありの場合もここでバックアップ
            }
            // ★★★ 移動ここまで ★★★

        } else { // data が不正だった場合
            console.error("Received null or invalid response from initial worker call.");
            if (loadingRow && loadingText) {
                console.log("Updating '考え中だゾウ...' message with final answer.");
                loadingText.classList.remove('blinking-text');
                // loadingText の内容を finalAnswer で更新する前に、
                // finalAnswer を addMessageRow と同様に HTML に変換する必要がある
                // addMessageRow のロジックを再利用するか、簡略化する
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = processMarkdownSegment(finalAnswer); // Markdown処理だけ行う
                // コードブロックなどの処理も必要なら addMessageRow のロジックを呼ぶ
                loadingText.innerHTML = tempDiv.innerHTML; 
                
                // タイムスタンプを追加 (old.js のロジック参考に)
                const existingBubble = loadingRow.querySelector('.bubble');
                if (existingBubble) {
                    const existingTime = existingBubble.querySelector('.bubble-time');
                    if (existingTime) existingTime.remove(); // 古いタイムスタンプがあれば削除

                    const finalBubbleTime = document.createElement('div');
                    finalBubbleTime.classList.add('bubble-time');
                    const finalNow = new Date(); // 応答表示時の時刻
                    const finalHours = finalNow.getHours().toString().padStart(2, '0');
                    const finalMinutes = finalNow.getMinutes().toString().padStart(2, '0');
                    finalBubbleTime.innerText = `${finalHours}:${finalMinutes}`;
                    existingBubble.appendChild(finalBubbleTime);
                    
                    // コピーボタンも必要なら追加
                    // ...
                    Prism.highlightAllUnder(existingBubble); // コードハイライトも忘れずに
                }
            } else {
                console.log("Adding new message row for final answer (no loading indicator was shown).");
                addMessageRow(finalAnswer, 'other', new Date().getTime(), finalSources);
            }
            scrollToBottom(); // ★ 表示後にスクロール ★

            // ★★★ セッションタイトル要約とバックアップを成功ブロック内に移動 ★★★
            if (currentSession && currentSession.title === "無題") {
                console.log("Current session is untitled, attempting to summarize...");
                summarizeSessionAsync(currentSession).then(async (summary) => {
                     if (summary && summary !== "無題") {
                         currentSession.title = summary;
                         currentSession.updatedAt = new Date().toISOString(); 
                         console.log("Session title updated by summary:", summary);
                         updateSideMenu();
                         await backupToFirebase(); // タイトル更新後にバックアップ
                     } else {
                         await backupToFirebase(); // 要約失敗/不要でもバックアップ
                     }
                }).catch(async (error) => {
                     console.error("Background session summary failed:", error);
                     await backupToFirebase(); // 要約エラーでもバックアップ
                });
            } else {
                 await backupToFirebase(); // タイトルありの場合もここでバックアップ
            }
            // ★★★ 移動ここまで ★★★

            // ★★★ ここにあったタイトル要約・バックアップ処理は上記 if ブロック内に移動した ★★★

        }

    } catch (error) {
        // ★ 考え中メッセージをクリア/エラー表示に更新 ★
        clearTimeout(updateTimeout);
        // showThinkingIndicator(false);
        console.error("Error in callGemini:", error);
        if (loadingRow && loadingText) {
             loadingText.classList.remove('blinking-text');
             loadingText.innerText = `エラーが発生しました: ${error.message}`;
        } else {
             addMessageRow(`エラーが発生しました: ${error.message}`, 'other');
        }
        // ★ エラー発生時もバックアップを試みる (エラー処理を追加) ★
        try {
            await backupToFirebase();
        } catch (backupError) {
            console.error("Backup failed after error in callGemini:", backupError);
        }
    } // ← この閉じ括弧が callGemini 関数の try...catch ブロック全体を閉じるもの
} // ← この閉じ括弧が callGemini 関数自体を閉じるもの (これが不足している可能性)

// ★ buildRefinementPrompt の修正 (台湾華語モードを考慮) ★
async function buildRefinementPrompt(context, originalAnswer) {
    console.log("Building refinement prompt...");
    // context には、台湾華語モードの場合は翻訳結果、それ以外は会話履歴が入る想定
    // 台湾華語モードかどうかの判定はここでは難しいので、プロンプトを汎用的にする
    return `以下のテキストの語尾を、親しみやすいキャラクターのように「だゾウ」に変えてください。元のテキストの意味や言語（例：中国語）は維持してください。

【元のテキスト】
${originalAnswer}

【修正後のテキスト】`;
}

async function summarizeSessionAsync(session) {
  const allText = (session.messages || []).map(m => m.text).join(" ");
  if (!allText) return session.title;
  
  const prompt = `以下の会話を15文字程度で自然なタイトルに要約してください。タイトルの前後に記号（括弧を含む）は一切付けないでください。\n${allText}`;
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
  if (!currentSession || !currentSession.id) { 
    console.warn("バックアップするカレントセッションが存在しないか、IDがありません。");
    return;
  }

  try {
    const sessionDataToSave = { ...currentSession };
    sessionDataToSave.userId = currentUser.uid;
    sessionDataToSave.updatedAt = firebase.firestore.Timestamp.now();

    // messages 配列内の timestamp を Firestore Timestamp に変換し、sources を削除
    if (sessionDataToSave.messages && Array.isArray(sessionDataToSave.messages)) {
      sessionDataToSave.messages = sessionDataToSave.messages.map(msg => {
        const newMsg = { ...msg }; // メッセージオブジェクトをコピー
        
        // timestamp を Firestore Timestamp に変換
        if (newMsg.timestamp) {
          try {
            const date = new Date(getTimestampValue(newMsg.timestamp)); // 既存の値からDateオブジェクト作成
            newMsg.timestamp = firebase.firestore.Timestamp.fromDate(date);
          } catch (e) {
            console.warn("Failed to convert timestamp for message:", msg, e);
            // 変換に失敗した場合は元の値かnull/undefinedを設定
            // newMsg.timestamp = null; 
          }
        } else {
           newMsg.timestamp = firebase.firestore.Timestamp.now(); // timestamp がなければ現在時刻
        }
        
        // ★ デバッグのため sources を削除 ★
        delete newMsg.sources;
        
        return newMsg;
      });
    }

    // createdAt も Firestore Timestamp に変換 (もし文字列なら)
    if (sessionDataToSave.createdAt && typeof sessionDataToSave.createdAt === 'string') {
        try {
            sessionDataToSave.createdAt = firebase.firestore.Timestamp.fromDate(new Date(sessionDataToSave.createdAt));
        } catch(e) {
             console.warn("Failed to convert createdAt:", sessionDataToSave.createdAt, e);
             // 失敗した場合は現在時刻などで代替も検討
             sessionDataToSave.createdAt = firebase.firestore.Timestamp.now(); 
        }
    } else if (!sessionDataToSave.createdAt) {
        sessionDataToSave.createdAt = firebase.firestore.Timestamp.now(); // なければ現在時刻
    }

    const sessionDocRef = db.collection("chatSessions").doc(sessionDataToSave.id);
    
    // ★ 整形したデータ (sessionDataToSave) を書き込む ★
    await sessionDocRef.set(sessionDataToSave); 
    console.log(`Session ${sessionDataToSave.id} backed up successfully (/chatSessions).`);

    // ★ 追加: ローカルの currentSession も更新 ★
    if (currentSession && currentSession.id === sessionDataToSave.id) {
        currentSession.messages = sessionDataToSave.messages.map(msg => {
             // Firestore Timestamp を Date オブジェクトに戻す
             const localMsg = { ...msg };
             if (localMsg.timestamp && localMsg.timestamp.toDate) {
                 localMsg.timestamp = localMsg.timestamp.toDate();
             }
             // sources は sessionDataToSave にないので、ここでは追加しない
             return localMsg;
         });
        currentSession.updatedAt = sessionDataToSave.updatedAt.toDate(); // Timestamp を Date に戻す
        console.log("Local currentSession updated after successful backup.");
    }
    // ★ 追加ここまで ★

  } catch (error) {
    // ★ 詳細なエラー情報をログに出力 ★
    console.error(`バックアップエラー (Session ID: ${currentSession?.id}):`, error);
    if (error.code) {
      console.error(`Firestore Error Code: ${error.code}`);
    }
    if (error.message) {
      console.error(`Firestore Error Message: ${error.message}`);
    }
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
  console.log("Current User UID:", currentUser.uid);

  try {
    console.log("restoreFromFirebase called");
    const querySnapshot = await db.collection("chatSessions")
                                  .where("userId", "==", currentUser.uid)
                                  .get();
    conversationSessions = [];
    querySnapshot.forEach(doc => {
      let sessionData = doc.data();
      // --- Timestamp 変換処理を追加 ---
      if (sessionData.createdAt && sessionData.createdAt.toDate) {
          sessionData.createdAt = sessionData.createdAt.toDate();
      }
      if (sessionData.updatedAt && sessionData.updatedAt.toDate) {
          sessionData.updatedAt = sessionData.updatedAt.toDate();
      }
      if (sessionData.messages && Array.isArray(sessionData.messages)) {
          sessionData.messages = sessionData.messages.map(msg => {
              const localMsg = { ...msg };
              if (localMsg.timestamp && localMsg.timestamp.toDate) {
                  localMsg.timestamp = localMsg.timestamp.toDate();
              }
              // sources は Firestore に保存していないので、何もしない
              return localMsg;
          });
      }
      // --- 変換処理ここまで ---
      conversationSessions.push(sessionData);
    });
    document.getElementById('chatMessages').innerHTML = "";
    currentSession = null;
    updateSideMenu();
    console.log("リストア完了 (/chatSessions)");
  } catch (error) {
    console.error("リストアエラー:", error);
    if (error.code) { console.error(`Firestore Error Code: ${error.code}`); }
    if (error.message) { console.error(`Firestore Error Message: ${error.message}`); }
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

// ★ Thinking Indicator 関数を先に定義 ★
function showThinkingIndicator(show) {
    const indicator = document.getElementById('thinkingIndicator');
    if (indicator) {
        indicator.style.display = show ? 'flex' : 'none'; // display: flex で表示
        if (show) {
            // インジケーター表示時に最下部にスクロール
            scrollToBottom(); 
        }
    }
}

// ==============================
// イベントリスナーと初期化
// ==============================

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded event fired");

    // FirebaseUIの設定
    const uiConfig = {
        signInSuccessUrl: './', // ログイン成功後のリダイレクト先
        signInOptions: [
            firebase.auth.GoogleAuthProvider.PROVIDER_ID,
            // 必要なら他のプロバイダも追加
            // firebase.auth.EmailAuthProvider.PROVIDER_ID,
        ],
        tosUrl: null, // 利用規約URL (任意)
        privacyPolicyUrl: null // プライバシーポリシーURL (任意)
    };
    const ui = new firebaseui.auth.AuthUI(firebase.auth());

    // 認証状態の監視
    firebase.auth().onAuthStateChanged(async (user) => {
        const loginContainer = document.getElementById('firebaseui-auth-container');
        const mainContent = document.querySelector('.chat-container'); // メインコンテンツを選択
        const headerControls = document.querySelector('#main-header .header-controls');
        const sideMenu = document.getElementById('side-menu');

        if (user) {
            console.log("ログイン中のユーザー:", user.email);
            if (loginContainer) loginContainer.style.display = 'none';
            if (mainContent) mainContent.style.display = 'flex'; // flex に戻す
            if (headerControls) headerControls.style.display = 'flex';
            if (sideMenu) sideMenu.style.display = 'flex'; // サイドメニューも表示
            document.getElementById('user-email').textContent = user.email; // メールアドレス表示

            // ★★★ 認証後に初期化処理を実行 ★★★
            try {
                showThinkingIndicator(true);
                await restoreFromFirebase(); // データをリストア
                updateSideMenuFromFirebase(); // サイドメニュー更新
                await updateUntitledSessions(); // 未タイトルのセッションを更新

                // リストア後に現在のセッションがない場合のみ新規作成
                if (!currentSession) {
                    console.log("No current session after restore, creating new one.");
                    await createNewSession(); // 新規セッションを作成
                }
                showThinkingIndicator(false);
            } catch (error) {
                console.error("Initialization error after login:", error);
                showThinkingIndicator(false);
                 // エラーが発生してもUIは表示されたままにする
                 if (!currentSession) {
                     // フォールバックとして空の新規セッションを試みる
                     try {
                         await createNewSession();
                     } catch (fallbackError) {
                         console.error("Fallback createNewSession failed:", fallbackError);
                         // ここでさらにエラー処理が必要なら追加
                     }
                 }
            }
            // ★★★ 初期化処理ここまで ★★★

        } else {
            console.log("ユーザーはログアウトしています");
            if (loginContainer) loginContainer.style.display = 'block';
            if (mainContent) mainContent.style.display = 'none';
            if (headerControls) headerControls.style.display = 'none';
            if (sideMenu) sideMenu.style.display = 'none'; // サイドメニューも非表示
            ui.start('#firebaseui-auth-container', uiConfig);
            conversationSessions = [];
            currentSession = null;
            updateSideMenu(); // サイドメニューをクリア
        }
    });

    // --- DOMContentLoaded 内の他のリスナー設定 (ID修正) ---
    // ★ IDを index.html に合わせる ★
    const sendButton = document.getElementById('sendBtn'); 
    const chatInput = document.getElementById('chatInput');
    const hamburger = document.getElementById('hamburger');
    const closeMenu = document.getElementById('close-menu');
    const newChat = document.getElementById('new-chat');
    const modelSelect = document.getElementById('model-select'); 
    const dropdownToggle = document.getElementById('dropdown-toggle'); // ★ index.html に ID 追加が必要 ★
    const deleteToggle = document.getElementById('delete-thread-mode-btn'); 
    const logoutLink = document.getElementById('logout-link');
    const micBtn = document.getElementById('micBtn');

    // イベントリスナーを追加 (null チェックを追加してより安全に)
    if (sendButton) sendButton.addEventListener('click', onSendButton);
    if (chatInput) chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendButton();
        }
    });
    if (hamburger) hamburger.addEventListener('click', toggleSideMenu);
    if (closeMenu) closeMenu.addEventListener('click', toggleSideMenu);
    if (newChat) newChat.addEventListener('click', startNewChat);
    if (modelSelect) modelSelect.addEventListener('change', () => {
        console.log(`Model changed to: ${modelSelect.value}`);
        // 必要であればモデル変更時の処理を追加
    });
    if (dropdownToggle) dropdownToggle.addEventListener('click', (e) => { // ★ null チェック追加 ★
        e.stopPropagation(); // Prevent body click handler from closing immediately
        // ★ querySelector を使って親の .dropdown を探す方が確実かもしれない ★
        const dropdownMenu = document.getElementById('dropdown-content'); 
        const parentDropdown = dropdownMenu ? dropdownMenu.closest('.dropdown') : null;
        if(parentDropdown) {
            parentDropdown.classList.toggle('open');
        }
        // document.getElementById('menu-footer').querySelector('.dropdown').classList.toggle('open'); // 古いセレクタ
    });
     // Add event listener for delete toggle
     if (deleteToggle) deleteToggle.addEventListener('click', (e) => { // ★ null チェック追加 ★
        e.preventDefault();
        isDeleteMode = !isDeleteMode;
        // ★ textContent ではなく innerHTML を使ってアイコンを含めるか、アイコン要素を別途操作 ★
        // deleteToggle.textContent = isDeleteMode ? '🗑️ 削除モード (完了)' : '🗑️ スレッド削除';
        deleteToggle.innerHTML = isDeleteMode ? '<i class="bi bi-check-circle-fill"></i> 削除モード (完了)' : '<i class="bi bi-trash"></i> スレッド削除'; // アイコンも変更する例
        updateSideMenu(); // Update display of delete icons
        // Close dropdown after selection
        const parentDropdown = deleteToggle.closest('.dropdown');
        if (parentDropdown) {
             parentDropdown.classList.remove('open');
        }
    });
    if (logoutLink) logoutLink.addEventListener('click', logout);
    // Mic button listener (null チェックは既存のコードにある想定)
    if (micBtn) {
        // ★ toggleRecording を呼び出すように修正/確認 ★
        micBtn.addEventListener('click', toggleRecording);
    } else {
        console.warn("Mic button (#micBtn) not found.");
    }

    // Outside click closes dropdown
    document.addEventListener('click', function handleOutsideClick(e) {
        const dropdown = document.getElementById('menu-footer')?.querySelector('.dropdown.open'); // 開いているドロップダウンを取得
        // クリックされた場所がドロップダウンの外であるか確認 (トグルボタンも除外)
        if (dropdown && !dropdown.contains(e.target) && !document.getElementById('dropdown-toggle')?.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });

    // Initialize speech recognition (if available)
    // ★ 確実に呼び出されるようにする ★
    initializeSpeechRecognition();

    // --- 象の画像クリックイベントリスナー (old.js から移植) ---
    const elephantImg = document.getElementById("elephantImg");
    const elephantBubble = document.getElementById("elephantBubble");

    if (elephantImg && elephantBubble) {
      elephantImg.addEventListener("click", function() {
        if (elephantBubble.classList.contains("visible")) {
          elephantBubble.classList.remove("visible");
        } else {
          const randomCity = getRandomCity();
          setSpeechBubbleText("位置情報取得中..."); // 一時的なメッセージ (既存の関数を利用)
          getCityInfo(randomCity)
            .then(info => {
              setSpeechBubbleText(`${info.city}は${info.direction}${info.distance}kmだゾウ！`); // 既存の関数を利用
              setTimeout(() => {
                elephantBubble.classList.remove("visible");
              }, 6000);
            })
            .catch(error => {
              setSpeechBubbleText(error); // エラーメッセージを表示 (既存の関数を利用)
              setTimeout(() => {
                elephantBubble.classList.remove("visible");
              }, 6000);
            });
        }
      });

      // ウィンドウのリサイズ時にフォントサイズを再調整するリスナーは既存のものを利用 or 必要なら追加
      // window.addEventListener('resize', adjustSpeechBubbleFontSize);
    }

});

// ===== 音声認識関連 =====

// ★ initializeSpeechRecognition の実装 (old.js から移植) ★
function initializeSpeechRecognition() {
    console.log("initializeSpeechRecognition called");
    const micBtn = document.getElementById("micBtn");
    const chatInput = document.getElementById("chatInput");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition && micBtn) {
        recognition = new SpeechRecognition();
        recognition.lang = "ja-JP";
        recognition.interimResults = true;
        recognition.continuous = false;

        recognition.onstart = () => {
            isRecording = true;
            micBtn.classList.add("recording");
            micBtn.title = "録音中... (クリックして停止)";
            console.log("音声認識を開始しました。");
        };

        recognition.onresult = (event) => {
            // ★デバッグログ追加
            console.log("Speech recognition 'onresult' event fired:", event);

            let interimTranscript = "";
            let finalTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                // ★デバッグログ追加
                console.log(`Result ${i}: isFinal=${event.results[i].isFinal}, transcript='${event.results[i][0].transcript}'`);

                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            // ★デバッグログ追加
            console.log("Interim Transcript:", interimTranscript);
            console.log("Final Transcript:", finalTranscript);

            // 確定した結果を入力欄に追加（既存のテキストの後ろに追加）
            if (finalTranscript) {
                 // ★ chatInput が正しく参照できているか確認 ★
                const chatInput = document.getElementById("chatInput"); 
                if (chatInput) {
                    chatInput.value += finalTranscript;
                    console.log(`Appended final transcript to chatInput. New value: '${chatInput.value}'`);
                    // 必要に応じてテキストエリアのサイズ調整など
                } else {
                     console.error("chatInput element not found in onresult handler!");
                }
            }
        };

        recognition.onerror = (event) => {
            console.error("音声認識エラー:", event.error);
            let message = "音声認識中にエラーが発生しました。";
            if (event.error === 'no-speech') {
                message = "音声が検出されませんでした。もう一度お試しください。";
            } else if (event.error === 'audio-capture') {
                message = "マイクにアクセスできませんでした。設定を確認してください。";
            } else if (event.error === 'not-allowed') {
                message = "マイクの使用が許可されていません。";
            }
            alert(message);
            if (isRecording) {
                isRecording = false;
                micBtn.classList.remove("recording");
                micBtn.title = "音声入力";
            }
        };

        recognition.onend = () => {
            console.log("音声認識が終了しました。");
            isRecording = false;
            micBtn.classList.remove("recording");
            micBtn.title = "音声入力";
        };

    } else {
        console.warn("お使いのブラウザはWeb Speech APIをサポートしていません。またはマイクボタンが見つかりません。");
        if (micBtn) {
            micBtn.style.display = "none";
        }
    }
}

// ★ toggleRecording の実装 (old.js から移植) ★
function toggleRecording() {
    console.log("toggleRecording called");
    if (!recognition) {
        console.error("SpeechRecognitionが初期化されていません。");
        return;
    }
    if (!isRecording) {
        try {
            recognition.start();
            // onstart でログ出力するためここでは省略
        } catch (error) {
            console.error("音声認識の開始に失敗しました:", error);
            alert("音声認識を開始できませんでした。ブラウザがマイクの使用を許可しているか確認してください。");
        }
    } else {
        recognition.stop();
        // onend でログ出力するためここでは省略
    }
}

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

// ===== ここから追加 =====
// 指定されたIDのセッションを削除する関数
async function deleteSessionById(id) {
  console.log("deleteSessionById called for id:", id);
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。セッションを削除できません。");
    return;
  }

  try {
    // ★ パスを /chatSessions/{sessionId} に変更 ★
    await db.collection("chatSessions").doc(id).delete();
    console.log("Firebaseからセッションを削除しました (/chatSessions):", id);

    // ローカル配列から削除
    conversationSessions = conversationSessions.filter(s => s.id !== id);

    // 現在のセッションが削除された場合
    if (currentSession && currentSession.id === id) {
      currentSession = null;
      document.getElementById('chatMessages').innerHTML = ""; // チャット画面をクリア
      lastMessageDate = "";
      console.log("現在のセッションが削除されたため、チャット画面をクリアしました。");
    }

    // サイドメニューを更新
    updateSideMenu();

  } catch (error) {
    console.error("セッションの削除中にエラーが発生しました:", error);
    alert("セッションの削除中にエラーが発生しました。");
  }
}
// ===== ここまで追加 =====

// ===== サイドメニュー外クリックで閉じる処理 =====
document.addEventListener('click', function handleOutsideClick(e) {
    const sideMenu = document.getElementById('side-menu');
    const hamburgerIcon = document.getElementById('hamburger'); // メニューを開くボタン

    // メニューが開いているか確認
    if (sideMenu.classList.contains('open')) {
        // クリックがメニュー自身の上ではないか、かつ、ハンバーガーアイコンの上ではないかを確認
        if (!sideMenu.contains(e.target) && e.target !== hamburgerIcon && !hamburgerIcon.contains(e.target)) {
            sideMenu.classList.remove('open');
            console.log('Clicked outside, closing side menu.');
        }
    }
});

// ===== 象の吹き出し関連 ヘルパー関数 =====

// 都市の緯度経度 (old.js からコピー)
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

// 方角を計算する関数 (old.js からコピー)
function calculateDirection(lat1, lon1, lat2, lon2) {
  const lat1Rad = lat1 * Math.PI / 180;
  const lon1Rad = lon1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const lon2Rad = lon2 * Math.PI / 180;
  const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);
  let bearing = Math.atan2(y, x) * (180 / Math.PI);
  bearing = (bearing + 360) % 360;
  const directions = [
    "北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
    "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"
  ];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

// 2点間の距離を計算する関数 (old.js からコピー)
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
  return Math.round(distance);
}

// ランダムな都市を選択する関数 (old.js からコピー)
function getRandomCity() {
  const randomIndex = Math.floor(Math.random() * cities.length);
  return cities[randomIndex];
}

// GPS情報を取得して選択された都市との距離と方向を計算する関数 (old.js からコピー)
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
        const distance = calculateDistance(currentLat, currentLon, city.latitude, city.longitude);
        const direction = calculateDirection(currentLat, currentLon, city.latitude, city.longitude);
        resolve({ city: city.name, distance, direction });
      },
      (error) => {
        let errorMessage = "位置情報の取得に失敗しました。";
        switch(error.code) {
          case error.PERMISSION_DENIED: errorMessage = "位置情報の利用が許可されていません。"; break;
          case error.POSITION_UNAVAILABLE: errorMessage = "位置情報を取得できませんでした。"; break;
          case error.TIMEOUT: errorMessage = "位置情報の取得がタイムアウトしました。"; break;
        }
        reject(errorMessage);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  });
}

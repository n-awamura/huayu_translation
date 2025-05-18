// ==============================
// グローバル変数
// ==============================
// let conversationSessions = []; 
// let currentSession = null;     
let lastHeaderDate = null;   // ★ 最後にヘッダーを表示した日付 (Date オブジェクト)
// let isDeleteMode = false; // 追加: 削除モードの状態
let recognition = null; // 追加: SpeechRecognition インスタンス
let isRecording = false; // 追加: 録音状態フラグ
// let isCreatingNewSession = false; // ★ New Chat 連打防止フラグ
let firebaseUiInitialized = false; // ★ FirebaseUI 初期化済みフラグを追加 ★
// let lastVisibleDocFromFirestore = null; // ★ ページネーション用: 最後に読み込んだFirestoreドキュメント ★
// let allHistoryLoaded = false; // ★ ページネーション用: 全履歴読み込み完了フラグ ★
// const INITIAL_LOAD_COUNT = 10; // ★ ページネーション用: 初期読み込み件数 ★
// const LOAD_MORE_COUNT = 5; // ★ ページネーション用: 追加読み込み件数 ★

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
    console.log("--- addMessageRow Start ---");
    console.log("Original Text:", text); // Removed isThinking parameter
    // sources はコンソールにはログ出力するが、表示しない
    if (sources) {
        console.log("Received Sources (Hidden from UI):", sources);
    }

    const chatMessagesDiv = document.getElementById('chatMessages');
    const messageDate = timestamp ? new Date(timestamp) : new Date(); // ★ メッセージの日付
    const now = new Date();

    // --- Date Header Logic (最終修正) ---
    let shouldAddHeader = false;
    if (!lastHeaderDate || !(lastHeaderDate instanceof Date)) {
        shouldAddHeader = true;
    } else {
        if (lastHeaderDate.getFullYear() !== messageDate.getFullYear() ||
            lastHeaderDate.getMonth() !== messageDate.getMonth() ||
            lastHeaderDate.getDate() !== messageDate.getDate()) {
            shouldAddHeader = true;
        }
    }

    if (shouldAddHeader) {
        // ★ さらにチェック: 直前にヘッダーがなければ追加 ★
        const existingHeaders = chatMessagesDiv.querySelectorAll('.date-header');
        const lastElement = chatMessagesDiv.lastElementChild;
        if (!lastElement || !lastElement.classList.contains('date-header')) {
             console.log(`addMessageRow: Last element is not a header. Proceeding to add header.`);
            let dateHeaderStr;
            // ★ 常に MM/DD (曜日) 形式にする ★
            dateHeaderStr = `${(messageDate.getMonth() + 1).toString().padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')} (${getWeekday(messageDate)})`;
            const dateHeader = document.createElement('div');
            dateHeader.classList.add('date-header');
            dateHeader.innerText = dateHeaderStr;
            chatMessagesDiv.appendChild(dateHeader);
            console.log("Added date header (final check passed):", dateHeaderStr);
            lastHeaderDate = messageDate; // Date オブジェクトで更新
        } else {
             console.log("Skipping header add because last element is already a date header.");
             // lastHeaderDate の更新は行わない (既存のヘッダーの日付が優先されるべき)
        }
    } else {
        console.log("Condition not met (date is the same). Skipping header.");
    }
    // --- Date Header Logic (最終修正ここまで) ---

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

    // if (isThinking) { // 「考え中」メッセージの専用ロジックを削除
    //     // 「考え中」メッセージの場合、text をそのまま innerHTML として設定
    //     bubbleText.innerHTML = text;
    // } else {
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

        // --- Message Copy Button (通常のメッセージにのみ追加) ---
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
        bubble.appendChild(copyMsgBtn); // Copy button inside bubble
    // } // elseブロックを削除

    // --- Timestamp Creation ---
    const bubbleTime = document.createElement('div');
    bubbleTime.classList.add('bubble-time');
    const nowTime = timestamp ? new Date(timestamp) : new Date();
    const hours = nowTime.getHours().toString().padStart(2, '0');
    const minutes = nowTime.getMinutes().toString().padStart(2, '0');
    bubbleTime.innerText = `${hours}:${minutes}`;
    console.log("Created Timestamp element:", bubbleTime.innerText);

    // Append elements to bubble
    bubble.appendChild(bubbleText);
    bubble.appendChild(bubbleTime); // Timestamp inside bubble
    console.log("Appended text and timestamp to bubble.");

    // Append bubble to row (grounding の後に追加するように変更)
    row.appendChild(bubble); 

    // Append row to chat messages
    chatMessagesDiv.appendChild(row);
    console.log("Appended row to chat messages div.");

    // if (!isThinking) {
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
    // }
    console.log("--- addMessageRow End (Corrected Code Block Handling) ---");
}

// 履歴が不要なためコメントアウト
// function buildPromptFromHistory() {
//   if (!currentSession || !currentSession.messages?.length) return "";
//   return currentSession.messages
//     .map(m => `${m.sender}: ${m.text}`)
//     .join("\n");
// }

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

async function onSendButton() {
  console.log("onSendButton called");
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  addMessageRow(message, 'self');
  input.value = '';
  scrollToBottom(); // ユーザーメッセージ追加後にスクロール

  // 一時的な「考え中」メッセージの追加処理を削除
  // const thinkingBubbleId = `thinking-bubble-${Date.now()}`;
  // addMessageRow("<div id='" + thinkingBubbleId + "' class='temp-thinking-message'>考え中だゾウ...</div>", 'other', new Date(), null, true);
  // scrollToBottom(); // メッセージ追加後にスクロール

  await callGemini(message); // thinkingBubbleId を渡さない
}

async function toggleSideMenu() {
  console.log("toggleSideMenu called");
  const sideMenu = document.getElementById('side-menu');
  sideMenu.classList.toggle('open');
  if (sideMenu.classList.contains('open')) {
    // サイドメニューを開くときに常に初回ロードとして履歴を更新
    updateSideMenuFromFirebase(false); 
  }
}

async function updateSideMenuFromFirebase(loadMore = false) {
    // const currentUser = firebase.auth().currentUser; // Authは使うがFirestoreは使わない
    // if (!currentUser) {
    //     console.log("updateSideMenuFromFirebase: User not logged in.");
    //     return;
    // }
    // console.log(`updateSideMenuFromFirebase called, loadMore: ${loadMore}`);

    // try {
        // let query = firebase.firestore().collection('chatSessions') // この行がエラーの原因
        //   .where('userId', '==', currentUser.uid)
        //   .orderBy('updatedAt', 'desc')
        //   .orderBy('createdAt', 'desc'); 

        // const countToLoad = loadMore ? LOAD_MORE_COUNT : INITIAL_LOAD_COUNT;

        // if (loadMore && lastVisibleDocFromFirestore) {
        //   query = query.startAfter(lastVisibleDocFromFirestore);
        // } else if (!loadMore) {
        //   lastVisibleDocFromFirestore = null; 
        //   allHistoryLoaded = false; 
        // }

        // query = query.limit(countToLoad);
        // const snapshot = await query.get();
        // const newSessions = [];
        // snapshot.forEach(doc => { /* ... */ });
        // conversationSessions 関連の処理もすべて削除

    // } catch (error) {
    //     console.error("サイドメニュー更新エラー (Firestoreからの取得):", error);
    // }
    // updateSideMenu(); // この呼び出しも、この関数が単純化されるなら不要になるか、呼び出し元で制御

    // 履歴機能は使わないので、固定表示にする
    console.log("updateSideMenuFromFirebase called, displaying no history message.");
    const historyDiv = document.getElementById('conversation-history');
    if (historyDiv) {
        historyDiv.innerHTML = '<li id="noSessionsMessage" style="padding: 10px; text-align: center; color: #888;">履歴機能はありません</li>';
    }
    // 「もっと見る」ボタンなども表示しない
    const loadMoreButton = document.getElementById('loadMoreSessions'); // DOMにこのIDの要素がなければnull
    if (loadMoreButton) {
        loadMoreButton.style.display = 'none';
    }
}

function updateSideMenu() {
  console.log("updateSideMenu called"); // isDeleteMode のログは削除
  const historyDiv = document.getElementById('conversation-history');
  historyDiv.innerHTML = ""; // クリア

  // if (isDeleteMode) { // isDeleteMode を使わない
  //   historyDiv.classList.add('delete-mode');
  // } else {
  //   historyDiv.classList.remove('delete-mode');
  // }
  
  // conversationSessions 関連の処理はすべて削除
  // let sessionsToDisplay = [...conversationSessions];
  // if (currentSession) { /* ... */ }
  // sessionsToDisplay = sessionsToDisplay.filter(/* ... */);
  // finishedSessionsForDisplay.sort(/* ... */);
  // finalSortedSessions = finalSortedSessions.concat(finishedSessionsForDisplay);
  // finalSortedSessions = finalSortedSessions.filter(/* ... */);
  // sessionsForDisplayHtml.forEach(session => { /* ... */ });

  // 「続けて5件見る」ボタンや「これ以上履歴はありません」の表示も削除
  // if (!allHistoryLoaded && conversationSessions.length > 0) { /* ... */ }

  // 履歴機能がないことを示すメッセージを再度表示（updateSideMenuFromFirebaseと重複するが、こちらでもUIを確定させる）
  if (historyDiv) { // historyDiv が存在する場合のみ処理
    const noSessionsMessage = document.createElement('li');
    noSessionsMessage.id = 'noSessionsMessage';
    noSessionsMessage.style.padding = '10px';
    noSessionsMessage.style.textAlign = 'center';
    noSessionsMessage.style.color = '#888'; // style.css の変数を使う方が望ましいが、一旦直接指定
    noSessionsMessage.textContent = '履歴機能はありません';
    historyDiv.appendChild(noSessionsMessage);
  }
}

// loadSessionById 関数全体を削除

async function startNewChat() {
  console.log("startNewChat called");
  showThinkingIndicator(true); // これはUI操作なので残す

  try {
    await createNewSession(); // createNewSessionはUIリセットのために呼び出す

  } catch (error) {
    console.error("Error starting new chat:", error);
  } finally {
    showThinkingIndicator(false);
  }
}

async function createNewSession() {
    console.log("Creating a new session (UI reset).");
    document.getElementById('chatMessages').innerHTML = "";
    lastHeaderDate = null;
    const chatInputElement = document.getElementById('chatInput'); // ID を 'chatInput' に変更
    if (chatInputElement) { 
        chatInputElement.value = ''; 
        chatInputElement.focus();   
    } else {
        console.error("Element with ID 'chatInput' not found in createNewSession.");
    }
    document.getElementById('chatHeaderTitle').textContent = 'TRANSLATION'; 
    scrollToBottom();
    return Promise.resolve(); 
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
async function callGemini(userInput) { // thinkingBubbleId パラメータを削除
    // showThinkingIndicator(true); // ヘッダーの吹き出し操作は削除
    console.log("callGemini called with input:", userInput);

    // old.js を参考に「考え中」メッセージの遅延表示ロジックを追加
    const chatMessagesDiv = document.getElementById('chatMessages');
    const delayTime = 3000; 
    let loadingRow = null; // 関数スコープの変数として宣言
    let loadingTextElement = null; // bubble-text 要素を保持

    const thinkingTimeoutId = setTimeout(() => {
        loadingRow = document.createElement('div');
        loadingRow.classList.add('message-row', 'other', 'thinking-row'); // thinking-row クラスを追加 (識別用)

        const icon = document.createElement('img');
        icon.classList.add('icon');
        icon.src = 'img/elephant.png';
        icon.alt = '相手アイコン';
        loadingRow.appendChild(icon);

        const bubble = document.createElement('div');
        bubble.classList.add('bubble');

        loadingTextElement = document.createElement('div');
        loadingTextElement.classList.add('bubble-text');
        loadingTextElement.innerHTML = "<div class='temp-thinking-message'>考え中だゾウ...</div>"; // isThinkingフラグがなくなったため、直接HTMLを設定
        loadingTextElement.classList.add('blinking-text'); // 点滅クラスを追加
        bubble.appendChild(loadingTextElement);

        // タイムスタンプも「考え中」メッセージに追加（API応答後に更新される）
        const bubbleTime = document.createElement('div');
        bubbleTime.classList.add('bubble-time');
        const nowTime = new Date();
        const hours = nowTime.getHours().toString().padStart(2, '0');
        const minutes = nowTime.getMinutes().toString().padStart(2, '0');
        bubbleTime.innerText = `${hours}:${minutes}`;
        bubble.appendChild(bubbleTime);

        loadingRow.appendChild(bubble);
        chatMessagesDiv.appendChild(loadingRow);
        scrollToBottom();
        console.log("Displayed '考え中だゾウ...' message (delayed).");
    }, delayTime);


    // プロンプトを調整
    const characterPrompt = "あなたは親しみやすいゾウのキャラクターです。応答の語尾はすべて「だゾウ」で終えるようにしてください。キャラクター設定に関する言及は、応答に一切含めないでください。";
    const translationRequest = `ユーザーが入力した日本語「${userInput}」を、自然な台湾華語（繁体字中国語）に訳してください。
その際、以下の点に注意して回答を生成してください。
1. 主な翻訳をまず提示する。
2. 次に、同じ意味合いで使える別の言い回しや類義表現を1～2個提示する。
3. 最後に、提示した翻訳や言い回しについて、簡単な文法解説やニュアンスの違い、使われる場面などを補足説明する。`;
    const combinedPrompt = `${characterPrompt}

上記のキャラクター設定および以下の指示に従って、ユーザーの入力を翻訳・解説してください。

${translationRequest}`;

    console.log("Combined Prompt (sending to worker):", combinedPrompt);

    // thinkingBubbleId に関連する処理を削除
    // const thinkingBubbleContentElement = document.getElementById(thinkingBubbleId);

    try {
        const result = await callGeminiModelSwitcher(combinedPrompt, 'gemini-2.5-flash-preview-04-17');
        clearTimeout(thinkingTimeoutId); // API応答が来たらタイマーを解除

        if (loadingRow && loadingRow.parentElement) { // 「考え中」メッセージが表示されていた場合
            console.log("Replacing '考え中だゾウ...' message with actual response.");
            // addMessageRowToElement を使って新しい行を生成し、置き換える
            const newRowContainer = document.createElement('div'); // ダミーの親要素
            addMessageRowToElement(newRowContainer, result.answer, 'other', new Date(), result.sources);
            if (newRowContainer.firstChild) {
                loadingRow.replaceWith(newRowContainer.firstChild);
            } else {
                console.error("Failed to create new message row for replacement. Removing thinking row.");
                loadingRow.remove(); // 新しい行の作成に失敗したら、「考え中」行を削除
                addMessageRow(result.answer || "応答の表示に失敗しましただゾウ。", 'other', new Date(), result.sources); // 通常通り追加
            }
        } else { // 「考え中」メッセージが表示される前に応答が来た場合
            console.log("Response received before '考え中だゾウ...' timeout. Adding as new message.");
            if (result && result.answer) {
                 addMessageRow(result.answer, 'other', new Date(), result.sources);
            } else {
                 addMessageRow("翻訳結果がありませんでした。(No translation result) だゾウ", 'other');
                 console.error("Translation result was empty or invalid:", result);
            }
        }
    } catch (error) {
        console.error("Error calling Gemini for translation:", error);
        clearTimeout(thinkingTimeoutId); // エラー時もタイマーを解除
        if (loadingRow && loadingRow.parentElement) {
            // 「考え中」メッセージをエラーメッセージで更新する、または削除して新しいエラーメッセージ行を追加
            const bubbleTextDiv = loadingRow.querySelector('.bubble-text.blinking-text'); // 点滅クラスも考慮
            if (bubbleTextDiv) {
                bubbleTextDiv.classList.remove('blinking-text'); // 点滅を止める
                bubbleTextDiv.innerHTML = `<div class='temp-thinking-message error-message'>翻訳中にエラーが発生しました: ${escapeHtml(error.message)} だゾウ</div>`;
            } else {
                loadingRow.remove();
                addMessageRow(`翻訳中にエラーが発生しました: ${error.message}`, 'other');
            }
        } else {
            addMessageRow(`翻訳中にエラーが発生しました: ${error.message}`, 'other');
        }
    } finally {
        // showThinkingIndicator(false); // ヘッダーの吹き出し操作は削除
        scrollToBottom(); // 応答表示後にスクロール
    }
}

// addMessageRow の主要ロジックを要素に直接適用するヘルパー関数
// (addMessageRowから呼び出されるマークダウン処理やハイライト処理なども考慮する必要がある)
function addMessageRowToElement(parentElement, text, sender, timestamp, sources) {
    // 既存の addMessageRow の message-row 作成以降のロジックをここに移動・調整
    // sender, timestamp, sources は新しいメッセージ行に必要

    const row = document.createElement('div');
    row.classList.add('message-row', sender);
    if (sender === 'other') {
        const icon = document.createElement('img');
        icon.classList.add('icon');
        icon.src = 'img/elephant.png';
        icon.alt = '相手アイコン';
        row.appendChild(icon);
    }

    const bubble = document.createElement('div');
    bubble.classList.add('bubble');
    const bubbleText = document.createElement('div');
    bubbleText.classList.add('bubble-text');

    // Text Processing (addMessageRowから抜粋)
    const originalTextForCopy = text; // コピーボタン用
    let finalHtml = '';
    const segments = [];
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    let blockIndex = 0; 

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        }
        segments.push({ type: 'code', lang: match[1] || 'plaintext', content: match[2], index: blockIndex });
        lastIndex = codeBlockRegex.lastIndex;
        blockIndex++;
    }
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.substring(lastIndex) });
    }

    segments.forEach(segment => {
        if (segment.type === 'text') {
            if (segment.content && segment.content.trim()) {
                finalHtml += processMarkdownSegment(segment.content);
            }
        } else if (segment.type === 'code') {
            const codeId = `code-${Date.now()}-${segment.index}-${Math.random().toString(36).substring(2)}`;
            const escapedCode = escapeHtml(segment.content.trim());
            finalHtml += `<div class="code-block-container"><pre><button class="copy-code-btn" data-clipboard-target="#${codeId}" title="コードをコピー"><i class="bi bi-clipboard"></i></button><code id="${codeId}" class="language-${segment.lang}">${escapedCode}</code></pre></div>`;
        }
    });
    bubbleText.innerHTML = finalHtml;

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
    bubble.appendChild(copyMsgBtn);

    // --- Timestamp Creation ---
    const bubbleTime = document.createElement('div');
    bubbleTime.classList.add('bubble-time');
    const nowTime = timestamp ? new Date(timestamp) : new Date();
    const hours = nowTime.getHours().toString().padStart(2, '0');
    const minutes = nowTime.getMinutes().toString().padStart(2, '0');
    bubbleTime.innerText = `${hours}:${minutes}`;
    
    bubble.appendChild(bubbleText);
    bubble.appendChild(bubbleTime);
    row.appendChild(bubble);

    // Append row to the parent element provided
    parentElement.appendChild(row);

    // --- Highlight Code Blocks using Prism.js ---
    if (typeof Prism !== 'undefined') {
        Prism.highlightAllUnder(bubble); 
    }

    // --- Code Block Copy Listener ---
    bubble.querySelectorAll('.copy-code-btn').forEach(btn => {
        if (!btn.dataset.listenerAttached) {
            btn.addEventListener('click', (event) => {
                const targetSelector = event.target.closest('button').getAttribute('data-clipboard-target');
                const codeElement = document.querySelector(targetSelector);
                if (codeElement) {
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
        }
    });
}

// ★ buildRefinementPrompt の修正 (台湾華語モードを考慮) ★
async function buildRefinementPrompt(context, originalAnswer) {
    console.log("Building refinement prompt...");
    // context には、台湾華語モードの場合は翻訳結果、それ以外は会話履歴が入る想定
    // 台湾華語モードかどうかの判定はここでは難しいので、プロンプトを汎用的にする
    return `あなたは、応答の語尾をすべて「だゾウ」で終える、親しみやすいゾウのキャラクターです。以下の【元のテキスト】を受け取り、その内容と意味を完全に維持したまま、自然な形で全ての文末が「だゾウ」になるように修正してください。修正されたテキストのみを出力し、それ以外の前置きや説明は一切含めないでください。

【元のテキスト】
${originalAnswer}

【修正後のテキスト】`;
}

async function summarizeSessionAsync(session) {
  return "TRANSLATION"; // 固定値を返すか、呼び出し元を修正
}

async function restoreFromFirebase() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("ユーザーがログインしていません。リストアできません。");
    return;
  }
  console.log("restoreFromFirebase called. Current User UID:", currentUser.uid);
  
  showThinkingIndicator(true); 
  document.getElementById('chatMessages').innerHTML = ""; 
  lastHeaderDate = null; 
  
  try {
    updateSideMenu(); // サイドメニューを「履歴なし」に更新
    await createNewSession(); // ログイン後にUIを初期状態にする

  } catch (error) {
    console.error("リストアエラー:", error);
  } finally {
    showThinkingIndicator(false); 
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

// ★ Thinking Indicator 関数を修正 (ヘッダーの吹き出しを利用) ★
function showThinkingIndicator(show) {
    const bubble = document.getElementById('elephantBubble');
    if (!bubble) return;

    if (show) {
        bubble.textContent = "考え中だゾウ...";
        bubble.classList.add('visible');
        adjustSpeechBubbleFontSize(); // 表示時にフォント調整
        // 応答待機中は画像クリックで消えないように、一時的にクリックイベントを無効化する手もあるが、一旦シンプルに表示のみ
    } else {
        bubble.classList.remove('visible'); // API応答後は吹き出しを隠す
        // 必要であれば、ここで吹き出しのテキストをデフォルトに戻す処理も追加可能
        // bubble.textContent = ""; // もしくは都市情報など
    }
}

// ==============================
// イベントリスナーと初期化
// ==============================

// ===== 天気情報取得関数 (コメントアウト) =====
/* --- ここからコメントアウト ---
async function getWeatherForCities() {
    // ... (関数の内容全体)
}
--- ここまでコメントアウト --- */

// ===== ログアウト関数 (定義位置確認) =====
function logout() {
    // ... (変更なし)
}

// ===== セッション削除関数 =====
// deleteSessionById 関数全体を削除

// ===== DOMContentLoaded イベントリスナー (ファイル末尾に移動) =====
document.addEventListener('DOMContentLoaded', () => {
    // ★ DOMContentLoaded が発火したことを確認 (重複チェック用) ★
    console.log("DOMContentLoaded event listener EXECUTING...");

    // ★ FirebaseUI の初期化をガード ★
    let ui = null;
    const uiConfig = {
        signInSuccessUrl: './', // ログイン成功後のリダイレクト先
        signInOptions: [
            firebase.auth.GoogleAuthProvider.PROVIDER_ID,
        ],
        tosUrl: null, // 利用規約URL (任意)
        privacyPolicyUrl: null // プライバシーポリシーURL (任意)
    };
    if (!firebaseUiInitialized) {
        ui = new firebaseui.auth.AuthUI(firebase.auth()); // ここで初期化
        firebaseUiInitialized = true; // 初期化済みフラグを立てる
        console.log("FirebaseUI initialized.");
    } else {
        console.log("FirebaseUI already initialized, skipping.");
    }

    // 認証状態の監視
    firebase.auth().onAuthStateChanged(async (user) => {
        // ... (要素取得)
        const loginContainer = document.getElementById('firebaseui-auth-container');
        const mainContent = document.querySelector('.chat-container');
        const headerControls = document.querySelector('#main-header .header-controls'); // ★ ここで取得
        const sideMenu = document.getElementById('side-menu');

        if (user) {
            // ★ ログイン時のログを追加 ★
            console.log("User logged in. Attempting to show UI elements.");

            if (loginContainer) loginContainer.style.display = 'none';
            if (mainContent) mainContent.style.display = 'flex';

            // ★ headerControls の存在確認とスタイル設定ログ ★
            if (headerControls) {
                console.log("Header controls element FOUND. Setting display to flex.");
                headerControls.style.display = 'flex'; // 表示
            } else {
                console.error("Header controls element (#main-header .header-controls) NOT FOUND when trying to display!");
            }

            if (sideMenu) {
                console.log("Side menu element FOUND. Setting display to flex.");
                 sideMenu.style.display = 'flex'; // 表示
            } else {
                console.error("Side menu element (#side-menu) NOT FOUND when trying to display!");
            }

            document.getElementById('user-email').textContent = user.email;

            // ... (初期化処理)
            try {
                 showThinkingIndicator(true);
                 await restoreFromFirebase(); // restoreFromFirebase内でUIリセットとサイドメニュー更新
                 // await updateUntitledSessions(); // 不要
                 // if (!currentSession) { // currentSessionの履歴管理は不要
                 //     console.log("No current session after restore, creating new one.");
                 //     await createNewSession(); // restoreFromFirebase内で実施済みの想定
                 // }
                 showThinkingIndicator(false);
             } catch (error) {
                 console.error("Initialization error after login:", error);
                 showThinkingIndicator(false);
                  // if (!currentSession) { // currentSessionの履歴管理は不要
                      try {
                          await createNewSession(); // エラーフォールバックとしてUIリセット
                      } catch (fallbackError) {
                          console.error("Fallback createNewSession failed:", fallbackError);
                      }
                  // }
             }

        } else {
             // ★ ログアウト時のログを追加 ★
             console.log("User logged out. Attempting to hide UI elements and show login.");

             if (loginContainer) loginContainer.style.display = 'block';
             if (mainContent) mainContent.style.display = 'none';

             // ★ headerControls の存在確認とスタイル設定ログ (非表示) ★
             if (headerControls) {
                 console.log("Header controls element FOUND. Setting display to none.");
                 headerControls.style.display = 'none'; // 非表示
             } else {
                 console.error("Header controls element (#main-header .header-controls) NOT FOUND when trying to hide!");
             }

             if (sideMenu) {
                 console.log("Side menu element FOUND. Setting display to none.");
                  sideMenu.style.display = 'none'; // 非表示
             } else {
                 console.error("Side menu element (#side-menu) NOT FOUND when trying to hide!");
             }

            // ... (FirebaseUI の開始処理など)
            if (ui) {
                // FirebaseUIのインスタンスが存在すれば開始
                console.log("Starting FirebaseUI...");
                ui.start('#firebaseui-auth-container', uiConfig);
            } else {
                // 既にあれば、 AuthUI インスタンスは作成しない
                console.warn("FirebaseUI instance (ui) is null, cannot start. This might happen if initialization failed or was skipped.");
                // フォールバックとして再度初期化を試みるか、エラーメッセージを表示
                // FirebaseUI コンテナに手動でメッセージを表示することも検討
                const fbAuthContainer = document.getElementById('firebaseui-auth-container');
                if (fbAuthContainer && !fbAuthContainer.hasChildNodes()) { // コンテナが空の場合のみメッセージ追加
                    fbAuthContainer.innerHTML = '<p style="color: red;">ログインウィジェットの表示に問題が発生しました。ページを再読み込みしてください。</p>'
                }
            }
            // conversationSessions = []; // 履歴管理は不要なため削除
            // currentSession = null;     // 履歴管理は不要なため削除
            updateSideMenu(); // サイドメニューを更新（「履歴はありません」を表示）
        }
    });

    // --- DOMContentLoaded 内の他のリスナー設定 ---
    console.log("Setting up other event listeners..."); // ★ リスナー設定開始ログ ★
    const sendButton = document.getElementById('sendBtn');
    const chatInput = document.getElementById('chatInput');
    const hamburger = document.getElementById('hamburger');
    const closeMenu = document.getElementById('close-menu');
    const newChat = document.getElementById('new-chat');
    const modelSelect = document.getElementById('model-select');
    const dropdownToggle = document.getElementById('dropdown-toggle');
    // const deleteToggle = document.getElementById('delete-thread-mode-btn'); // 削除
    const logoutLink = document.getElementById('logout-link');
    const micBtn = document.getElementById('micBtn');
    // const weatherBtn = document.getElementById('weather-btn'); // ★ 天気ボタン取得をコメントアウト ★

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
    });
    if (dropdownToggle) dropdownToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdownMenu = document.getElementById('dropdown-content');
        const parentDropdown = dropdownMenu ? dropdownMenu.closest('.dropdown') : null;
        if(parentDropdown) {
            parentDropdown.classList.toggle('open');
        }
    });
    // if (deleteToggle) deleteToggle.addEventListener('click', (e) => { // 削除
    //     e.preventDefault();
    //     isDeleteMode = !isDeleteMode;
    //     deleteToggle.innerHTML = isDeleteMode ? '<i class="bi bi-check-circle-fill"></i> 削除モード (完了)' : '<i class="bi bi-trash"></i> スレッド削除';
    //     updateSideMenu();
    //     const parentDropdown = deleteToggle.closest('.dropdown');
    //     if (parentDropdown) {
    //          parentDropdown.classList.remove('open');
    //     }
    // });
    if (logoutLink) {
        console.log("Logout link found. Adding listener...");
        logoutLink.addEventListener('click', logout); // logout 関数を参照
        console.log("Listener added for logout link.");
    } else {
        console.warn("Logout link (#logout-link) not found.");
    }
    if (micBtn) {
        micBtn.addEventListener('click', toggleRecording);
    } else {
        console.warn("Mic button (#micBtn) not found.");
    }

    // ★★★ 天気ボタンのリスナー設定をコメントアウト ★★★
    /*
    console.log("Attempting to find weather button (#weather-btn)...");
    const weatherBtn = document.getElementById('weather-btn'); // 上で宣言済み
    if (weatherBtn) {
        console.log("Weather button FOUND. Adding event listener...");
        weatherBtn.addEventListener('click', getWeatherForCities);
        console.log("Event listener ADDED for weather button.");
    } else {
        console.warn("Weather button (#weather-btn) NOT FOUND when trying to add listener.");
    }
    */
    console.log("Finished setting up other event listeners."); // ★ リスナー設定完了ログ ★

    // Outside click closes dropdown AND side menu
    document.addEventListener('click', function handleOutsideClick(e) {
        // Close dropdown menu
        const dropdown = document.getElementById('menu-footer')?.querySelector('.dropdown.open');
        if (dropdown && !dropdown.contains(e.target) && !document.getElementById('dropdown-toggle')?.contains(e.target)) {
            dropdown.classList.remove('open');
            console.log("Clicked outside dropdown, closing dropdown.");
        }

        // Close side menu
        const sideMenu = document.getElementById('side-menu');
        const hamburger = document.getElementById('hamburger');
        if (sideMenu && sideMenu.classList.contains('open') && hamburger && !sideMenu.contains(e.target) && !hamburger.contains(e.target)) {
            sideMenu.classList.remove('open');
            console.log("Clicked outside side menu and hamburger, closing side menu.");
        }
    });

    // Initialize speech recognition (if available)
    initializeSpeechRecognition();

    // --- 象の画像クリックイベントリスナー (復活/確認) ---
    const elephantImg = document.getElementById("elephantImg");
    const elephantBubble = document.getElementById("elephantBubble");

    if (elephantImg && elephantBubble) {
        console.log("Elephant image and bubble FOUND. Adding click listener."); // 確認用ログ
        elephantImg.addEventListener("click", async function() { // ★ async を追加 (getCityInfo が非同期のため) ★
            console.log("Elephant image CLICKED."); // 確認用ログ
            if (elephantBubble.classList.contains("visible")) {
                elephantBubble.classList.remove("visible");
                console.log("Bubble was visible, hiding it."); // 確認用ログ
            } else {
                const randomCity = getRandomCity();
                console.log("Random city selected:", randomCity); // 確認用ログ
                setSpeechBubbleText("都市情報を取得中だゾウ..."); // ★ 処理中のメッセージを表示 ★
                try {
                    const info = await getCityInfo(randomCity); // ★ await を使用 ★
                    console.log("Received city info:", info); // 確認用ログ
                    // ★★★ ここで結果を吹き出しに表示 ★★★
                    setSpeechBubbleText(`${info.city}は${info.direction}${info.distance}kmだゾウ！`);
                    // ★★★ 表示処理ここまで ★★★

                    // 一定時間後に吹き出しを消すタイマー (必要に応じて調整)
                    setTimeout(() => {
                        elephantBubble.classList.remove("visible");
                    }, 6000);
                } catch (error) {
                    console.error("Error getting city info:", error); // 確認用ログ
                    setSpeechBubbleText(`エラーだゾウ: ${error.message || '情報取得失敗'}`); // ★ エラー時も表示 ★
                    // エラー時も一定時間後に消す
                    setTimeout(() => {
                        elephantBubble.classList.remove("visible");
                    }, 6000);
                }
            }
        });
    } else {
        console.warn("Elephant image (#elephantImg) or bubble (#elephantBubble) not found.");
    }
    // --- 象の画像クリックイベントリスナーここまで ---

    console.log("DOMContentLoaded listener execution finished.");
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

// ★ toggleRecording の実装 (適切な位置に定義) ★
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
            alert("音声認識を開始できませんでした。ブラウザがマイクの使用を許可しているか確認してください。注意: この機能はHTTPS接続でのみ動作する場合があります。"); // 注意喚起追加
        }
    } else {
        recognition.stop();
        // onend でログ出力するためここでは省略
    }
}

// ===== 都市情報取得関連のヘルパー関数 (old.js から復活) =====

// 都市の緯度経度リスト (old.js のリストに戻す)
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

// 方角を計算する関数 (old.js より)
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

// 2点間の距離を計算する関数 (Haversine formula) (old.js より)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球の半径（km）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return Math.round(distance); // 整数に丸める
}

// ランダムな都市を選ぶ関数 (cities 配列を使用)
function getRandomCity() {
    const randomIndex = Math.floor(Math.random() * cities.length);
    return cities[randomIndex];
}

// GPS情報を取得して都市情報を計算する関数 (old.js ベースに修正)
function getCityInfo(city) {
    console.log(`getCityInfo called for: ${city.name}`);
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("お使いのブラウザは位置情報をサポートしていません。")); // Error オブジェクトを reject
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                try {
                    const currentLat = position.coords.latitude;
                    const currentLon = position.coords.longitude;
                    console.log(`Current location: Lat=${currentLat}, Lon=${currentLon}`);

                    const distance = calculateDistance(
                        currentLat, currentLon,
                        city.latitude, city.longitude
                    );
                    console.log(`Calculated distance to ${city.name}: ${distance} km`);

                    const direction = calculateDirection(
                        currentLat, currentLon,
                        city.latitude, city.longitude
                    );
                    console.log(`Calculated direction to ${city.name}: ${direction}`);

                    resolve({ city: city.name, distance, direction });
                } catch (calculationError) {
                    console.error("Error during distance/direction calculation:", calculationError);
                    reject(new Error("位置情報の計算中にエラーが発生しました。"));
                }
            },
            (error) => {
                console.error("Geolocation error:", error);
                let errorMessage = "位置情報の取得に失敗しました。";
                switch (error.code) {
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
                reject(new Error(errorMessage)); // Error オブジェクトを reject
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // タイムアウトを少し延ばす
        );
    });
}

// ★★★ データ正規化用のヘルパー関数ここから ★★★

/**
 * 'yyyy-mm-dd' または 'yyyy年mm月dd日' または ISO8601 形式の文字列をDateオブジェクトに変換する
 * @param {string} dateString 日付文字列
 * @returns {Date|null} 変換後のDateオブジェクト、または変換失敗時はnull
 */
function parseDateString(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  // ISO 8601 形式 (例: "2025-03-29T07:48:23.683Z") のチェックをまず試みる
  // new Date() はISO 8601形式を解釈できる
  const isoDate = new Date(dateString);
  if (!isNaN(isoDate.getTime()) && dateString.includes('T') && dateString.includes('Z')) { // 簡単なISO形式のチェック
      return isoDate;
  }

  // yyyy-mm-dd 形式のチェック
  let match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(match[3], 10);
    const d = new Date(Date.UTC(year, month, day, 0, 0, 0));
    if (!isNaN(d.getTime())) return d;
  }

  // yyyy年mm月dd日 形式のチェック
  match = dateString.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // Month is 0-indexed
    const day = parseInt(match[3], 10);
    const d = new Date(Date.UTC(year, month, day, 0, 0, 0));
    if (!isNaN(d.getTime())) return d;
  }

  console.warn("Unsupported or ambiguous date string format for parseDateString:", dateString);
  return null;
}
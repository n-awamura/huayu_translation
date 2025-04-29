// ==============================
// グローバル変数
// ==============================
let conversationSessions = []; 
let currentSession = null;     
let lastHeaderDate = null;   // ★ 最後にヘッダーを表示した日付 (Date オブジェクト)
let isDeleteMode = false; // 追加: 削除モードの状態
let recognition = null; // 追加: SpeechRecognition インスタンス
let isRecording = false; // 追加: 録音状態フラグ
let isCreatingNewSession = false; // ★ New Chat 連打防止フラグ
let firebaseUiInitialized = false; // ★ FirebaseUI 初期化済みフラグを追加 ★

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
    console.log("Original Text:", text);
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
  lastHeaderDate = null; // ★ lastHeaderDate をリセット ★

  (session.messages || []).forEach(item => {
    // ... (Timestamp 変換処理)
    if (item.timestamp && item.timestamp.seconds) {
        item.timestamp = new Date(item.timestamp.seconds * 1000);
    } else if (item.timestamp && typeof item.timestamp === 'string') {
        // 文字列形式のタイムスタンプも Date オブジェクトに変換
        try {
            item.timestamp = new Date(item.timestamp);
        } catch (e) {
            console.warn("Failed to parse timestamp string:", item.timestamp, e);
            item.timestamp = new Date(); // パース失敗時は現在時刻など
        }
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
      lastHeaderDate = null; // ★ lastHeaderDate をリセット ★
      scrollToBottom();
      // ★ フラグを下ろす処理が抜けていた可能性 ★
      // showThinkingIndicator(false); // ここではない
      // isCreatingNewSession = false;
      return; // 再利用なのでここで終了
    }

    // 既存のアクティブセッションがあれば終了させる
    if (currentSession && currentSession.sessionState === "active") {
      await endCurrentSession();
    }

    // 新規セッションを作成
    await createNewSession(); // この中で chatMessages クリアと lastHeaderDate リセットが行われる

  } catch (error) {
    console.error("Error starting new chat:", error);
    // エラーメッセージをユーザーに表示する処理を追加しても良い
  } finally {
    showThinkingIndicator(false); // インジケーター非表示
    isCreatingNewSession = false; // フラグを下ろす
  }
}

// createNewSession でも念のためリセット
function createNewSession() {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        console.error("ユーザーがログインしていません。セッションを作成できません。");
        return Promise.reject(new Error("User not logged in")); // ★ Promise を返すように変更 ★
    }

    // 既存の空アクティブセッションチェックは startNewChat で行うので不要
    /*
    if (currentSession && currentSession.sessionState === "active" && (!currentSession.messages || currentSession.messages.length === 0)) {
        console.log("既存の空のアクティブセッションを再利用します。");
        return Promise.resolve(); // ★ Promise を返す ★
    }
    */

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
    const localSession = { ...sessionDataToSave }; // Firestore Timestamp を Date に戻す必要がある
    localSession.createdAt = now;
    localSession.updatedAt = now;

    conversationSessions.push(localSession);
    currentSession = localSession;
    document.getElementById('chatMessages').innerHTML = "";
    lastHeaderDate = null; // ★ lastHeaderDate をリセット ★
    scrollToBottom(); // スクロールも忘れずに

    // ★ Firestoreへの書き込みを非同期で行い、Promise を返す ★
    return db.collection("chatSessions").doc(sessionId).set(sessionDataToSave).then(() => {
        console.log("新規セッションをFirestoreに作成 (/chatSessions):", sessionId);
        updateSideMenu();
    }).catch(error => {
        console.error("新規セッションのFirestore書き込みエラー:", error);
        // エラーを呼び出し元に伝える
        throw error;
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

// ★★★ 天気情報取得関数のコメントアウトを解除 ★★★
async function getWeatherForCities() {
    // ★ 関数が呼び出されたか確認するログ ★
    console.log("getWeatherForCities function CALLED!");
    // ★ ここから元の処理 ★
    console.log("getWeatherForCities called");
    const cities = ["東京", "台北", "台南", "高雄", "ホノルル"];
    // ★ プロンプトを再調整: より強く完全なリストを要求 ★
    const prompt = `以下の全ての都市について、今日の天気予報（天気・最高気温・最低気温）と現在の湿度を検索結果から抽出し、完全なリスト形式で**必ず**教えてください。導入文は不要です。

- 東京
- 台北
- 台南
- 高雄
- ホノルル`;

    // 考え中インジケーター表示 (callGemini から流用)
    const chatMessagesDiv = document.getElementById('chatMessages');
    const delayTime = 1000; // 少し短めに設定
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
        loadingText.innerText = "天気情報を取得中だゾウ...";
        bubble.appendChild(loadingText);

        loadingRow.appendChild(bubble);
        chatMessagesDiv.appendChild(loadingRow);
        scrollToBottom();
        console.log("Displayed '天気情報を取得中だゾウ...' message.");
    }, delayTime);

    try {
        // アクティブなセッションがない場合、開始を試みる
        if (!currentSession || currentSession.sessionState !== "active") {
             console.log("No active session or session not active. Ensuring session is active.");
             // 既存のセッションがあればアクティブにする、なければ新規作成を試みる
             if (currentSession) {
                 currentSession.sessionState = "active";
                 currentSession.updatedAt = new Date().toISOString();
             } else {
                 // 最後にアクティブだったセッションを探すか、新規作成
                 const lastActiveSession = conversationSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).find(s => s.messages?.length > 0);
                 if(lastActiveSession) {
                    loadSessionById(lastActiveSession.id);
                    if(currentSession) currentSession.sessionState = "active"; // 念のため
                 } else {
                    await createNewSession(); // 新規作成
                 }
             }
             if (!currentSession) {
                 throw new Error("セッションを開始できませんでした。");
             }
             updateSideMenu(); // セッション状態が変わった可能性があるのでサイドメニュー更新
        }

        console.log(`Calling Model Switcher for weather with model: gemini-2.0-flash, grounding: true, tool: googleSearch`);
        // Grounding を有効にしてモデルスイッチャーを呼び出す
        const data = await callGeminiModelSwitcher(
            prompt,
            'gemini-2.0-flash',
            true, // Grounding を有効化
            'googleSearch' // 標準の Google Search ツールを使用
        );

        clearTimeout(updateTimeout);

        let rawAnswer = "天気情報の取得に失敗しました。"; // ★ 変数名を変更 ★
        let finalSources = null;

        if (data && data.answer !== undefined) {
            rawAnswer = data.answer; // ★ モデルの生応答を保持 ★
            finalSources = data.sources;

            // ★ 語尾変換処理 (Refinement) ★
            console.log(`Generating refinement prompt for weather: ${rawAnswer}`);
            const refinementPrompt = await buildRefinementPrompt("語尾変更", rawAnswer);
            const refinementModel = 'gemini-2.0-flash';
            console.log(`Calling Model Switcher (Refinement) for weather with model: ${refinementModel}`);
            let refinedAnswer = rawAnswer; // ★ 初期値は生応答 ★
            try {
                const refinementData = await callGeminiModelSwitcher(refinementPrompt, refinementModel, false, null);
                if (refinementData && refinementData.answer) {
                    refinedAnswer = refinementData.answer; // ★ 語尾変換後の応答 ★
                    console.log('Weather refinement successful.');
                } else {
                    console.warn('Weather refinement failed or returned no answer, using original answer.');
                }
            } catch (refinementError) {
                 console.error("Error during weather refinement call:", refinementError);
                 console.warn("Using original weather answer due to refinement error.");
            }

            // ★★★ 日付文字列の結合を削除 ★★★
            // const today = new Date(); // dateString 生成は不要に
            // const dateString = `${today.getFullYear()}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')} (${getWeekday(today)}) の天気だゾウ！`;
            // const finalAnswerWithDate = `${dateString}\n\n${refinedAnswer}`; // ★ この行を削除/コメントアウト ★
            // ★★★ 日付結合削除ここまで ★★★

            // AI応答をセッションに追加 (日付なしの応答を保存)
            if (currentSession) {
                 currentSession.messages.push({
                     sender: 'Gemini',
                     text: refinedAnswer, // ★ 日付なしの refinedAnswer を保存 ★
                     timestamp: new Date(),
                     sources: finalSources
                 });
                 currentSession.updatedAt = new Date().toISOString();

                 // ★★★ 天気情報用の日付ヘッダーを追加するロジックは addMessageRow に任せるため削除 ★★★
                 /*
                 const chatMessagesDiv = document.getElementById('chatMessages');
                 const today = new Date(); // 再度取得は冗長だが削除するのでOK
                 const dateHeaderStr = `${today.getFullYear()}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')} (${getWeekday(today)})`;
                 const existingHeaders = chatMessagesDiv.querySelectorAll('.date-header');
                 const lastHeader = existingHeaders.length > 0 ? existingHeaders[existingHeaders.length - 1] : null;
                 if (!lastHeader || lastHeader.innerText !== dateHeaderStr) {
                     const dateHeader = document.createElement('div');
                     dateHeader.classList.add('date-header');
                     dateHeader.innerText = dateHeaderStr;
                     chatMessagesDiv.appendChild(dateHeader);
                     console.log("Added date header for weather info.");
                     // lastHeaderDate = dateHeaderStr; // 文字列代入は元々問題があった
                     lastHeaderDate = today; // Dateオブジェクトで更新するならこちらだが、これも不要
                 } else {
                     console.log("Date header for today already exists, skipping for weather info.");
                 }
                 */
                 // ★★★ ヘッダー追加削除ここまで ★★★

                 // UI更新 (日付なし応答を表示)
                 if (loadingRow && loadingText) {
                    console.log("Weather response received. Removing loading row and adding new message via addMessageRow.");
                    loadingRow.remove();
                    // 新しいメッセージ行を追加 (addMessageRow がヘッダーを処理)
                    addMessageRow(refinedAnswer, 'other', new Date().getTime(), finalSources); // ★ refinedAnswer を渡す ★
                 } else {
                    console.log("Adding new message row for weather info (no loading indicator shown) - addMessageRow will handle header.");
                     // ★ 日付なしで表示 (addMessageRow がヘッダーを処理) ★
                     addMessageRow(refinedAnswer, 'other', new Date().getTime(), finalSources); // ★ refinedAnswer を渡す ★
                 }
                 scrollToBottom();
            } else {
                 console.error("Cannot add weather message, no current session available.");
                 addMessageRow("エラー: 現在のセッションが見つかりません。", 'other');
                 scrollToBottom();
            }
        } else {
             console.error("Received null or invalid response from weather worker call.");
             if (loadingRow && loadingText) {
                 loadingText.classList.remove('blinking-text');
                 loadingText.innerText = rawAnswer;
             } else {
                  addMessageRow(rawAnswer, 'other');
             }
             scrollToBottom();
        }

    } catch (error) {
        clearTimeout(updateTimeout);
        console.error("Error in getWeatherForCities:", error);
        const errorMessage = `天気情報の取得エラー: ${error.message}`;
        if (loadingRow && loadingText) {
             loadingText.classList.remove('blinking-text');
             loadingText.innerText = errorMessage;
        } else {
             addMessageRow(errorMessage, 'other');
        }
        scrollToBottom();
        // エラー時もバックアップを試みるかは検討 (今回は実施しない)
    }
}

// ===== ログアウト関数 (定義位置確認) =====
function logout() {
  firebase.auth().signOut().then(() => {
    console.log("ログアウトしました");
    // ログアウト後の処理 (ログインページへリダイレクト)
    window.location.href = "login.html"; // Assuming login.html exists
  }).catch((error) => {
    console.error("ログアウトエラー:", error);
  });
}

// ===== セッション削除関数 =====
async function deleteSessionById(id) {
    console.log("deleteSessionById called for ID:", id);
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        console.error("ユーザーがログインしていません。削除できません。");
        return;
    }

    const sessionIndex = conversationSessions.findIndex(s => s.id === id);
    if (sessionIndex === -1) {
        console.warn("削除対象のセッションがローカルに見つかりません:", id);
        // Firebase だけに存在する場合も考慮するなら、ここで Firebase から削除を試みる
    } else {
        // ローカルから削除
        conversationSessions.splice(sessionIndex, 1);
        console.log("ローカルからセッションを削除しました:", id);
        // カレントセッションが削除された場合、null にする
        if (currentSession && currentSession.id === id) {
            currentSession = null;
             // 必要であれば、別のセッションをロードするか新規作成する
             // loadSessionById(...) または startNewChat() など
             // ここでは一旦クリアするだけにする
             document.getElementById('chatMessages').innerHTML = "";
             lastHeaderDate = null; 
        }
    }

    try {
        // Firebase から削除
        await db.collection("chatSessions").doc(id).delete();
        console.log("Firestore からセッションを削除しました:", id);
    } catch (error) {
        console.error("Firestore からのセッション削除エラー:", error);
        // エラーが発生した場合、ローカルの削除を取り消すか、ユーザーに通知するか検討
        // 現状はエラーログのみ
    }

    // サイドメニューを更新して変更を反映
    updateSideMenu();
}

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
                 await restoreFromFirebase();
                 await updateUntitledSessions();
                 if (!currentSession) {
                     console.log("No current session after restore, creating new one.");
                     await createNewSession();
                 }
                 showThinkingIndicator(false);
             } catch (error) {
                 console.error("Initialization error after login:", error);
                 showThinkingIndicator(false);
                  if (!currentSession) {
                      try {
                          await createNewSession();
                      } catch (fallbackError) {
                          console.error("Fallback createNewSession failed:", fallbackError);
                      }
                  }
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
                // ... (ui.start)
            } else {
                // ... (warn and fallback)
            }
            conversationSessions = [];
            currentSession = null;
            updateSideMenu();
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
    const deleteToggle = document.getElementById('delete-thread-mode-btn');
    const logoutLink = document.getElementById('logout-link');
    const micBtn = document.getElementById('micBtn');
    const weatherBtn = document.getElementById('weather-btn'); // ★ 天気ボタン取得のコメントアウト解除 ★

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
    if (deleteToggle) deleteToggle.addEventListener('click', (e) => {
        e.preventDefault();
        isDeleteMode = !isDeleteMode;
        deleteToggle.innerHTML = isDeleteMode ? '<i class="bi bi-check-circle-fill"></i> 削除モード (完了)' : '<i class="bi bi-trash"></i> スレッド削除';
        updateSideMenu();
        const parentDropdown = deleteToggle.closest('.dropdown');
        if (parentDropdown) {
             parentDropdown.classList.remove('open');
        }
    });
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

    // ★★★ 天気ボタンのリスナー設定周りのコメントアウト解除 ★★★
    console.log("Attempting to find weather button (#weather-btn)...");
    // const weatherBtn = document.getElementById('weather-btn'); // 上で宣言済み
    if (weatherBtn) {
        console.log("Weather button FOUND. Adding event listener...");
        weatherBtn.addEventListener('click', getWeatherForCities);
        console.log("Event listener ADDED for weather button.");
    } else {
        console.warn("Weather button (#weather-btn) NOT FOUND when trying to add listener.");
    }
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

    // --- 象の画像クリックイベントリスナー ---
    const elephantImg = document.getElementById("elephantImg");
    const elephantBubble = document.getElementById("elephantBubble");

    if (elephantImg && elephantBubble) {
        // ... (変更なし)
        elephantImg.addEventListener("click", function() {
            if (elephantBubble.classList.contains("visible")) {
                elephantBubble.classList.remove("visible");
            } else {
                const randomCity = getRandomCity();
                setSpeechBubbleText("位置情報取得中...");
                getCityInfo(randomCity)
                    .then(info => {
                        setSpeechBubbleText(`${info.city}は${info.direction}${info.distance}kmだゾウ！`);
                        setTimeout(() => {
                            elephantBubble.classList.remove("visible");
                        }, 6000);
                    })
                    .catch(error => {
                        setSpeechBubbleText(error);
                        setTimeout(() => {
                            elephantBubble.classList.remove("visible");
                        }, 6000);
                    });
            }
        });
    }
    console.log("DOMContentLoaded listener execution finished."); // ★ リスナー処理完了ログ ★
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

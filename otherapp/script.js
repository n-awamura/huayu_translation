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
let lastVisibleDocFromFirestore = null; // ★ ページネーション用: 最後に読み込んだFirestoreドキュメント ★
let allHistoryLoaded = false; // ★ ページネーション用: 全履歴読み込み完了フラグ ★
const INITIAL_LOAD_COUNT = 5; // ★ ページネーション用: 初期読み込み件数 ★
const LOAD_MORE_COUNT = 5; // ★ ページネーション用: 追加読み込み件数 ★
let attachedImage = { base64: null, mimeType: null };

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

// テキストエリアの高さを内容に応じて自動調整する関数
function adjustTextareaHeight(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto'; // 高さを一旦リセット
    // スクロールハイトに合わせて高さを設定（+2は微調整）
    textarea.style.height = (textarea.scrollHeight + 2) + 'px';
}

// 画像プレビューの表示状態に合わせてチャットフッターを調整する関数
function adjustChatFooter() {
    const textarea = document.getElementById('chatInput');
    adjustTextareaHeight(textarea);
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


function addMessageRow(messageData) {
    const { text, sender, timestamp, sources, image } = messageData;

    console.log("--- addMessageRow Start ---");
    console.log("Original Text:", text);
    console.log("Image Data:", image);
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

    // ★★★ 画像の処理 ★★★
    if (image && image.base64 && image.mimeType) {
        const imgElement = document.createElement('img');
        imgElement.src = `data:${image.mimeType};base64,${image.base64}`;
        imgElement.alt = "添付画像";
        imgElement.classList.add('chat-image'); // スタイル適用のためクラス追加
        bubble.appendChild(imgElement); // テキストより先に画像を追加
    }
    // ★★★ 画像の処理ここまで ★★★


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

function buildPromptFromHistory(includeSender = true) {
  if (!currentSession || !currentSession.messages?.length) return "";
  return currentSession.messages
    .map(m => includeSender ? `${m.sender}: ${m.text}` : m.text)
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
    if (typeof newTitle === "string" && newTitle.trim() !== "") { // 空文字列でないことを確認
      currentSession.title = newTitle;
    } else {
      currentSession.title = currentSession.title || "無題";
    }
  } else {
    console.log("メッセージが空のため、要約は実施しません。");
    currentSession.title = "無題";
  }

  currentSession.sessionState = "finished";
  currentSession.updatedAt = new Date(); // ★ Date オブジェクトで設定 ★

  const sessionIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
  if (sessionIndex > -1) {
    conversationSessions[sessionIndex].title = currentSession.title;
    conversationSessions[sessionIndex].updatedAt = currentSession.updatedAt; // Date オブジェクトをコピー
    conversationSessions[sessionIndex].sessionState = currentSession.sessionState;
    console.log(`Updated session ${currentSession.id} in local conversationSessions after endCurrentSession.`);
  } else {
    console.warn(`Session ${currentSession.id} not found in conversationSessions during endCurrentSession. This should not happen if createNewSession worked correctly.`);
  }

  await backupToFirebase(); // updatedAt は backupToFirebase 内で Timestamp に変換される
  updateSideMenu();
}

async function onSendButton() {
  console.log("onSendButton called");
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  const hasImage = attachedImage.base64 && attachedImage.mimeType;

  if (!message && !hasImage) return;

  // ★★★ FIX: AIに渡す前に画像がクリアされるのを防ぐ ★★★
  // 送信時点の画像データをローカル変数にコピーして保持する
  const imageToSend = hasImage ? { ...attachedImage } : null;

  if (!currentSession) {
    console.log("現在のセッションが存在しないため、新規セッションを作成します。");
    await createNewSession(); 
  }
  
  if (currentSession.sessionState !== "active") {
    console.log("終了済みセッションを再利用するため、active に切り替えます。");
    currentSession.sessionState = "active";
  }
  currentSession.updatedAt = new Date();

  // ユーザーのメッセージを先にUIに追加する
  const messageData = {
      text: message,
      sender: 'self',
      timestamp: new Date().getTime(),
      image: imageToSend // 保持した画像データを使用
  };
  addMessageRow(messageData);

  // UI/UX向上のため、入力欄とプレビューはすぐにリセット
  input.value = '';
  if (hasImage) {
      document.getElementById('remove-image-btn').click(); 
  }
  adjustTextareaHeight(input);
  scrollToBottom();

  // セッション履歴にメッセージを保存
  if (!currentSession.messages) currentSession.messages = [];
  const messageToStore = {
    sender: 'User',
    text: message,
    timestamp: new Date(),
    image: imageToSend // ここでも保持した画像データを使用
  };
  currentSession.messages.push(messageToStore);

  // ローカルのセッションリストを更新
  const sessionIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
  if (sessionIndex > -1) {
    conversationSessions[sessionIndex].updatedAt = currentSession.updatedAt;
    conversationSessions[sessionIndex].sessionState = currentSession.sessionState;
  } else {
      console.warn("[onSendButton] currentSession not found in conversationSessions. This might indicate an issue.");
  }

  // 最後にAIを呼び出す
  await callGemini(message, imageToSend);
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
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.log("updateSideMenuFromFirebase: User not logged in.");
    return;
  }
  console.log(`updateSideMenuFromFirebase called, loadMore: ${loadMore}`);

  try {
    let query = firebase.firestore().collection('chatSessions')
      .where('userId', '==', currentUser.uid)
      .orderBy('updatedAt', 'desc')
      .orderBy('createdAt', 'desc'); // ★ createdAt でのセカンダリソートを追加 ★

    const countToLoad = loadMore ? LOAD_MORE_COUNT : INITIAL_LOAD_COUNT;

    if (loadMore && lastVisibleDocFromFirestore) {
      query = query.startAfter(lastVisibleDocFromFirestore);
    } else if (!loadMore) {
      lastVisibleDocFromFirestore = null; 
      allHistoryLoaded = false; 
      console.log("Initial load or refresh: lastVisibleDocFromFirestore reset.");
    }

    query = query.limit(countToLoad);

    const snapshot = await query.get();

    // ★ Firestoreから読み込む際は、一旦ローカルの conversationSessions をクリアするかどうかを loadMore フラグで制御する
    // if (!loadMore) { // 初期読み込み、または「もっと見る」でない更新の場合
    //    conversationSessions = []; 
    //    console.log("Initial load or refresh: Cleared local conversationSessions.");
    // }
    // ↑ Firestoreからのデータ取得前にローカルをクリアすると、currentSessionの扱いなどが複雑になるため、
    //   マージ処理で対応する方針を維持。ただし、初期ロード時はクリアした方が良い場合もある。
    //   現状の動作で問題なければこのまま。もし初期ロード時に古いデータが残る問題があれば再検討。
    //   ログから、初期読み込み時には conversationSessions = []; されているので問題なさそう。


    const newSessions = [];
    snapshot.forEach(doc => {
      const sessionData = doc.data();
      let updatedAtDate;
      if (sessionData.updatedAt && typeof sessionData.updatedAt.toDate === 'function') {
        updatedAtDate = sessionData.updatedAt.toDate();
      } else if (sessionData.updatedAt instanceof Date) {
        updatedAtDate = sessionData.updatedAt;
      } else if (sessionData.updatedAt) {
        updatedAtDate = new Date(sessionData.updatedAt);
        if (isNaN(updatedAtDate.getTime())) {
            console.warn(`Invalid date format for updatedAt: ${sessionData.updatedAt}, using epoch for session ID: ${doc.id}`);
            updatedAtDate = new Date(0); 
        }
      } else {
        updatedAtDate = new Date(0); 
      }

      // createdAt も同様に Date オブジェクトに変換
      let createdAtDate;
      if (sessionData.createdAt && typeof sessionData.createdAt.toDate === 'function') {
        createdAtDate = sessionData.createdAt.toDate();
      } else if (sessionData.createdAt instanceof Date) {
        createdAtDate = sessionData.createdAt;
      } else if (sessionData.createdAt) {
        createdAtDate = new Date(sessionData.createdAt);
        if (isNaN(createdAtDate.getTime())) {
            console.warn(`Invalid date format for createdAt: ${sessionData.createdAt}, using epoch for session ID: ${doc.id}`);
            createdAtDate = new Date(0);
        }
      } else {
        createdAtDate = new Date(0); // createdAt がない場合はエポックく
      }

      newSessions.push({
        id: doc.id,
        ...sessionData,
        updatedAt: updatedAtDate,
        createdAt: createdAtDate, // ★ createdAt も Date オブジェクトとして保持 ★
        messages: sessionData.messages || [] 
      });
    });

    console.log(`Firestoreから ${newSessions.length} 件のセッションを取得しました。`);
    if (newSessions.length > 0) {
      console.log("Fetched sessions (up to 3 with full timestamps):", 
        newSessions.slice(0, 3).map(s => 
          ({
            id: s.id, 
            updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt, 
            createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt, // この行を確実に含める
            title: s.title 
          })
        )
      );
    }

    if (newSessions.length < countToLoad) {
      allHistoryLoaded = true;
      console.log("All chat history loaded from Firestore.");
    }

    if (snapshot.docs.length > 0) {
      lastVisibleDocFromFirestore = snapshot.docs[snapshot.docs.length - 1];
    } else if (loadMore) {
      allHistoryLoaded = true;
      console.log("Load more returned 0 docs, assuming all history loaded.");
    }
    
    const sessionMap = new Map();
    conversationSessions.forEach(s => sessionMap.set(s.id, s));
    newSessions.forEach(s => sessionMap.set(s.id, s));
    
    // conversationSessions を更新する前に、currentSession があればその情報を最新に保つ
    if (currentSession) {
        const currentInNew = newSessions.find(s => s.id === currentSession.id);
        if (currentInNew) {
            // Firestore から来た新しいデータで currentSession の一部を更新
            currentSession.title = currentInNew.title;
            currentSession.updatedAt = currentInNew.updatedAt; // Date オブジェクト
            currentSession.createdAt = currentInNew.createdAt; // Date オブジェクト
            currentSession.sessionState = currentInNew.sessionState;
            // messages はローカルのものを維持するか、状況に応じてマージ戦略を検討
            // currentSession.messages = currentInNew.messages; (単純上書きの場合)
            console.log(`[updateSideMenuFromFirebase] Updated currentSession (ID: ${currentSession.id}) with data from new fetch.`);
        }
        // currentSession が sessionMap にも含まれるようにする
        // (ただし、上で更新した currentSession オブジェクトそのものを入れる)
        sessionMap.set(currentSession.id, { ...currentSession });
    }

    conversationSessions = Array.from(sessionMap.values());
    
    // ソートはFirestoreクエリで行っているので、ここでは原則不要だが、
    // currentSession の特別扱いなどで順序が変わる可能性があるため、
    // updateSideMenu 側で最終的な表示順を制御する。
    // ただし、基本的なソートはここでもかけておくと安定する。
    conversationSessions.sort((a, b) => {
      const updatedAtComparison = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });


    // currentSession がFirestoreからのバッチに含まれていない場合でも、
    // ローカルにcurrentSessionが存在し、それがアクティブならconversationSessionsの先頭に追加する
    // (このロジックは updateSideMenu 側と重複する可能性があるので、どちらで主に行うか検討)
    // 現状の updateSideMenu のロジックで currentSession は特別扱いされるので、ここでは sessionMap を使ったマージとソートに注力。
    // 以下の FIX ロジックは sessionMap によるマージでカバーされるか確認。
    /*
    if (currentSession) {
      const freshCurrentSessionFromFirestore = conversationSessions.find(s => s.id === currentSession.id);
      if (freshCurrentSessionFromFirestore) {
        // ... (Firestoreからのデータでローカルの currentSession を更新) ...
      } else if (currentSession.sessionState === 'active' || (currentSession.title === "無題" && (!currentSession.messages || currentSession.messages.length === 0))) {
        const currentIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
        if (currentIndex === -1) {
            conversationSessions.unshift({ ...currentSession });
            console.log("[FIX] Current active session (ID:", currentSession.id, ") was not in Firestore batch. Added it manually to conversationSessions.");
        }
      }
    }
    */
    
    // 再度ソート (updateSideMenu 側でのソートと役割分担を明確に)
    // conversationSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    // → Firestore側でソートしているので、ここでは sessionMap からの復元時の順序維持で良いか、
    //   もしくは明示的に再度ソートする。Firestoreのソート順を信頼する。

  } catch (error) {
    console.error("サイドメニュー更新エラー (Firestoreからの取得):", error);
  }
  updateSideMenu(); 
}

function updateSideMenu() {
  console.log("updateSideMenu called, deleteMode=", isDeleteMode);
  const historyDiv = document.getElementById('conversation-history');
  historyDiv.innerHTML = ""; // クリア

  if (isDeleteMode) {
    historyDiv.classList.add('delete-mode');
  } else {
    historyDiv.classList.remove('delete-mode');
  }
  
  let sessionsToDisplay = [...conversationSessions];
  
  if (currentSession) {
      const currentIndex = sessionsToDisplay.findIndex(s => s.id === currentSession.id);
      if (currentIndex > -1) {
          sessionsToDisplay.splice(currentIndex, 1); 
      }
      if (currentSession.title) { 
          sessionsToDisplay.unshift(currentSession);
      }
  }
  
  sessionsToDisplay = sessionsToDisplay.filter((session, index, self) =>
      index === self.findIndex((s) => (
          s.id === session.id
      ))
  );

  let finishedSessionsForDisplay = sessionsToDisplay.filter(s => !currentSession || s.id !== currentSession.id);
  // finishedSessionsForDisplay.sort((a, b) => {
  //   const updatedAtComparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  //   if (updatedAtComparison !== 0) {
  //     return updatedAtComparison;
  //   }
  //   // updatedAtが同じ場合はcreatedAtで比較
  //   return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  // });
  finishedSessionsForDisplay.sort((a, b) => {
    const aLatestActivity = Math.max(new Date(a.updatedAt).getTime(), new Date(a.createdAt).getTime());
    const bLatestActivity = Math.max(new Date(b.updatedAt).getTime(), new Date(b.createdAt).getTime());
    return bLatestActivity - aLatestActivity; // 降順ソート
  });

  let finalSortedSessions = [];
  if (currentSession && currentSession.title) {
      finalSortedSessions.push(currentSession);
  }
  finalSortedSessions = finalSortedSessions.concat(finishedSessionsForDisplay);
  
  finalSortedSessions = finalSortedSessions.filter(session => {
      // 現在のセッションであれば、無題・空でも表示する
      if (currentSession && session.id === currentSession.id) return true; 
      
      // それ以外のセッションは、無題かつメッセージが空の場合は非表示
      const isEmpty = !session.messages || session.messages.length === 0;
      const isUntitled = session.title === "無題";
      return !(isEmpty && isUntitled);
  });

  // ★★★ デバッグログ追加 ★★★
  console.log("Final sorted sessions to display in side menu (after filtering untitled/empty):", JSON.stringify(finalSortedSessions.map(s => ({id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt, messagesCount: s.messages?.length || 0})), null, 2));
  // ★★★ ここまで ★★★

  // ★★★ デバッグログ追加 ★★★ (ソート後の全件)
  console.log("Sorted sessions before slicing:", JSON.stringify(finalSortedSessions.map(s => ({id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt, messagesCount: s.messages?.length || 0})), null, 2));
  
  const displayLimit = INITIAL_LOAD_COUNT; // または直接 10
  const sessionsForDisplayHtml = finalSortedSessions.slice(0, displayLimit);

  // ★★★ デバッグログ追加 ★★★ (スライス後の表示対象)
  console.log(`Sessions to display in HTML (limited to ${displayLimit}):`, JSON.stringify(sessionsForDisplayHtml.map(s => ({id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt, messagesCount: s.messages?.length || 0})), null, 2));

  sessionsForDisplayHtml.forEach(session => {
    const link = document.createElement('a');
    link.href = "#";
    link.innerText = session.title || "無題"; // title が undefined の場合のフォールバック
    link.style.display = "block";
    link.style.position = "relative";
    link.style.marginBottom = "5px";
    link.style.padding = "5px 10px";
    link.style.textDecoration = "none";
    link.style.color = session.id === currentSession?.id ? "#87CEFA" : "#FFFFFF"; // アクティブなセッションを強調
    if (session.id === currentSession?.id) {
      link.style.fontWeight = "bold";
    }

    if (!isDeleteMode) {
      link.addEventListener('click', e => {
        e.preventDefault();
        // conversationSessions に対象セッションがなければロードする処理は未実装
        // 現状はメモリ上の conversationSessions から探す
        loadSessionById(session.id); 
        toggleSideMenu(); // メニューを閉じる
      });
    }

    if (isDeleteMode) {
      const deleteIcon = document.createElement('i');
      deleteIcon.classList.add('bi', 'bi-trash', 'delete-thread-icon');
      deleteIcon.addEventListener('click', (e) => {
        console.log(`Delete icon clicked for session: ${session.id}`);
        e.preventDefault();
        e.stopPropagation();
        deleteSessionById(session.id);
      });
      link.appendChild(deleteIcon);
    }
    historyDiv.appendChild(link);
  });

  // 「続けて5件見る」ボタンの追加
  if (!allHistoryLoaded && conversationSessions.length > 0) { // 会話履歴が1件以上あり、全件ロードされていなければ表示
    const loadMoreButton = document.createElement('button');
    loadMoreButton.innerText = "続けて5件見る";
    loadMoreButton.classList.add('load-more-btn'); // CSSでスタイルを調整するためクラス追加
    loadMoreButton.addEventListener('click', () => {
      console.log("「続けて5件見る」ボタンがクリックされました。");
      updateSideMenuFromFirebase(true); // true を渡して追加読み込み
    });
    historyDiv.appendChild(loadMoreButton);
  } else if (allHistoryLoaded && conversationSessions.length > 0) {
    const noMoreHistory = document.createElement('p');
    noMoreHistory.innerText = "これ以上履歴はありません";
    noMoreHistory.classList.add('no-more-history'); // CSS用
    historyDiv.appendChild(noMoreHistory);
  }
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
    const messageData = {
      text: item.text,
      sender: item.sender === 'User' ? 'self' : 'other',
      timestamp: item.timestamp,
      image: item.image // ★ 画像データを渡す
    };
    addMessageRow(messageData);
  });
  scrollToBottom();
}

async function startNewChat() {
  console.log("startNewChat called");
  if (isCreatingNewSession) {
    console.log("Already creating a new session, ignoring click.");
    return;
  }
  isCreatingNewSession = true;
  showThinkingIndicator(true);

  try {
    if (currentSession && currentSession.sessionState === "active") {
      await endCurrentSession();
    }
    
    await createNewSession(); // currentSession と conversationSessions がここで更新される想定

    console.log("New session created. Updating side menu immediately.");
    updateSideMenu(); 
    
    console.log("Performing initial load for side menu from Firebase.");
    await updateSideMenuFromFirebase(false); 

  } catch (error) {
    console.error("Error starting new chat:", error);
  } finally {
    showThinkingIndicator(false);
    isCreatingNewSession = false;
  }
}

async function createNewSession() {
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        console.error("ユーザーがログインしていません。セッションを作成できません。");
        return Promise.reject(new Error("User not logged in"));
    }

    // 既存の空でアクティブなセッションを探すロジックは現状維持
    const existingEmptySession = conversationSessions.find(
        s => s.userId === currentUser.uid &&
             s.sessionState === "active" && 
             (!s.messages || s.messages.length === 0)
    );

    if (existingEmptySession) {
        console.log("既存の空のアクティブセッションを再利用します:", existingEmptySession.id);
        currentSession = existingEmptySession;
        currentSession.updatedAt = new Date(); 
        document.getElementById('chatMessages').innerHTML = "";
        lastHeaderDate = null;
        scrollToBottom();
        // ★ 既存セッションを再利用する場合も conversationSessions の先頭に持ってくるか、
        //    updateSideMenu が currentSession を特別扱いするロジックに任せる。
        //    ここでは conversationSessions は変更せず、updateSideMenu に任せる。
        return Promise.resolve(); 
    }

    console.log("Creating a new session document in Firestore.");
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
    
    // Firestore に保存するデータとは別に、ローカルで保持する用のデータを作成
    const localSessionForCurrent = {
        id: sessionId,
        title: "無題",
        messages: [],
        createdAt: now, // Dateオブジェクト
        updatedAt: now, // Dateオブジェクト
        sessionState: "active",
        userId: currentUser.uid
    };

    // ★★★ 変更点ここから ★★★
    // currentSession をまず設定
    currentSession = localSessionForCurrent;
    
    // conversationSessions の重複をチェックして、なければ先頭に追加
    const existingIndexInCS = conversationSessions.findIndex(s => s.id === sessionId);
    if (existingIndexInCS > -1) {
        conversationSessions.splice(existingIndexInCS, 1); // 既存なら一度削除
    }
    conversationSessions.unshift({ ...localSessionForCurrent }); // 新しいセッションをローカルリストの先頭に追加
    console.log(`New session ${sessionId} added to the beginning of local conversationSessions.`);
    // ★★★ 変更点ここまで ★★★

    document.getElementById('chatMessages').innerHTML = "";
    lastHeaderDate = null;
    scrollToBottom();

    try {
        await db.collection("chatSessions").doc(sessionId).set(sessionDataToSave);
        console.log("新規セッションをFirestoreに作成 (/chatSessions):", sessionId);
    } catch (error) {
        console.error("新規セッションのFirestore書き込みエラー:", error);
        // エラー時は currentSession をnullに戻すか、前の状態に戻す
        // conversationSessions からも削除する
        const errorIndex = conversationSessions.findIndex(s => s.id === sessionId);
        if (errorIndex > -1) {
            conversationSessions.splice(errorIndex, 1);
        }
        currentSession = null; // または以前のセッション
        throw error;
    }
}

// ===== API呼び出し関数 (Model Switcher のみ) =====
// async function callGeminiApi(...) { /* 削除 */ }

// Gemini Model Switcher Workerを呼び出す関数 (デフォルトモデル名を 1.5-pro に変更)
async function callGeminiModelSwitcher(prompt, modelName = 'gemini-1.5-pro', useGrounding = false, toolName = null, image = null, retryCount = 0) {
    const workerUrl = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev"; 
    const maxRetries = 2;

    try {
        let response;
        let requestBody;
        let requestUrl = workerUrl;
        let requestMethod = 'POST';
        let headers = { 'Content-Type': 'application/json' };

        if (useGrounding && toolName && !image) { // ★ 修正: 画像がない場合にのみGETリクエストにする
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
            // ★★★ 修正点: WorkerがGemini APIの形式を直接受け付けるように変更 ★★★
            // Gemini APIが要求する 'contents' 形式のボディを作成
            
            // parts 配列を構築
            const parts = [];
            if (prompt) {
                parts.push({ text: prompt });
            }
            if (image && image.base64 && image.mimeType) {
                parts.push({
                    inlineData: {
                        mimeType: image.mimeType,
                        data: image.base64
                    }
                });
            }

            const geminiBody = {
                contents: [{ parts: parts }],
                // ★ 修正: modelName を Worker に渡すためにボディに含める
                modelName: modelName
            };
            requestBody = JSON.stringify(geminiBody); 
            
            // ★ 修正: モデル名をクエリパラメータから削除
            // const urlObj = new URL(requestUrl);
            // urlObj.searchParams.set('model', modelName);
            // requestUrl = urlObj.toString();
            
            console.log(`[DEBUG] Normal Request - URL: ${requestUrl}, Body: ${requestBody}`);
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
            return callGeminiModelSwitcher(prompt, modelName, useGrounding, toolName, image, retryCount + 1); 
        } else {
             throw error;
        }
    }
}

async function callGeminiSummary(prompt, retryCount = 0) {
  return await callGeminiModelSwitcher(prompt, 'gemini-2.5-flash', false, null, null, retryCount);
}

// ===== メインの Gemini 呼び出し関数 =====
async function callGemini(userInput, image = null) {
  try {
      // ★ 考え中メッセージ表示の準備
      const chatMessagesDiv = document.getElementById('chatMessages');
      const delayTime = 2000;
      let loadingRow = null;
      let loadingText = null;
      
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
      bubble.appendChild(loadingText);
      loadingRow.appendChild(bubble);

      const updateTimeout = setTimeout(() => {
          if (!loadingRow.isConnected) {
              loadingText.innerText = "考え中だゾウ...";
              chatMessagesDiv.appendChild(loadingRow);
              scrollToBottom();
              console.log("Displayed '考え中だゾウ...' message.");
          }
      }, delayTime);


      let finalAnswer = null;
      let finalSources = null;

      if (image) {
          // ===================================
          //  画像あり (2段階処理)
          // ===================================
          console.log(`callGemini with Image (2-step process)`);
          
          clearTimeout(updateTimeout);
          if (!loadingRow.isConnected) chatMessagesDiv.appendChild(loadingRow);
          loadingText.innerText = "画像を分析中だゾウ...";
          scrollToBottom();

          // --- STEP 1: 画像認識 (汎用的なプロンプトに修正) ---
          const recognitionPrompt = "この画像に写っている主要な物体、ランドマーク、または人物を最も的確に表す、固有名詞（可能な場合）を含む短いテキストを返してください。";
          console.log(`[Step 1] Identifying subject in image...`);
          
          const recognitionData = await callGeminiModelSwitcher(
              recognitionPrompt,
              'gemini-2.5-flash',
              false, // グラウンディング不要
              null,
              image
          );

          const identifiedSubject = recognitionData?.answer?.trim();
          if (!identifiedSubject || identifiedSubject.length < 1) {
              throw new Error("画像から対象を特定できませんでした。");
          }
          console.log(`[Step 1] Identified subject: ${identifiedSubject}`);

          // --- STEP 2: 情報検索 ---
          loadingText.innerText = `「${identifiedSubject}」について検索中だゾウ...`;
          
          const finalSearchPrompt = `「${identifiedSubject}」について、次のユーザーの質問に詳しく答えてください: 「${userInput}」`;
          console.log(`[Step 2] Searching for info with prompt: ${finalSearchPrompt}`);
          
          const searchData = await callGeminiModelSwitcher(
              finalSearchPrompt,
              'gemini-2.5-flash',
              true, // グラウンディング使用
              'googleSearch',
              null // 2回目の呼び出しでは画像は不要
          );
          
          if (!searchData || searchData.answer === undefined) {
              throw new Error("情報の検索に失敗しました。");
          }

          finalAnswer = searchData.answer;
          finalSources = searchData.sources;

      } else {
          // ===================================
          //  画像なし (通常の処理)
          // ===================================
          console.log(`callGemini without Image (1-step process)`);

          const promptToSend = buildPromptFromHistory(false);
          const useGrounding = true;
          const targetModel = 'gemini-2.5-flash';
          const toolName = 'googleSearch';

          const data = await callGeminiModelSwitcher(
              promptToSend,
              targetModel,
              useGrounding,
              toolName,
              null // No image
          );
          
          if (data && data.answer !== undefined) {
              finalAnswer = data.answer;
              finalSources = data.sources;
          } else {
               throw new Error("APIから有効な応答がありませんでした。");
          }
      }

      // ===================================
      //  共通の後処理
      // ===================================
      clearTimeout(updateTimeout);

      if (finalAnswer === null) {
          throw new Error("API応答から回答を抽出できませんでした。");
      }

      // ★ 語尾変換処理 (モデルを 2.5-flash に統一) ★
      const shouldRefine = true;
      if (shouldRefine) {
          console.log(`Generating refinement prompt for: ${finalAnswer}`);
          const refinementPrompt = await buildRefinementPrompt("語尾変更", finalAnswer);
          const refinementModel = 'gemini-2.5-flash'; // ユーザー指示モデルに統一
          console.log(`Calling Model Switcher (Refinement) with model: ${refinementModel}, grounding: false`);
          try {
              const refinementData = await callGeminiModelSwitcher(refinementPrompt, refinementModel, false, null, null);
              if (refinementData && refinementData.answer) {
                  finalAnswer = refinementData.answer;
                  console.log('Refinement successful.');
              } else {
                  console.warn('Refinement failed, using original answer.');
              }
          } catch (refinementError) {
              console.error("Error during refinement call:", refinementError);
              console.warn("Using original answer due to refinement error.");
          }
      }

      // ★ AIの応答をセッションデータに追加 ★
      if (!currentSession.messages) currentSession.messages = [];
      currentSession.messages.push({
          sender: 'Gemini',
          text: finalAnswer,
          timestamp: new Date(),
          sources: finalSources
      });
      currentSession.updatedAt = new Date();

      const geminiSessionIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
      if (geminiSessionIndex > -1) {
          conversationSessions[geminiSessionIndex].updatedAt = currentSession.updatedAt;
      }

      // ★ 最終的な回答を表示 ★
      if (!loadingRow.isConnected) {
          chatMessagesDiv.appendChild(loadingRow);
      }
      console.log("Updating message bubble with final answer.");
      loadingText.classList.remove('blinking-text');
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = processMarkdownSegment(finalAnswer);
      loadingText.innerHTML = tempDiv.innerHTML;

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
          Prism.highlightAllUnder(existingBubble);
      }

      scrollToBottom();

      // ★★★ セッションタイトル要約とバックアップ ★★★
      if (currentSession && currentSession.title === "無題") {
          console.log("Current session is untitled, attempting to summarize...");
          summarizeSessionAsync(currentSession).then(async (summary) => {
               if (summary && summary !== "無題") {
                   currentSession.title = summary;
                   currentSession.updatedAt = new Date();
                   console.log("Session title updated by summary:", summary);
                   const summarySessionIndex = conversationSessions.findIndex(s => s.id === currentSession.id);
                   if (summarySessionIndex > -1) {
                       conversationSessions[summarySessionIndex].title = currentSession.title;
                       conversationSessions[summarySessionIndex].updatedAt = currentSession.updatedAt;
                   }
                   updateSideMenu();
                   await backupToFirebase();
               } else {
                   await backupToFirebase();
               }
          }).catch(async (error) => {
               console.error("Background session summary failed:", error);
               await backupToFirebase();
          });
      } else {
           await backupToFirebase();
      }

  } catch (error) {
      // ★ 考え中メッセージをクリア/エラー表示に更新 ★
      clearTimeout(updateTimeout);
      console.error("Error in callGemini:", error);

      const errorBubbleText = `エラーだゾウ: ${error.message}`;
      if (loadingRow && loadingRow.isConnected) {
           if(loadingText) {
              loadingText.classList.remove('blinking-text');
              loadingText.innerText = errorBubbleText;
           }
      } else {
          addMessageRow({
              text: errorBubbleText,
              sender: 'other',
              timestamp: new Date().getTime()
          });
      }
      // ★ エラー発生時もバックアップを試みる ★
      try {
          await backupToFirebase();
      } catch (backupError) {
          console.error("Backup failed after error in callGemini:", backupError);
      }
  }
}

// ★ buildRefinementPrompt の修正 (台湾華語モードを考慮) ★
async function buildRefinementPrompt(context, originalAnswer) {
    console.log("Building refinement prompt...");
    // context には、台湾華語モードの場合は翻訳結果、それ以外は会話履歴が入る想定
    // 台湾華語モードかどうかの判定はここでは難しいので、プロンプトを汎用的にする
    return `あなたは、親しみやすいゾウのキャラクターです。あなたの喋り方は、基本的に語尾が「〜だゾウ」や「〜ゾウ」になります。以下の【元のテキスト】を受け取り、その内容と意味を完全に維持したまま、あなたのキャラクターとして自然な口調に修正してください。

【重要】
*   すべての文末を無理に「だゾウ」で終える必要はありません。
*   例えば、「〜です」「〜ます」は自然に「〜だゾウ」に変換してください。
*   形容詞や名詞で終わる場合は、自然に「〜だゾウ」を付けたり、「〜（だ）ゾウ」と活用させたりしてください。（例：「すごい」→「すごいゾウ」、「簡単」→「簡単だゾウ」）
*   文脈によっては「〜いいゾウ」のように、「だ」を省略したほうが自然な場合もあります。不自然な「〜なのだゾウ」のような表現は避けてください。
*   修正後のテキストのみを出力し、それ以外の前置きや説明は一切含めないでください。

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
  let changed = false; 
  for (const session of conversationSessions) {
    if (session.title === "無題" && session.messages && session.messages.length > 0) {
      console.log(`セッション ${session.id} のタイトルを要約処理で更新します。`);
      const summary = await summarizeSessionAsync(session); 
      if (typeof summary === "string" && summary.trim() && summary.trim() !== "無題") {
        session.title = summary.trim();
        session.updatedAt = new Date(); // ★ Date オブジェクトで設定 ★
        changed = true;
      }
    }
  }
  if (changed) { 
    updateSideMenu();
  }
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
    const sessionDataToSave = { 
        ...currentSession,
        userId: currentUser.uid 
    };

    // updatedAt を Firestore Timestamp に変換
    console.log("[backupToFirebase] Converting updatedAt. Original value:", currentSession.updatedAt, "Type:", typeof currentSession.updatedAt);
    if (currentSession.updatedAt instanceof Date && !isNaN(currentSession.updatedAt.getTime())) {
        sessionDataToSave.updatedAt = firebase.firestore.Timestamp.fromDate(currentSession.updatedAt);
    } else if (currentSession.updatedAt) { 
        try {
            const dateObj = new Date(currentSession.updatedAt);
            if (!isNaN(dateObj.getTime())) {
                sessionDataToSave.updatedAt = firebase.firestore.Timestamp.fromDate(dateObj);
            } else {
                console.warn("Invalid date value for updatedAt (conversion failed):", currentSession.updatedAt, "Using current time instead.");
                sessionDataToSave.updatedAt = firebase.firestore.Timestamp.now();
            }
        } catch (e) {
            console.warn("Error converting updatedAt to Date:", currentSession.updatedAt, e, "Using current time instead.");
            sessionDataToSave.updatedAt = firebase.firestore.Timestamp.now();
        }
    } else {
        console.warn("updatedAt is missing or invalid, using current time instead.");
        sessionDataToSave.updatedAt = firebase.firestore.Timestamp.now();
    }

    // createdAt を Firestore Timestamp に変換
    console.log("[backupToFirebase] Converting createdAt. Original value:", currentSession.createdAt, "Type:", typeof currentSession.createdAt);
    if (currentSession.createdAt instanceof Date && !isNaN(currentSession.createdAt.getTime())) {
        sessionDataToSave.createdAt = firebase.firestore.Timestamp.fromDate(currentSession.createdAt);
    } else if (currentSession.createdAt) {
        try {
            const dateObj = new Date(currentSession.createdAt);
            if (!isNaN(dateObj.getTime())) {
                sessionDataToSave.createdAt = firebase.firestore.Timestamp.fromDate(dateObj);
            } else {
                console.warn("Invalid date value for createdAt (conversion failed):", currentSession.createdAt, "Using current time instead.");
                sessionDataToSave.createdAt = firebase.firestore.Timestamp.now();
            }
        } catch (e) {
            console.warn("Error converting createdAt to Date:", currentSession.createdAt, e, "Using current time instead.");
            sessionDataToSave.createdAt = firebase.firestore.Timestamp.now(); 
        }
    } else {
        console.warn("createdAt is missing or invalid, using current time instead.");
        sessionDataToSave.createdAt = firebase.firestore.Timestamp.now();
    }

    // messages 配列内の timestamp を Firestore Timestamp に変換し、sources を削除
    if (sessionDataToSave.messages && Array.isArray(sessionDataToSave.messages)) {
      sessionDataToSave.messages = sessionDataToSave.messages.map(msg => {
        const newMsg = { ...msg };
        console.log("[backupToFirebase] Converting message timestamp. Original value:", msg.timestamp, "Type:", typeof msg.timestamp);
        if (msg.timestamp instanceof Date && !isNaN(msg.timestamp.getTime())) {
          newMsg.timestamp = firebase.firestore.Timestamp.fromDate(msg.timestamp);
        } else if (msg.timestamp) { 
            try {
                // getTimestampValue は Date.parse と同等の振る舞いをする可能性があるため、
                // new Date() で直接 Date オブジェクトを試みる方が安全か、
                // もしくは getTimestampValue の結果をさらに new Date() に通す。
                // ここでは直接 new Date() を試みる。
                const dateObj = new Date(getTimestampValue(msg.timestamp)); // getTimestampValueはミリ秒を返す想定
                if (!isNaN(dateObj.getTime())) {
                    newMsg.timestamp = firebase.firestore.Timestamp.fromDate(dateObj);
                } else {
                    console.warn("Invalid date value for message timestamp (conversion failed):", msg.timestamp, "Using current time instead.");
                    newMsg.timestamp = firebase.firestore.Timestamp.now();
                }
            } catch(e) {
                console.warn("Error converting message timestamp to Date:", msg.timestamp, e, "Using current time instead.");
                newMsg.timestamp = firebase.firestore.Timestamp.now();
            }
        } else {
           console.warn("Message timestamp is missing or invalid, using current time instead.");
           newMsg.timestamp = firebase.firestore.Timestamp.now();
        }
        delete newMsg.sources;
        return newMsg;
      });
    }

    const sessionDocRef = db.collection("chatSessions").doc(sessionDataToSave.id);
    await sessionDocRef.set(sessionDataToSave); 
    console.log(`Session ${sessionDataToSave.id} backed up successfully (/chatSessions).`);

    // バックアップ成功後、ローカルの currentSession のタイムスタンプも Date オブジェクトに更新
    if (currentSession && currentSession.id === sessionDataToSave.id) {
        if (sessionDataToSave.updatedAt && sessionDataToSave.updatedAt.toDate) {
            currentSession.updatedAt = sessionDataToSave.updatedAt.toDate(); 
        }
        if (sessionDataToSave.createdAt && sessionDataToSave.createdAt.toDate) {
            currentSession.createdAt = sessionDataToSave.createdAt.toDate();
        }
        if (sessionDataToSave.messages && Array.isArray(sessionDataToSave.messages)) {
            currentSession.messages = sessionDataToSave.messages.map(msg => {
                 const localMsg = { ...msg }; 
                 if (localMsg.timestamp && localMsg.timestamp.toDate) {
                     localMsg.timestamp = localMsg.timestamp.toDate();
                 }
                 return localMsg;
             });
        }
        console.log("Local currentSession's timestamps and messages updated after successful backup.");
    }

  } catch (error) {
    console.error(`バックアップエラー (Session ID: ${currentSession?.id}):`, error);
    if (error.code) console.error(`Firestore Error Code: ${error.code}`);
    if (error.message) console.error(`Firestore Error Message: ${error.message}`);
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
  console.log("restoreFromFirebase called. Current User UID:", currentUser.uid);
  
  showThinkingIndicator(true); // ★ ロード中にインジケーター表示 ★
  document.getElementById('chatMessages').innerHTML = ""; // チャット表示をクリア
  currentSession = null; // カレントセッションをクリア
  lastHeaderDate = null; // 日付ヘッダーもリセット

  // conversationSessions は updateSideMenuFromFirebase でクリア＆設定されるのでここでは何もしない
  
  try {
    // ★ updateSideMenuFromFirebase を呼び出して初回ロードを行う ★
    await updateSideMenuFromFirebase(false); 
    console.log("リストア完了 (Firestoreからの初回読み込み完了)");

    // 必要であれば、最も新しいセッションを currentSession に設定するなどのロジック
    if (conversationSessions.length > 0) {
        // updatedAt でソートされている前提 (updateSideMenuFromFirebase でソートされる)
        // もし自動で最新を開かない仕様なら、currentSession は null のままか、特定の条件で設定
        // currentSession = conversationSessions[0]; // 例: 最新を自動で開く場合
        // loadSessionById(conversationSessions[0].id);
        console.log("セッションリストア後、currentSession は自動的には設定されません。必要に応じて手動でロードしてください。");
    } else {
        console.log("リストアするセッションがありませんでした。");
        // 必要ならここで createNewSession を呼ぶ
        // await createNewSession();
        // await updateSideMenuFromFirebase(false); 
    }

  } catch (error) {
    console.error("リストアエラー:", error);
    if (error.code) { console.error(`Firestore Error Code: ${error.code}`); }
    if (error.message) { console.error(`Firestore Error Message: ${error.message}`); }
  } finally {
    showThinkingIndicator(false); // ★ インジケーター非表示 ★
    // updateSideMenu(); // updateSideMenuFromFirebase の finally で呼ばれるので不要
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
async function deleteSessionById(id) {
    console.log("[deleteSessionById] Function called for ID:", id);
    const currentUser = firebase.auth().currentUser;
    if (!currentUser) {
        console.error("[deleteSessionById] User not logged in. Cannot delete.");
        return;
    }

    // ローカルから削除
    const sessionIndex = conversationSessions.findIndex(s => s.id === id);
    if (sessionIndex !== -1) {
        conversationSessions.splice(sessionIndex, 1);
        console.log("[deleteSessionById] Removed session from local array:", id);
        // カレントセッションが削除された場合の処理
        if (currentSession && currentSession.id === id) {
            console.log("[deleteSessionById] Current session was deleted. Clearing chat.");
            currentSession = null;
            document.getElementById('chatMessages').innerHTML = "";
            lastHeaderDate = null; 
        }
    } else {
        console.warn("[deleteSessionById] Session not found in local array:", id);
    }

    // Firebase から削除
    try {
        await db.collection("chatSessions").doc(id).delete();
        console.log("[deleteSessionById] Deleted session from Firestore:", id);
    } catch (error) {
        console.error("[deleteSessionById] Error deleting session from Firestore:", error);
        // 必要であればエラー通知やローカル削除のロールバック処理
    }

    // サイドメニューを更新して変更を反映
    console.log("[deleteSessionById] Calling updateSideMenu to reflect changes.");
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
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageUploadInput = document.getElementById('image-upload-input');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const imagePreview = document.getElementById('image-preview');
    const removeImageBtn = document.getElementById('remove-image-btn');
    // const weatherBtn = document.getElementById('weather-btn'); // ★ 天気ボタン取得をコメントアウト ★

    if (sendButton) sendButton.addEventListener('click', onSendButton);
    if (chatInput) chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSendButton();
        }
    });
    if (chatInput) chatInput.addEventListener('input', () => adjustTextareaHeight(chatInput));
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

    // ★★★ 画像アップロード関連のイベントリスナー ★★★
    if (imageUploadBtn) {
        imageUploadBtn.addEventListener('click', () => {
            imageUploadInput.click();
        });
    }

    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', () => {
            attachedImage = { base64: null, mimeType: null };
            imageUploadInput.value = null; // ファイル入力をクリア
            imagePreview.src = '';
            imagePreviewContainer.style.display = 'none';
            adjustChatFooter(); // フッターの高さを調整
        });
    }

    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                // 簡単なバリデーション（例: 5MB以下）
                if (file.size > 5 * 1024 * 1024) {
                    alert('ファイルサイズが大きすぎます。5MB以下の画像を選択してください。');
                    imageUploadInput.value = null;
                    return;
                }
                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64String = e.target.result;
                    // APIに送るために、Base64データ本体とMIMEタイプを保持
                    attachedImage.base64 = base64String.split(',')[1];
                    attachedImage.mimeType = file.type;
                    // プレビューにはData URLをそのまま使用
                    imagePreview.src = base64String;
                    imagePreviewContainer.style.display = 'block';
                    adjustChatFooter(); // フッターの高さを調整
                };
                reader.onerror = (error) => {
                    console.error("FileReader error:", error);
                    alert("ファイルの読み込みに失敗しました。");
                };
                reader.readAsDataURL(file);
            }
        });
    }
    // ★★★ 画像アップロード関連ここまで ★★★

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

// 吹き出しのテキストを設定・調整する関数群 (既存)
function setSpeechBubbleText(text) {
    console.log("[setSpeechBubbleText] Function called with text:", text);
    const bubble = document.getElementById('elephantBubble');
    if (!bubble) {
        console.error("[setSpeechBubbleText] Bubble element not found!");
        return;
    }
    console.log("[setSpeechBubbleText] Bubble element FOUND.");
    try {
        bubble.textContent = text;
        console.log("[setSpeechBubbleText] textContent set successfully.");
        bubble.classList.add('visible');
        console.log("[setSpeechBubbleText] 'visible' class added.");
        adjustSpeechBubbleFontSize(); // フォントサイズ調整呼び出し
        console.log("[setSpeechBubbleText] adjustSpeechBubbleFontSize called successfully.");
    } catch (error) {
        console.error("[setSpeechBubbleText] Error during setting text or class:", error);
    }
}

function adjustSpeechBubbleFontSize() {
    console.log("[adjustSpeechBubbleFontSize] Function called.");
    const bubble = document.getElementById('elephantBubble');
    if (!bubble) {
        console.error("[adjustSpeechBubbleFontSize] Bubble element not found!");
        return;
    }
    console.log("[adjustSpeechBubbleFontSize] Bubble element FOUND.");
    try {
        const maxWidth = bubble.offsetWidth;
        console.log("[adjustSpeechBubbleFontSize] offsetWidth obtained:", maxWidth);
        const textLength = bubble.textContent.length;
        console.log("[adjustSpeechBubbleFontSize] textContent.length obtained:", textLength);

        // 長さに応じてクラスをトグル (閾値は適宜調整)
        if (textLength > 30) { // 例: 30文字を超えたら小さくする
            console.log("[adjustSpeechBubbleFontSize] Text is long, adding 'long' class.");
            bubble.classList.add('long');
        } else {
            console.log("[adjustSpeechBubbleFontSize] Text is short, removing 'long' class.");
            bubble.classList.remove('long');
        }

        // スクロール幅でのチェックも残す
        const scrollWidth = bubble.scrollWidth;
        console.log("[adjustSpeechBubbleFontSize] scrollWidth obtained:", scrollWidth);
        if (scrollWidth > maxWidth) {
            console.log("[adjustSpeechBubbleFontSize] scrollWidth > maxWidth, adding 'long' class.");
            bubble.classList.add('long');
        }
        console.log("[adjustSpeechBubbleFontSize] Font size adjustment finished.");
    } catch (error) {
        console.error("[adjustSpeechBubbleFontSize] Error during font size adjustment:", error);
    }
}

// ★ toggleRecording の実装 (適切な位置に定義) ★
// ... (変更なし)

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

/**
 * ユーザーの全てのチャットセッションの updatedAt フィールドを正規化する
 * 文字列型の場合はFirestoreのTimestamp型に変換して更新する
 */
async function normalizeAllSessionsUpdatedAt() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("正規化処理: ユーザーがログインしていません。");
    alert("正規化処理: ユーザーがログインしていません。");
    return;
  }

  console.log("正規化処理: 開始 (ユーザーID:", currentUser.uid, ")");
  alert("チャット履歴の updatedAt フィールドの正規化処理を開始します。開発者コンソールで進捗を確認してください。処理には時間がかかる場合があります。");

  try {
    const chatSessionsRef = firebase.firestore().collection('chatSessions').where('userId', '==', currentUser.uid);
    const snapshot = await chatSessionsRef.get();

    if (snapshot.empty) {
      console.log("正規化処理: 対象となるチャットセッションが見つかりませんでした。");
      alert("正規化処理: 対象となるチャットセッションが見つかりませんでした。");
      return;
    }

    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    // let skippedYyyyMmDdCount = 0; // yyyy-mm-dd 形式のスキップは不要になったためコメントアウト
    const batchSize = 100; 
    let batch = firebase.firestore().batch();
    let batchOperations = 0;

    for (const doc of snapshot.docs) {
      processedCount++;
      const sessionData = doc.data();
      const sessionId = doc.id;

      if (sessionData.updatedAt && typeof sessionData.updatedAt === 'string') {
        // yyyy-mm-dd 形式のチェックとスキップ処理を削除
        // const yyyy_mm_dd_regex = /^\d{4}-\d{2}-\d{2}$/;
        // if (yyyy_mm_dd_regex.test(sessionData.updatedAt)) {
        //   console.log(`正規化処理: セッションID ${sessionId} の updatedAt ('${sessionData.updatedAt}') は 'yyyy-mm-dd' 形式のため、今回はスキップします。`);
        //   skippedYyyyMmDdCount++;
        //   continue; 
        // }

        console.log(`正規化処理: セッションID ${sessionId} の updatedAt ('${sessionData.updatedAt}') は文字列です。変換を試みます。`);
        const dateObject = parseDateString(sessionData.updatedAt); // yyyy-mm-dd もここで処理される

        if (dateObject) {
          try {
            const firestoreTimestamp = firebase.firestore.Timestamp.fromDate(dateObject);
            batch.update(doc.ref, { updatedAt: firestoreTimestamp });
            batchOperations++;
            updatedCount++;
            console.log(`正規化処理: セッションID ${sessionId} をTimestamp (${firestoreTimestamp.toDate().toISOString()}) に更新予定。`);

            if (batchOperations >= batchSize) {
              console.log(`正規化処理: ${batchOperations} 件のバッチをコミットします...`);
              await batch.commit();
              console.log("正規化処理: バッチコミット完了。");
              batch = firebase.firestore().batch(); 
              batchOperations = 0;
              await new Promise(resolve => setTimeout(resolve, 500)); 
            }
          } catch (e) {
            console.error(`正規化処理: セッションID ${sessionId} のTimestamp変換またはバッチ追加でエラー:`, e, "元の値:", sessionData.updatedAt);
            errorCount++;
          }
        } else {
          console.warn(`正規化処理: セッションID ${sessionId} のupdatedAt ('${sessionData.updatedAt}') をDateオブジェクトに変換できませんでした。スキップします。`);
          errorCount++;
        }
      } else if (sessionData.updatedAt && sessionData.updatedAt.toDate && typeof sessionData.updatedAt.toDate === 'function') {
        // 既にTimestamp型
      } else if (sessionData.updatedAt instanceof Date) {
         console.log(`正規化処理: セッションID ${sessionId} の updatedAt ('${sessionData.updatedAt.toISOString()}') はJavaScriptのDateオブジェクトです。Timestampに変換します。`);
         try {
            const firestoreTimestamp = firebase.firestore.Timestamp.fromDate(sessionData.updatedAt);
            batch.update(doc.ref, { updatedAt: firestoreTimestamp });
            batchOperations++;
            updatedCount++;
            if (batchOperations >= batchSize) {
              console.log(`正規化処理: ${batchOperations} 件のバッチをコミットします...`);
              await batch.commit();
              console.log("正規化処理: バッチコミット完了。");
              batch = firebase.firestore().batch();
              batchOperations = 0;
              await new Promise(resolve => setTimeout(resolve, 500));
            }
         } catch (e) {
            console.error(`正規化処理: セッションID ${sessionId} のDateからTimestamp変換またはバッチ追加でエラー:`, e);
            errorCount++;
         }
      } else if (!sessionData.updatedAt) {
        console.warn(`正規化処理: セッションID ${sessionId} に updatedAt フィールドが存在しません。スキップします。`);
        errorCount++;
      } else {
        console.warn(`正規化処理: セッションID ${sessionId} の updatedAt は予期しない型です:`, sessionData.updatedAt, "スキップします。");
        errorCount++;
      }
    }

    if (batchOperations > 0) {
      console.log(`正規化処理: 残り ${batchOperations} 件のバッチをコミットします...`);
      await batch.commit();
      console.log("正規化処理: 最終バッチコミット完了。");
    }

    console.log("正規化処理: 完了。");
    // console.log(`結果: 総処理ドキュメント数: ${processedCount}, 更新ドキュメント数: ${updatedCount}, 'yyyy-mm-dd'形式スキップ数: ${skippedYyyyMmDdCount}, その他エラー/スキップ数: ${errorCount}`);
    console.log(`結果: 総処理ドキュメント数: ${processedCount}, 更新ドキュメント数: ${updatedCount}, エラー/スキップ数: ${errorCount}`);
    alert(`正規化処理が完了しました。
総処理: ${processedCount}件
更新: ${updatedCount}件
エラー/スキップ: ${errorCount}件
詳細は開発者コンソールを確認してください。ページをリロードして動作を確認してください。`);
// 'yyyy-mm-dd'形式スキップは削除したため、アラートからも削除

  } catch (error) {
    console.error("正規化処理中にエラーが発生しました:", error);
    alert("正規化処理中にエラーが発生しました。詳細は開発者コンソールを確認してください。");
  }
}
// ★★★ データ正規化用のヘルパー関数ここまで ★★★

// ★★★ createdAt データ正規化用のヘルパー関数ここから ★★★

/**
 * ユーザーの全てのチャットセッションの createdAt フィールドを正規化する
 * 文字列型やDateオブジェクトの場合はFirestoreのTimestamp型に変換して更新する
 */
async function normalizeAllSessionsCreatedAt() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) {
    console.error("createdAt正規化: ユーザーがログインしていません。");
    alert("createdAt正規化: ユーザーがログインしていません。");
    return;
  }

  console.log("createdAt正規化: 開始 (ユーザーID:", currentUser.uid, ")");
  alert("チャット履歴の createdAt フィールドの正規化処理を開始します。開発者コンソールで進捗を確認してください。処理には時間がかかる場合があります。");

  try {
    const chatSessionsRef = firebase.firestore().collection('chatSessions').where('userId', '==', currentUser.uid);
    const snapshot = await chatSessionsRef.get();

    if (snapshot.empty) {
      console.log("createdAt正規化: 対象となるチャットセッションが見つかりませんでした。");
      alert("createdAt正規化: 対象となるチャットセッションが見つかりませんでした。");
      return;
    }

    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const batchSize = 100;
    let batch = firebase.firestore().batch();
    let batchOperations = 0;

    for (const doc of snapshot.docs) {
      processedCount++;
      const sessionData = doc.data();
      const sessionId = doc.id;

      if (sessionData.createdAt && (typeof sessionData.createdAt === 'string' || sessionData.createdAt instanceof Date || (typeof sessionData.createdAt === 'object' && sessionData.createdAt.seconds === undefined && sessionData.createdAt.nanoseconds === undefined && !(sessionData.createdAt.toDate)) ) ) {
        // 文字列、Dateオブジェクト、またはTimestamp型ではないプレーンなオブジェクト（toDateなし、seconds/nanosecondsなし）の場合
        console.log(`createdAt正規化: セッションID ${sessionId} の createdAt ('${JSON.stringify(sessionData.createdAt)}') は変換対象です。変換を試みます。`);
        const dateObject = sessionData.createdAt instanceof Date ? sessionData.createdAt : parseDateString(String(sessionData.createdAt)); // parseDateStringは文字列を期待

        if (dateObject && !isNaN(dateObject.getTime())) {
          try {
            const firestoreTimestamp = firebase.firestore.Timestamp.fromDate(dateObject);
            batch.update(doc.ref, { createdAt: firestoreTimestamp });
            batchOperations++;
            updatedCount++;
            console.log(`createdAt正規化: セッションID ${sessionId} をTimestamp (${firestoreTimestamp.toDate().toISOString()}) に更新予定。`);

            if (batchOperations >= batchSize) {
              console.log(`createdAt正規化: ${batchOperations} 件のバッチをコミットします...`);
              await batch.commit();
              console.log("createdAt正規化: バッチコミット完了。");
              batch = firebase.firestore().batch();
              batchOperations = 0;
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (e) {
            console.error(`createdAt正規化: セッションID ${sessionId} のTimestamp変換またはバッチ追加でエラー:`, e, "元の値:", sessionData.createdAt);
            errorCount++;
          }
        } else {
          console.warn(`createdAt正規化: セッションID ${sessionId} のcreatedAt ('${JSON.stringify(sessionData.createdAt)}') をDateオブジェクトに変換できませんでした。スキップします。`);
          errorCount++;
        }
      } else if (sessionData.createdAt && typeof sessionData.createdAt.toDate === 'function') {
        // 既にTimestamp型の場合は何もしない
        // console.log(`createdAt正規化: セッションID ${sessionId} の createdAt は既にTimestamp型です。スキップします。`);
      } else if (!sessionData.createdAt) {
        console.warn(`createdAt正規化: セッションID ${sessionId} に createdAt フィールドが存在しません。スキップします。`);
        errorCount++;
      } else {
        console.warn(`createdAt正規化: セッションID ${sessionId} の createdAt は予期しない型、または既にTimestampの可能性があります:`, sessionData.createdAt, "スキップします。");
        // errorCount++; // 既にTimestampの可能性もあるため、ここではカウントしないか、より厳密な型チェックを parseDateString に任せる
      }
    }

    if (batchOperations > 0) {
      console.log(`createdAt正規化: 残り ${batchOperations} 件のバッチをコミットします...`);
      await batch.commit();
      console.log("createdAt正規化: 最終バッチコミット完了。");
    }

    console.log("createdAt正規化: 完了。");
    console.log(`結果: 総処理ドキュメント数: ${processedCount}, 更新ドキュメント数: ${updatedCount}, エラー/スキップ数: ${errorCount}`);
    alert(`createdAtの正規化処理が完了しました。\n総処理: ${processedCount}件\n更新: ${updatedCount}件\nエラー/スキップ: ${errorCount}件\n詳細は開発者コンソールを確認してください。`);

  } catch (error) {
    console.error("createdAt正規化処理中にエラーが発生しました:", error);
    alert("createdAt正規化処理中にエラーが発生しました。詳細は開発者コンソールを確認してください。");
  }
}
// ★★★ createdAt データ正規化用のヘルパー関数ここまで ★★★
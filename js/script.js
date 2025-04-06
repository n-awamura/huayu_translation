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

function addMessageRow(text, sender, timestamp = null) {
    console.log("--- addMessageRow Start (Simplified) ---");
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

    // --- Simplified Text Processing ---
    const originalTextForCopy = text;
    let processedHtml = escapeHtml(text); // Escape HTML first

    // Apply Formatting Rules (Order is important)
    // Headers: **Bold text:** -> <strong>...:</strong><br>
    processedHtml = processedHtml.replace(/^(\s*)\*\*(.*?):\*\*(\s*)$/gm, '$1<strong>$2:</strong><br>$3');
    // List items: * Item: or 1. Item: -> <li>Item</li> (Bold removed, Colon removed)
    processedHtml = processedHtml.replace(/^(\s*)(\*|\d+\.)\s+(.*?):?(\s*)$/gm, (match, p1, bullet, content, p4) => {
        let itemContent = content.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold markers
        const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
        itemContent = itemContent.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        return `${p1}<li>${itemContent}</li>${p4}`;
    });
    // Remaining Bold: **Bold text** -> <strong>...</strong>
    processedHtml = processedHtml.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // URLs (simple, might double-link in rare cases)
    const urlRegexGlobal = /(https?:\/\/[^\s<>"]+)/g;
    processedHtml = processedHtml.replace(urlRegexGlobal, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    console.log("Processed HTML:", processedHtml); // ★ Log
    bubbleText.innerHTML = processedHtml;

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
    bubble.appendChild(copyMsgBtn); // Copy button stays inside bubble
    bubble.appendChild(bubbleTime); // ★ Append Timestamp INSIDE bubble
    console.log("Appended text, copy button, and timestamp to bubble.");

    // Append bubble to row
    row.appendChild(bubble);

    // Append row to chat messages
    chatMessagesDiv.appendChild(row);
    console.log("Appended row to chat messages div.");

    // --- Remove Prism.js highlighting ---
    // setTimeout(() => { ... Prism.highlightAllUnder ... }, 0);

    // --- Remove Code Block Copy Listener ---
    // bubble.querySelectorAll('.copy-code-btn').forEach(btn => { ... });

    console.log("--- addMessageRow End (Simplified) ---");
}

// HTMLエスケープ用のヘルパー関数 (Keep this function)
function escapeHtml(unsafe) {
    // Use the browser's built-in capabilities to escape HTML
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
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
  try {
    const querySnapshot = await db.collection("chatSessions").get();
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
    sessionState: "active"
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

async function callGeminiModelSwitcher(prompt, retryCount = 0) {
  const modelSwitcherUrl = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev";
  const payload = {
    prompt: prompt,
    model: "gemini-2.0-flash"
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
        return callGeminiModelSwitcher(prompt, retryCount + 1);
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
  const simplePrompt = lastUserMessage ? lastUserMessage.text : "";
  
  if (!simplePrompt) {
    clearTimeout(updateTimeout);
    return;
  }
  
  const response = await callGeminiApi(simplePrompt, "gemini-1.5-pro");
  if (!response || !response.answer) {
    clearTimeout(updateTimeout);
    if (loadingRow && loadingText) {
      loadingText.innerText = "回答が得られませんでした";
      setTimeout(() => loadingRow.remove(), 3000);
    }
    return;
  }
  
  const refinementPrompt = `次の回答を元に、会話の流れを参考にして語尾を「だゾウ」に変えて、自然な日本語にしてください。

【元の回答】
${response.answer}

【会話履歴（参考）】
${history}`;
  
  const refined = await callGeminiApi(refinementPrompt, "gemini-1.5-pro");
  const finalAnswer = refined?.answer || response.answer;
  
  clearTimeout(updateTimeout);
  
  if (!loadingRow) {
    addMessageRow(finalAnswer, 'other');
  } else {
    loadingText.classList.remove('blinking-text');
    loadingText.innerText = finalAnswer;
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
  try {
    if (currentSession && currentSession.sessionState === "active") {
      await db.collection("chatSessions").doc(currentSession.id).set(currentSession);
      console.log(`アクティブなセッション "${currentSession.title}" (id=${currentSession.id}) のバックアップ成功`);
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
  try {
    console.log("restoreFromFirebase called");
    const querySnapshot = await db.collection("chatSessions").get();
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
});

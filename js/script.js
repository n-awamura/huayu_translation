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
  const chatMessagesDiv = document.getElementById('chatMessages');
  const messageDate = timestamp ? new Date(timestamp) : new Date();
  const now = new Date();

  let dateHeaderStr;
  if (messageDate.getFullYear() === now.getFullYear()) {
    dateHeaderStr = `${(messageDate.getMonth() + 1)
      .toString()
      .padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')}` +
      `(${getWeekday(messageDate)})`;
  } else {
    dateHeaderStr = `${messageDate.getFullYear()}/${(messageDate.getMonth() + 1)
      .toString().padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')}` +
      `(${getWeekday(messageDate)})`;
  }

  if (dateHeaderStr !== lastMessageDate) {
    lastMessageDate = dateHeaderStr;
    const dateHeader = document.createElement('div');
    dateHeader.classList.add('date-header');
    dateHeader.innerText = dateHeaderStr;
    chatMessagesDiv.appendChild(dateHeader);
  }

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
  bubbleText.innerText = text;

  const bubbleTime = document.createElement('div');
  bubbleTime.classList.add('bubble-time');
  const nowTime = timestamp ? new Date(timestamp) : new Date();
  const hours = nowTime.getHours().toString().padStart(2, '0');
  const minutes = nowTime.getMinutes().toString().padStart(2, '0');
  bubbleTime.innerText = `${hours}:${minutes}`;

  bubble.appendChild(bubbleText);
  bubble.appendChild(bubbleTime);
  row.appendChild(bubble);
  chatMessagesDiv.appendChild(row);
}

function buildPromptFromHistory() {
  if (!currentSession) return "ユーザー: (新規)";
  const MAX_MESSAGES = 8;
  const msgs = currentSession.messages || [];
  const startIndex = Math.max(0, msgs.length - MAX_MESSAGES);
  const recentMessages = msgs.slice(startIndex);
  let promptText = "これまでの会話:\n";
  recentMessages.forEach(item => {
    promptText += `${item.sender}: ${item.text}\n`;
  });
  promptText += "\n以上を踏まえて回答してください。必ず語尾をだゾウにしてください。なお、天気の話題は日本語にしてください。";
  return promptText;
}

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

async function endCurrentSession() {
  if (!currentSession) return;
  if (currentSession.sessionState === "finished") return;

  if (currentSession.messages && currentSession.messages.length > 0) {
    const newTitle = await summarizeSessionAsync(currentSession);
    currentSession.title = newTitle;
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
    console.log("No current session, creating new session");
    createNewSession();
    await new Promise(resolve => setTimeout(resolve, 500));
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

  if (/天気|気温|晴れ|雨/.test(message)) {
    const rawWeather = await getWeatherInfoForCity("Tokyo"); 
    if (rawWeather) {
      // ここで、Geminiに翻訳させる
      const translationPrompt = 
        `以下の文章を自然な日本語に翻訳して回答してください。語尾は「だゾウ」にしてください:\n${rawWeather}`;
  
      // Gemini API呼び出し（翻訳）
      const translatedWeather = await callGeminiApi(translationPrompt, "gemini-2.0-flash");
      if (translatedWeather) {
        // 翻訳結果をチャット画面に表示
        addMessageRow(translatedWeather, 'other');
        currentSession.messages.push({
          sender: 'Gemini',
          text: translatedWeather,
          timestamp: new Date()
        });
        currentSession.updatedAt = new Date().toISOString();
        backupToFirebase();
        scrollToBottom();
      }
    }
  } else {
    callGemini();
  }

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

  const sorted = conversationSessions.slice().sort((a, b) => {
    const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bUpdated - aUpdated;
  });

  sorted.forEach(session => {
    if (session.sessionState === "active") {
      return;
    }
    const link = document.createElement('a');
    link.href = "#";
    link.innerText = session.title || "無題";
    link.style.display = "block";
    link.style.marginBottom = "5px";
    link.style.paddingTop = "5px";
    link.style.paddingLeft = "5px";
    link.style.textDecoration = "none";
    link.style.color = "#FFFFFF";
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

function startNewChat() {
  console.log("startNewChat called");
  if (currentSession && currentSession.sessionState === "active") {
    endCurrentSession().then(() => {
      createNewSession();
    });
  } else {
    createNewSession();
  }
}

function createNewSession() {
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

  const url = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev"; // ← あなたの新しい Cloudflare Worker URL に置き換えてください

  const payload = {
    prompt: prompt,
    model: modelName
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
    if (resJson && resJson.result) {
      console.log("Cloudflare Gemini response:", resJson.result);
      return resJson.result.trim();
    } else {
      console.error("Cloudflareからの回答がありませんでした。");
      return null;
    }
  } catch (error) {
    console.error("callGeminiApiエラー:", error);
    return null;
  }
}


async function callGemini() {
  console.log("callGemini called");
  if (!currentSession) {
    console.log("No currentSession => createNewSession()");
    createNewSession();
  }
  const modelSelect = document.getElementById('model-select');
  const selectedModel = modelSelect ? modelSelect.value : "2.0 Flash";
  let modelName = "gemini-2.0-flash";
  if (selectedModel === "2.5 Pro") {
    modelName = "gemini-2.5-pro-exp-03-25";
  }
  const prompt = buildPromptFromHistory();
  const responseText = await callGeminiApi(prompt, modelName);
  if (!responseText) return;

  addMessageRow(responseText, 'other');
  scrollToBottom();

  currentSession.messages.push({
    sender: 'Gemini',
    text: responseText,
    timestamp: new Date()
  });
  currentSession.updatedAt = new Date().toISOString();

  backupToFirebase();
}

async function callGeminiSummary(prompt, retryCount = 0) {
  const modelName = "gemini-2.0-flash";
  return await callGeminiApi(prompt, modelName, retryCount);
}

async function summarizeSessionAsync(session) {
  const allText = (session.messages || []).map(m => m.text).join(" ");
  if (!allText) return session.title;
  const prompt = `以下の会話を15文字程度で自然な要約をしてください。` +
    `タイトルの前後に括弧以外の記号は入れないこと。\n${allText}`;
  const summary = await callGeminiSummary(prompt);
  return summary || session.title;
}

async function backupToFirebase() {
  console.log("backupToFirebase called");
  try {
    for (const session of conversationSessions) {
      await db.collection("chatSessions").doc(session.id).set(session);
      console.log(`セッション "${session.title}" (id=${session.id}) のバックアップ成功`);
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

// ==============================
// DOMContentLoaded: イベントリスナー設定 & 初期処理
// ==============================
document.addEventListener('DOMContentLoaded', function() {
  console.log("DOMContentLoaded event fired");

  // 1. 送信ボタン
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', function() {
      console.log("Send button clicked");
      onSendButton();
    });
  }

  // 2. ハンバーガーメニュー
  const hamburger = document.getElementById('hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', function() {
      console.log("Hamburger clicked");
      toggleSideMenu();
    });
  }

  // 3. サイドメニューの閉じるボタン
  const closeMenuBtn = document.getElementById('close-menu');
  if (closeMenuBtn) {
    closeMenuBtn.addEventListener('click', function() {
      console.log("Close menu clicked");
      toggleSideMenu();
    });
  }

  // 4. 新規チャットボタン
  const newChatBtn = document.getElementById('new-chat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', function() {
      console.log("New chat clicked");
      startNewChat();
    });
  }

  // 5. リストア
  const restoreBtn = document.getElementById('restore-btn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Restore clicked");
      restoreFromFirebase();
    });
  }

  // 6. 手動バックアップ
  const manualBackupBtn = document.getElementById('manual-backup-btn');
  if (manualBackupBtn) {
    manualBackupBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Manual backup clicked");
      backupToFirebase();
    });
  }

  // 7. すべてのチャットを削除
  const deleteBtn = document.getElementById('delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function(e) {
      e.preventDefault();
      console.log("Delete all chats clicked");
      deleteLocalChats();
    });
  }

  // 9. 3点リーダーメニュー自体のクリックイベント
  const footerDropdown = document.getElementById('footer-dropdown');
  if (footerDropdown) {
    footerDropdown.addEventListener('click', function(e) {
      console.log("Footer dropdown clicked");
      this.classList.toggle('open');
      e.stopPropagation();
    });
  }

  // サイドメニューの外をクリックしたら閉じる
  document.addEventListener('click', function handleOutsideClick(e) {
    const sideMenu = document.getElementById('side-menu');
    const hamburger = document.getElementById('hamburger');
    if (!sideMenu.classList.contains('open')) return;
    if (sideMenu.contains(e.target) || hamburger.contains(e.target)) return;
    sideMenu.classList.remove('open');
  });

  // 10. ページ終了時にバックアップ
  window.addEventListener('beforeunload', function() {
    backupToFirebase();
  });

  // 11. アプリ起動時: 既存セッションを読み込む
  restoreFromFirebase().then(() => {
    if (!conversationSessions.some(s => s.sessionState === "active")) {
      createNewSession();
    }
  });
});

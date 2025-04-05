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

// buildPromptFromHistoryを修正：全メッセージ（送信者と内容）を連結して返す
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

  // メッセージがある場合のみ要約
  if (currentSession.messages && currentSession.messages.length > 0) {
    const newTitle = await summarizeSessionAsync(currentSession);
    // 戻り値がオブジェクトでないかチェック
    if (typeof newTitle === "string") {
      currentSession.title = newTitle;
    } else {
      // 万が一オブジェクトなどが返ってきた場合の保険
      currentSession.title = currentSession.title || "無題";
    }
  } else {
    // 空の場合はタイトルのままでもいいが、不要なら削除してもよい
    // ここではとりあえず「finished」にして残す例
    // もし不要なら conversationSessions から remove するなどの処理を行う
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

  // currentSession が存在しない場合は新規作成
  if (!currentSession) {
    console.log("現在のセッションが存在しないため、新規セッションを作成します。");
    createNewSession();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // finished なセッションなら、再利用して active に戻す
  else if (currentSession.sessionState !== "active") {
    console.log("終了済みセッションを再利用するため、active に切り替えます。");
    currentSession.sessionState = "active";
  }

  addMessageRow(message, 'self');
  input.value = '';
  scrollToBottom();

  // タイトルが "無題" の場合は、今回のメッセージの先頭部分をタイトルに反映
  if (currentSession.title === "無題" && message) {
    currentSession.title = message.slice(0, 10) + (message.length > 10 ? "..." : "");
  }

  currentSession.messages.push({
    sender: 'User',
    text: message,
    timestamp: new Date()
  });
  currentSession.updatedAt = new Date().toISOString();

  // Gemini 呼び出し（省略）
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

  // currentSession が存在する場合のみ、それを active として扱う
  const activeSessions = currentSession ? [currentSession] : [];

  // currentSession 以外のセッションは finished とみなす
  const finishedSessions = conversationSessions.filter(s => s.id !== currentSession?.id);

  // finishedSessions について、空かつ「無題」のものは除外する
  const finishedSessionsFiltered = finishedSessions.filter(s => {
    const isEmpty = !s.messages || s.messages.length === 0;
    const isUntitled = s.title === "無題";
    return !(isEmpty && isUntitled);
  });

  // 両グループとも更新日時の降順にソート
  activeSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  finishedSessionsFiltered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  // まず active (currentSession)、次に finishedSessions を表示
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
    // currentSession と一致する場合のみ太字
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

  // すでにアクティブかつ空のセッションがあれば、それを再利用
  const activeEmptySession = conversationSessions.find(
    s => s.sessionState === "active" && (!s.messages || s.messages.length === 0)
  );

  if (activeEmptySession) {
    console.log("既存の空のアクティブセッションを再利用します:", activeEmptySession.id);
    currentSession = activeEmptySession;
    // 表示を初期化
    document.getElementById('chatMessages').innerHTML = "";
    lastMessageDate = "";
    scrollToBottom();
    return;
  }

  // ここに来たということは「空のアクティブセッション」がない
  // もし現在のセッションが active なら終了させる（中身があれば要約を取る）
  if (currentSession && currentSession.sessionState === "active") {
    await endCurrentSession();
  }

  // その後で新規セッションを作成
  createNewSession();
}


function createNewSession() {
  // 既にアクティブで、かつメッセージが一度も送信されていない（空）の場合は再利用
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

  // ✅ グラウンディングに対応したモデルは gemini-1.5-pro のみ
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

// gemini-model-switcherを利用する新たな関数（要約用）
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

// summary用のGemini呼び出し：gemini-model-switcher経由でgemini-2.0-flashを利用
async function callGeminiSummary(prompt, retryCount = 0) {
  return await callGeminiModelSwitcher(prompt, retryCount);
}

async function callGemini() {
  console.log("callGemini called");

  if (!currentSession) createNewSession();

  // 1️⃣ 全会話履歴を取得
  const history = buildPromptFromHistory();
  if (!history) return;

  // 2️⃣ シンプルなプロンプトとして最後のユーザー発言を利用
  const lastUserMessage = currentSession.messages
    .slice()
    .reverse()
    .find(m => m.sender === "User");
  const simplePrompt = lastUserMessage ? lastUserMessage.text : "";
  if (!simplePrompt) return;

  const response = await callGeminiApi(simplePrompt, "gemini-1.5-pro");
  if (!response || !response.answer) return;

  // 3️⃣ 会話履歴全体を利用した後処理プロンプトを作成
  const refinementPrompt = `次の回答を元に、会話の流れを参考にして語尾を「だゾウ」に変えて、自然な日本語にしてください。挨拶は繰り返さなくていいです。

【元の回答】
${response.answer}

【会話履歴（参考）】
${history}`;

  // 4️⃣ もう一度 Gemini 呼び出し
  const refined = await callGeminiApi(refinementPrompt, "gemini-1.5-pro");

  const finalAnswer = refined?.answer || response.answer;

  // 5️⃣ 回答を表示（参考URLは出力しない）
  addMessageRow(finalAnswer, 'other');
  scrollToBottom();

  // 6️⃣ セッション保存（参考URLも sources として記憶）
  currentSession.messages.push({
    sender: 'Gemini',
    text: finalAnswer,
    timestamp: new Date(),
    sources: response.sources || []
  });
  currentSession.updatedAt = new Date().toISOString();

  backupToFirebase();
}


// 会話全体を対象に要約を作成（過去の会話も覚えている）
async function summarizeSessionAsync(session) {
  const allText = (session.messages || []).map(m => m.text).join(" ");
  if (!allText) return session.title;  // 空ならそのまま
  
  const prompt = `以下の会話を15文字程度で自然な要約をしてください。タイトルの前後に括弧以外の記号は入れないこと。\n${allText}`;
  const summaryObj = await callGeminiSummary(prompt);

  // summaryObj が { answer: "...", ... } の形を想定
  let summary = summaryObj?.answer;
  if (typeof summary !== "string") {
    summary = "無題";
  }
  return summary.trim() || "無題";
}

async function updateUntitledSessions() {
  console.log("updateUntitledSessions called");
  // conversationSessions には、すでに Firestore から読み込まれたセッションが入っている前提
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
    // アクティブなセッションが存在する場合のみバックアップ
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
    updateUntitledSessions();
    if (!conversationSessions.some(s => s.sessionState === "active")) {
      createNewSession();
    }
  });
});

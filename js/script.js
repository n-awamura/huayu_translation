// ==============================
// グローバル変数
// ==============================
let lastHeaderDate = null;
let recognition = null; 
let isRecording = false; 
let firebaseUiInitialized = false;
let selectedImageFile = null;

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

function escapeHtml(unsafe) {
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
}

function processInlineFormatting(text) {
    let escapedText = escapeHtml(text);
    escapedText = escapedText.replace(/(?<!&lt;|<)\*\*(?![*])(.*?)(?<![*])\*\*(?!&gt;|>)/g, (match, content) => {
        return `<strong>${escapeHtml(content)}</strong>`;
    });
    const urlRegex = /(?<!href=["'])(https?:\/\/[^\s<>\"]+)/g;
    escapedText = escapedText.replace(urlRegex, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
    return escapedText;
}

function processMarkdownSegment(segment) {
    let finalHtml = '';
    const lines = segment.trim().split('\n');
    let listOpen = false;

    lines.forEach(line => {
        line = line.trim();
        if (line === '') return;

        if (line.match(/^\*\*(.*?)\*\*$/)) {
            if (listOpen) { finalHtml += '</ul>'; listOpen = false; }
            const titleContent = line.slice(2, -2).trim();
            finalHtml += `<p class="chat-title"><strong>${escapeHtml(titleContent)}</strong></p>`;
        }
        else if (line.match(/^(\*|\d+\.)\s+/)) {
            if (!listOpen) { finalHtml += '<ul>'; listOpen = true; }
            const itemMatch = line.match(/^(\*|\d+\.)\s+(.*?)$/);
            const itemContent = itemMatch ? itemMatch[2].trim() : '';
            finalHtml += `<li>${processInlineFormatting(itemContent)}</li>`;
        }
        else {
            if (listOpen) { finalHtml += '</ul>'; listOpen = false; }
            finalHtml += `<p>${processInlineFormatting(line)}</p>`;
        }
    });

    if (listOpen) { finalHtml += '</ul>'; }
    return finalHtml;
}

function addMessageRow(text, sender, timestamp = null, sources = null) {
    if (sources) {
        console.log("Received Sources (Hidden from UI):", sources);
    }

    const chatMessagesDiv = document.getElementById('chatMessages');
    const messageDate = timestamp ? new Date(timestamp) : new Date();

    let shouldAddHeader = false;
    if (!lastHeaderDate || !(lastHeaderDate instanceof Date) ||
        lastHeaderDate.getFullYear() !== messageDate.getFullYear() ||
        lastHeaderDate.getMonth() !== messageDate.getMonth() ||
        lastHeaderDate.getDate() !== messageDate.getDate()) {
        shouldAddHeader = true;
    }

    if (shouldAddHeader) {
        const lastElement = chatMessagesDiv.lastElementChild;
        if (!lastElement || !lastElement.classList.contains('date-header')) {
            let dateHeaderStr = `${(messageDate.getMonth() + 1).toString().padStart(2, '0')}/${messageDate.getDate().toString().padStart(2, '0')} (${getWeekday(messageDate)})`;
            const dateHeader = document.createElement('div');
            dateHeader.classList.add('date-header');
            dateHeader.innerText = dateHeaderStr;
            chatMessagesDiv.appendChild(dateHeader);
            lastHeaderDate = messageDate;
        }
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

    const originalTextForCopy = text;
    const codeBlocks = [];
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    let blockIndex = 0;
    const segments = [];

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        }
        const lang = match[1] || 'plaintext';
        const code = match[2];
        segments.push({ type: 'code', lang: lang, content: code, index: blockIndex });
        codeBlocks.push({ lang, code });
        lastIndex = codeBlockRegex.lastIndex;
        blockIndex++;
    }
    if (lastIndex < text.length) {
        segments.push({ type: 'text', content: text.substring(lastIndex) });
    }

    let finalHtml = '';
    segments.forEach(segment => {
        if (segment.type === 'text') {
             if (segment.content && segment.content.trim()) {
                 finalHtml += processMarkdownSegment(segment.content);
             }
        } else if (segment.type === 'code') {
            const codeId = `code-${Date.now()}-${segment.index}-${Math.random().toString(36).substring(2)}`;
            const escapedCode = escapeHtml(segment.content.trim());
            const codeBlockHtml = `<div class="code-block-container"><pre><button class="copy-code-btn" data-clipboard-target="#${codeId}" title="コードをコピー"><i class="bi bi-clipboard"></i></button><code id="${codeId}" class="language-${segment.lang}">${escapedCode}</code></pre></div>`;
            finalHtml += codeBlockHtml;
        }
    });
    bubbleText.innerHTML = finalHtml;

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

    if (typeof Prism !== 'undefined') {
        Prism.highlightAllUnder(bubble);
    }

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

async function onSendButton() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message && !selectedImageFile) return;

  if (message) {
      addMessageRow(message, 'self');
  }
  input.value = '';
  scrollToBottom();
  
  await callGemini(message, selectedImageFile); 

  removeImagePreview();
}

async function toggleSideMenu() {
  const sideMenu = document.getElementById('side-menu');
  sideMenu.classList.toggle('open');
  if (sideMenu.classList.contains('open')) {
    updateSideMenuFromFirebase(false); 
  }
}

async function updateSideMenuFromFirebase(loadMore = false) {
    const historyDiv = document.getElementById('conversation-history');
    if (historyDiv) {
        historyDiv.innerHTML = '<li id="noSessionsMessage" style="padding: 10px; text-align: center; color: #888;">履歴機能はありません</li>';
    }
    const loadMoreButton = document.getElementById('loadMoreSessions');
    if (loadMoreButton) {
        loadMoreButton.style.display = 'none';
    }
}

function updateSideMenu() {
  const historyDiv = document.getElementById('conversation-history');
  historyDiv.innerHTML = ""; 
  
  if (historyDiv) {
    const noSessionsMessage = document.createElement('li');
    noSessionsMessage.id = 'noSessionsMessage';
    noSessionsMessage.style.padding = '10px';
    noSessionsMessage.style.textAlign = 'center';
    noSessionsMessage.style.color = '#888';
    noSessionsMessage.textContent = '履歴機能はありません';
    historyDiv.appendChild(noSessionsMessage);
  }
}

async function startNewChat() {
  showThinkingIndicator(true);
  try {
    await createNewSession();
  } catch (error) {
    console.error("Error starting new chat:", error);
  } finally {
    showThinkingIndicator(false);
  }
}

async function createNewSession() {
    document.getElementById('chatMessages').innerHTML = "";
    lastHeaderDate = null;
    const chatInputElement = document.getElementById('chatInput');
    if (chatInputElement) { 
        chatInputElement.value = ''; 
        chatInputElement.focus();   
    }
    document.getElementById('chatHeaderTitle').textContent = 'TRANSLATION'; 
    scrollToBottom();
    return Promise.resolve(); 
}

// Gemini Model Switcher Workerを呼び出す関数
async function callGeminiModelSwitcher(promptParts, modelName = 'gemini-2.5-flash', useGrounding = false, toolName = null, retryCount = 0) {
    const workerUrl = "https://gemini-model-switcher.fudaoxiang-gym.workers.dev"; 
    const maxRetries = 2;
    try {
        let response;
        if (useGrounding && toolName) {
            const queryText = promptParts.map(p => p.text || '').join('\n').trim();
            if (!queryText) throw new Error("Grounding request requires text content.");
            const params = new URLSearchParams({ q: queryText, model: modelName, tool: toolName });
            response = await fetch(`${workerUrl}?${params.toString()}`, { method: 'GET' });
        } else {
            const requestPayload = { contents: [{ parts: promptParts }] };
            const urlWithModel = new URL(workerUrl);
            urlWithModel.searchParams.set('model', modelName);
            response = await fetch(urlWithModel.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload)
            });
        }
        if (!response.ok) {
             const errorText = await response.text();
            throw new Error(`Worker Error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        if (data && data.hasOwnProperty('answer')) {
            return { result: { answer: data.answer }, sources: data.sources || [] };
        }
        if (data && typeof data === 'object' && data.hasOwnProperty('result')) {
            return data;
        }
        return { result: { answer: data }, sources: [] };
    } catch (error) {
        console.error(`Error calling Gemini Model Switcher (Attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
        if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            return callGeminiModelSwitcher(promptParts, modelName, useGrounding, toolName, retryCount + 1); 
        } else {
             throw error;
        }
    }
}

async function callGeminiSummary(prompt, retryCount = 0) {
    return await callGeminiModelSwitcher(prompt, 'gemini-2.5-flash', false, null, retryCount);
}

// ===== メインの Gemini 呼び出し関数 =====
async function callGemini(userInput, imageFile = null) {
    const chatMessagesDiv = document.getElementById('chatMessages');
    const delayTime = 1500;

    const loadingRow = document.createElement('div');
    loadingRow.classList.add('message-row', 'other', 'thinking-row');
    const icon = document.createElement('img');
    icon.classList.add('icon');
    icon.src = 'img/elephant.png';
    icon.alt = '相手アイコン';
    loadingRow.appendChild(icon);
    const bubble = document.createElement('div');
    bubble.classList.add('bubble');
    const loadingTextElement = document.createElement('div');
    loadingTextElement.classList.add('bubble-text', 'blinking-text');
    bubble.appendChild(loadingTextElement);
    loadingRow.appendChild(bubble);

    let thinkingTimeoutId = null;

    try {
        if (!imageFile) {
            thinkingTimeoutId = setTimeout(() => {
                if (!loadingRow.isConnected) {
                    loadingTextElement.innerHTML = "<div class='temp-thinking-message'>考え中だゾウ...</div>";
                    chatMessagesDiv.appendChild(loadingRow);
                    scrollToBottom();
                }
            }, delayTime);
        } else {
            loadingTextElement.innerHTML = "<div class='temp-thinking-message'>画像を分析中だゾウ...</div>";
            chatMessagesDiv.appendChild(loadingRow);
            scrollToBottom();
        }

        let finalAnswer = null;
        let finalSources = null;

        if (imageFile) {
            const base64Image = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(imageFile.file);
            });
            const recognitionPrompt = "この画像を分析してください。もし画像が看板、メニュー、スライドなど、主にテキストで構成されている場合は、そのテキストをすべて書き出してください。もし画像が物体、ランドマーク、人物などの写真である場合は、その対象を最も的確に表す固有名詞（可能な場合）を含む短いテキストを返してください。書き出したテキスト、または対象の名称のみを返し、それ以外の説明は不要です。";
            const step1Parts = [{ "inline_data": { "mime_type": imageFile.mimeType, "data": base64Image } }, { "text": recognitionPrompt }];
            const recognitionData = await callGeminiModelSwitcher(step1Parts, 'gemini-2.5-flash', false, null);
            const identifiedSubject = recognitionData?.result?.answer?.trim();
            if (!identifiedSubject || identifiedSubject.length < 1) { throw new Error("画像から対象を特定できませんでした。"); }
            
            // 「考え中」メッセージを更新
            loadingTextElement.innerHTML = `<div class='temp-thinking-message'>「${identifiedSubject}」を翻訳・検索中...</div>`;
            
            // --- STEP 2: 情報検索・翻訳 ---
            // ★ 修正: AIが自身の役割に言及しないよう、プロンプトの構成をより明確化 ★
            const finalSearchPrompt = `あなたは非常に優秀な翻訳家で、親しみやすいゾウのキャラクターとして応答を生成します。

**守るべきルール:**
*   応答の語尾は、基本的にはすべて「だゾウ」で統一してください。文脈に応じて「〜ゾウ」のように、より自然な形で終わらせることも許可します。
*   **重要:** あなたのキャラクター設定（翻訳家、ゾウなど）について、応答の中で絶対に言及しないでください。挨拶や前置きも不要です。すぐに応答を開始してください。
*   ユーザーの現在地に関する情報は、一切使用しないでください。

**指示:**
以下の「テキスト/テーマ」について、指定された形式で解説してください。

**テキスト/テーマ:**
「${identifiedSubject}」

**形式:**
1.  まず、「テキスト/テーマ」を自然な台湾華語（繁体字中国語）に翻訳し、拼音（ピンイン）を付記してください。カタカナのルビは不要です。「テキスト/テーマ」が長文の場合は、全文を翻訳してください。
2.  次に、翻訳した台湾華語の中から主要な単語を1つ選び、その単語を使った例文を台湾華語（繁体字中国語）で、拼音（ピンイン）を付けて提示し、その例文の日本語訳と簡単な文法解説を日本語で提供してください。
3.  最後に、「テキスト/テーマ」に関する興味深い関連情報や豆知識を、日本語で詳しく解説してください。「テキスト/テーマ」が長文の場合は、関連情報は簡潔にしてください。

${userInput ? `ユーザーからの追加リクエスト: 「${userInput}」\nこのリクエストも考慮に入れてください。` : ''}`;
            const step2Parts = [{ text: finalSearchPrompt }];
            const searchData = await callGeminiModelSwitcher(step2Parts, 'gemini-2.5-flash', true, 'googleSearch');
            if (!searchData || searchData.result.answer === undefined) { throw new Error("情報の検索に失敗しました。"); }
            finalAnswer = searchData.result.answer;
            finalSources = searchData.sources;
        } else {
            const promptParts = [];
            const characterPrompt = "あなたは非常に優秀な翻訳家で、親しみやすいゾウのキャラクターです。あなたの応答の語尾は、基本的にはすべて「だゾウ」で統一してください。ただし、文脈に応じて「〜ゾウ」のように、より自然な形で終わらせることも許可します（例：「いいですね」→「いいゾウ」）。キャラクター設定に関する言及は、応答に一切含めないでください。";
            const translationRequest = `ユーザーが入力した日本語「${userInput}」を、自然な台湾華語（繁体字中国語）に訳してください。\nその際、以下の点に注意して回答を生成してください。\n1. 主な翻訳をまず提示する。\n2. 次に、同じ意味合いで使える別の言い回しや類義表現を1～2個提示する。\n3. 最後に、提示した翻訳や言い回しについて、簡単な文法解説やニュアンスの違い、使われる場面などを補足説明する。`;
            const combinedPrompt = `${characterPrompt}\n\n上記のキャラクター設定および以下の指示に従って、ユーザーの入力を翻訳・解説してください。\n\n${translationRequest}`;
            promptParts.push({ "text": combinedPrompt });
            const result = await callGeminiModelSwitcher(promptParts, 'gemini-2.5-flash', false, null);
            finalAnswer = result.result.answer;
            finalSources = result.sources;
        }
        
        clearTimeout(thinkingTimeoutId);
        
        if (!loadingRow.isConnected) {
            addMessageRow(finalAnswer, 'other', new Date(), finalSources);
        } else {
            replaceElementWithFinalMessage(loadingRow, finalAnswer, finalSources);
        }

    } catch (error) {
        console.error("Error calling Gemini:", error);
        clearTimeout(thinkingTimeoutId);
        const errorMessage = `翻訳中にエラーが発生しました: ${error.message}`;
        if (loadingRow.isConnected) {
            loadingTextElement.classList.remove('blinking-text');
            loadingTextElement.innerHTML = `<div class='temp-thinking-message error-message'>${escapeHtml(errorMessage)} だゾウ</div>`;
        } else {
            addMessageRow(errorMessage, 'other');
        }
    } finally {
        scrollToBottom();
    }
}

// 「考え中」の行を最終的なメッセージで置き換えるヘルパー関数
function replaceElementWithFinalMessage(elementToReplace, text, sources) {
    const bubble = elementToReplace.querySelector('.bubble');
    if (!bubble) return;

    const bubbleText = bubble.querySelector('.bubble-text');
    bubbleText.classList.remove('blinking-text');

    const originalTextForCopy = text;
    let finalHtml = '';
    const segments = [];
    const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let lastIndex = 0; let match; let blockIndex = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) segments.push({ type: 'text', content: text.substring(lastIndex, match.index) });
        segments.push({ type: 'code', lang: match[1] || 'plaintext', content: match[2], index: blockIndex });
        lastIndex = codeBlockRegex.lastIndex; blockIndex++;
    }
    if (lastIndex < text.length) segments.push({ type: 'text', content: text.substring(lastIndex) });

    segments.forEach(segment => {
        if (segment.type === 'text' && segment.content?.trim()) {
            finalHtml += processMarkdownSegment(segment.content);
        } else if (segment.type === 'code') {
            const codeId = `code-${Date.now()}-${segment.index}`;
            const escapedCode = escapeHtml(segment.content.trim());
            finalHtml += `<div class="code-block-container"><pre><button class="copy-code-btn" data-clipboard-target="#${codeId}" title="コードをコピー"><i class="bi bi-clipboard"></i></button><code id="${codeId}" class="language-${segment.lang}">${escapedCode}</code></pre></div>`;
        }
    });
    bubbleText.innerHTML = finalHtml;

    const bubbleTime = document.createElement('div');
    bubbleTime.classList.add('bubble-time');
    const now = new Date();
    bubbleTime.innerText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    bubble.appendChild(bubbleTime);

    const copyMsgBtn = document.createElement('button');
    copyMsgBtn.classList.add('copy-msg-btn');
    copyMsgBtn.innerHTML = '<i class="bi bi-clipboard"></i>';
    copyMsgBtn.title = "メッセージをコピー";
    copyMsgBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(originalTextForCopy).then(() => {
            copyMsgBtn.innerHTML = '<i class="bi bi-check-lg"></i>';
            copyMsgBtn.title = "コピーしました";
            setTimeout(() => { 
                copyMsgBtn.innerHTML = '<i class="bi bi-clipboard"></i>';
                copyMsgBtn.title = "メッセージをコピー";
            }, 1500);
        });
    });
    bubble.appendChild(copyMsgBtn);

    if (typeof Prism !== 'undefined') Prism.highlightAllUnder(bubble);

    bubble.querySelectorAll('.copy-code-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const targetSelector = event.target.closest('button').getAttribute('data-clipboard-target');
            const codeElement = document.querySelector(targetSelector);
            if (codeElement) {
                navigator.clipboard.writeText(codeElement.textContent);
            }
        });
    });

    elementToReplace.classList.remove('thinking-row');
}

async function summarizeSessionAsync(session) {
  return "TRANSLATION";
}

async function restoreFromFirebase() {
  const currentUser = firebase.auth().currentUser;
  if (!currentUser) return;
  
  showThinkingIndicator(true); 
  document.getElementById('chatMessages').innerHTML = ""; 
  lastHeaderDate = null; 
  
  try {
    updateSideMenu();
    await createNewSession();
  } catch (error) {
    console.error("リストアエラー:", error);
  } finally {
    showThinkingIndicator(false); 
  }
}

function adjustSpeechBubbleFontSize() {
  const bubble = document.getElementById('elephantBubble');
  if (!bubble) return;
  const maxWidth = bubble.offsetWidth;
  const textLength = bubble.textContent.length;
  if (textLength > 50) {
    bubble.classList.add('long');
  } else {
    bubble.classList.remove('long');
  }
  if (bubble.scrollWidth > maxWidth) {
    bubble.classList.add('long');
  }
}

function setSpeechBubbleText(text) {
  const bubble = document.getElementById('elephantBubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('visible');
  adjustSpeechBubbleFontSize();
}

function showThinkingIndicator(show) {
    const bubble = document.getElementById('elephantBubble');
    if (!bubble) return;
    if (show) {
        bubble.textContent = "考え中だゾウ...";
        bubble.classList.add('visible');
        adjustSpeechBubbleFontSize();
    } else {
        bubble.classList.remove('visible');
    }
}

function logout() {
    firebase.auth().signOut().catch((error) => {
        console.error('Logout Error', error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    let ui = null;
    const uiConfig = {
        signInSuccessUrl: './',
        signInOptions: [ firebase.auth.GoogleAuthProvider.PROVIDER_ID ],
        tosUrl: null,
        privacyPolicyUrl: null
    };
    if (!firebaseUiInitialized) {
        ui = new firebaseui.auth.AuthUI(firebase.auth());
        firebaseUiInitialized = true;
    }

    firebase.auth().onAuthStateChanged(async (user) => {
        const loginContainer = document.getElementById('firebaseui-auth-container');
        const mainContent = document.querySelector('.chat-container');
        const headerControls = document.querySelector('#main-header .header-controls');
        const sideMenu = document.getElementById('side-menu');

        if (user) {
            if (loginContainer) loginContainer.style.display = 'none';
            if (mainContent) mainContent.style.display = 'flex';
            if (headerControls) headerControls.style.display = 'flex';
            if (sideMenu) sideMenu.style.display = 'flex';
            document.getElementById('user-email').textContent = user.email;

            try {
                 showThinkingIndicator(true);
                 await restoreFromFirebase();
                 showThinkingIndicator(false);
             } catch (error) {
                 console.error("Initialization error after login:", error);
                 showThinkingIndicator(false);
                 try {
                     await createNewSession();
                 } catch (fallbackError) {
                     console.error("Fallback createNewSession failed:", fallbackError);
                 }
             }
        } else {
             window.location.href = 'login.html';
        }
    });

    const sendButton = document.getElementById('sendBtn');
    const chatInput = document.getElementById('chatInput');
    const hamburger = document.getElementById('hamburger');
    const closeMenu = document.getElementById('close-menu');
    const newChat = document.getElementById('new-chat');
    const modelSelect = document.getElementById('model-select');
    const dropdownToggle = document.getElementById('dropdown-toggle');
    const logoutLink = document.getElementById('logout-link');
    const micBtn = document.getElementById('micBtn');
    const imageUploadBtn = document.getElementById('image-upload-btn');
    const imageUploadInput = document.getElementById('image-upload-input');
    const removeImageBtn = document.getElementById('remove-image-btn');

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
    if (logoutLink) logoutLink.addEventListener('click', logout);
    if (micBtn) micBtn.addEventListener('click', toggleRecording);

    if (imageUploadBtn && imageUploadInput) {
        imageUploadBtn.addEventListener('click', () => imageUploadInput.click());
        imageUploadInput.addEventListener('change', handleImageUpload);
    }
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', removeImagePreview);
    }

    document.addEventListener('click', function handleOutsideClick(e) {
        const dropdown = document.getElementById('menu-footer')?.querySelector('.dropdown.open');
        if (dropdown && !dropdown.contains(e.target) && !document.getElementById('dropdown-toggle')?.contains(e.target)) {
            dropdown.classList.remove('open');
        }
        const sideMenu = document.getElementById('side-menu');
        const hamburger = document.getElementById('hamburger');
        if (sideMenu && sideMenu.classList.contains('open') && hamburger && !sideMenu.contains(e.target) && !hamburger.contains(e.target)) {
            sideMenu.classList.remove('open');
        }
    });

    initializeSpeechRecognition();

    window.addEventListener('resize', setAppHeight);
    setAppHeight();

    const elephantImg = document.getElementById("elephantImg");
    const elephantBubble = document.getElementById("elephantBubble");

    if (elephantImg && elephantBubble) {
        elephantImg.addEventListener("click", async function() {
            if (elephantBubble.classList.contains("visible")) {
                elephantBubble.classList.remove("visible");
            } else {
                const randomCity = getRandomCity();
                setSpeechBubbleText("都市情報を取得中だゾウ...");
                try {
                    const info = await getCityInfo(randomCity);
                    setSpeechBubbleText(`${info.city}は${info.direction}${info.distance}kmだゾウ！`);
                    setTimeout(() => { elephantBubble.classList.remove("visible"); }, 6000);
                } catch (error) {
                    console.error("Error getting city info:", error);
                    setSpeechBubbleText(`エラーだゾウ: ${error.message || '情報取得失敗'}`);
                    setTimeout(() => { elephantBubble.classList.remove("visible"); }, 6000);
                }
            }
        });
    }
});

// ===== 音声認識関連 =====
function initializeSpeechRecognition() {
    const micBtn = document.getElementById("micBtn");
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
        };

        recognition.onresult = (event) => {
            let finalTranscript = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                const chatInput = document.getElementById("chatInput");
                if (chatInput) {
                    chatInput.value += finalTranscript;
                }
            }
        };

        recognition.onerror = (event) => {
            console.error("音声認識エラー:", event.error);
            let message = "音声認識中にエラーが発生しました。";
            if (event.error === 'no-speech') message = "音声が検出されませんでした。";
            else if (event.error === 'audio-capture') message = "マイクにアクセスできませんでした。";
            else if (event.error === 'not-allowed') message = "マイクの使用が許可されていません。";
            alert(message);
            isRecording = false;
            micBtn.classList.remove("recording");
            micBtn.title = "音声入力";
        };

        recognition.onend = () => {
            isRecording = false;
            micBtn.classList.remove("recording");
            micBtn.title = "音声入力";
        };

    } else {
        if (micBtn) micBtn.style.display = "none";
    }
}

function toggleRecording() {
    if (!recognition) return;
    if (!isRecording) {
        try {
            recognition.start();
        } catch (error) {
            alert("音声認識を開始できませんでした。");
        }
    } else {
        recognition.stop();
    }
}

// ===== 都市情報取得関連のヘルパー関数 =====
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

function calculateDirection(lat1, lon1, lat2, lon2) {
    const lat1Rad = lat1 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;
    const y = Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad);
    let bearing = Math.atan2(y, x) * (180 / Math.PI);
    bearing = (bearing + 360) % 360;
    const directions = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
    const index = Math.round(bearing / 22.5) % 16;
    return directions[index];
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

function getRandomCity() {
    return cities[Math.floor(Math.random() * cities.length)];
}

function getCityInfo(city) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("ブラウザが位置情報をサポートしていません。"));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                try {
                    const currentLat = position.coords.latitude;
                    const currentLon = position.coords.longitude;
                    const distance = calculateDistance(currentLat, currentLon, city.latitude, city.longitude);
                    const direction = calculateDirection(currentLat, currentLon, city.latitude, city.longitude);
                    resolve({ city: city.name, distance, direction });
                } catch (calculationError) {
                    reject(new Error("位置情報の計算中にエラーが発生しました。"));
                }
            },
            (error) => {
                let errorMessage = "位置情報の取得に失敗しました。";
                switch (error.code) {
                    case error.PERMISSION_DENIED: errorMessage = "位置情報の利用が許可されていません。"; break;
                    case error.POSITION_UNAVAILABLE: errorMessage = "位置情報を取得できませんでした。"; break;
                    case error.TIMEOUT: errorMessage = "位置情報の取得がタイムアウトしました。"; break;
                }
                reject(new Error(errorMessage));
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

function setAppHeight() {
  const doc = document.documentElement;
  doc.style.setProperty('--app-height', `${window.innerHeight}px`);
}

// ===== 画像処理関連の関数 =====
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  selectedImageFile = { file: file, mimeType: file.type };

  const reader = new FileReader();
  reader.onload = (e) => {
    const imagePreview = document.getElementById('image-preview');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    imagePreview.src = e.target.result;
    imagePreviewContainer.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function removeImagePreview() {
  selectedImageFile = null;
  const imagePreviewContainer = document.getElementById('image-preview-container');
  const imageUploadInput = document.getElementById('image-upload-input');
  imagePreviewContainer.style.display = 'none';
  document.getElementById('image-preview').src = '';
  imageUploadInput.value = '';
}
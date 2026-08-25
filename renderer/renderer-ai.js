// ── LOVI AI Side Panel Controller ──────────────────────
(function () {
const api = window.browser || {
    setAiPanelOpen: () => {},
    initAi: () => {},
    onAiStatus: () => {},
    onAiChunk: () => {},
    onAiDone: () => {},
    onAiError: () => {},
    aiAsk: () => {},
    aiStop: () => {}
};

    // DOM Elements
    const btnAiToggle = document.getElementById('btn-ai-toggle');
    const btnAiClose = document.getElementById('btn-ai-close');
    const aiPanel = document.getElementById('ai-panel');

    const aiStatusDot = document.getElementById('ai-status-dot');
    const aiStatusText = document.getElementById('ai-status-text');

    const progressBox = document.getElementById('ai-progress-box');
    const progressMsg = document.getElementById('progress-message');
    const progressPercent = document.getElementById('progress-percent');
    const progressBarFill = document.getElementById('progress-bar-fill');

    const qaSummarize = document.getElementById('qa-summarize');
    const qaExplain = document.getElementById('qa-explain');
    const qaAsk = document.getElementById('qa-ask');

    const aiMessages = document.getElementById('ai-messages');
    const aiInput = document.getElementById('ai-input');
    const aiSendBtn = document.getElementById('ai-send-btn');
    const aiStopBtn = document.getElementById('ai-stop-btn');

    // State
    let isPanelOpen = false;
    let isGenerating = false;
    let isModelInitialized = false;
    let currentAiBubble = null;
    let currentRawText = '';

    // ── Panel Open / Close ────────────────────────────────

    function togglePanel(open) {
        isPanelOpen = typeof open === 'boolean' ? open : !isPanelOpen;
        if (isPanelOpen) {
            aiPanel.classList.remove('hidden');
            btnAiToggle.classList.add('active');
            api.setAiPanelOpen(true);
            setTimeout(() => aiInput.focus(), 100);

            // Lazy load the model as soon as the user opens the AI panel
            if (!isModelInitialized) {
                isModelInitialized = true;
                api.initAi();
            }
        } else {
            aiPanel.classList.add('hidden');
            btnAiToggle.classList.remove('active');
            api.setAiPanelOpen(false);
        }
    }

    btnAiToggle.addEventListener('click', () => togglePanel());
    btnAiClose.addEventListener('click', () => togglePanel(false));

    // ── Status & Download Progress ────────────────────────

    api.onAiStatus((data) => {
        const { status, progress, error } = data;

        aiStatusDot.className = `status-dot ${status}`;

        if (status === 'idle') {
            aiStatusText.textContent = 'Idle';
            progressBox.classList.add('hidden');
        } else if (status === 'downloading') {
            aiStatusText.textContent = `Downloading ${progress}%`;
            progressBox.classList.remove('hidden');
            progressMsg.textContent = 'Downloading Qwen 2.5 1.5B (0.99 GB)...';
            progressPercent.textContent = `${progress}%`;
            progressBarFill.style.width = `${progress}%`;
        } else if (status === 'loading') {
            aiStatusText.textContent = 'Loading Engine...';
            progressBox.classList.remove('hidden');
            progressMsg.textContent = 'Loading Qwen 2.5 model into RAM...';
            progressPercent.textContent = '...';
            progressBarFill.style.width = '100%';
        } else if (status === 'ready') {
            aiStatusText.textContent = 'Ready';
            progressBox.classList.add('hidden');
        } else if (status === 'generating') {
            aiStatusText.textContent = 'Thinking...';
            progressBox.classList.add('hidden');
        } else if (status === 'error') {
            aiStatusText.textContent = 'Error';
            progressBox.classList.add('hidden');
            appendSystemMessage(`Error: ${error || 'An unexpected error occurred.'}`, 'error');
        }
    });

    // ── Message Bubbles ───────────────────────────────────

    function appendUserMessage(text) {
        // Hide welcome card if present
        const welcome = aiMessages.querySelector('.ai-welcome-card');
        if (welcome) welcome.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-msg user';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.textContent = text;

        msgDiv.appendChild(bubble);
        aiMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function createAiMessageBubble() {
        const welcome = aiMessages.querySelector('.ai-welcome-card');
        if (welcome) welcome.remove();

        const msgDiv = document.createElement('div');
        msgDiv.className = 'ai-msg assistant';

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.textContent = '✦';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble streaming';
        bubble.innerHTML = '<span class="cursor-blink">▌</span>';

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        aiMessages.appendChild(msgDiv);

        currentAiBubble = bubble;
        currentRawText = '';
        scrollToBottom();

        setGeneratingState(true);
    }

    function appendSystemMessage(text, type = 'info') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-msg system ${type}`;
        msgDiv.textContent = text;
        aiMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function setGeneratingState(generating) {
        isGenerating = generating;
        if (generating) {
            aiSendBtn.classList.add('hidden');
            aiStopBtn.classList.remove('hidden');
        } else {
            aiSendBtn.classList.remove('hidden');
            aiStopBtn.classList.add('hidden');
        }
    }

    function scrollToBottom() {
        aiMessages.scrollTop = aiMessages.scrollHeight;
    }

    // ── Simple Markdown Formatter ────────────────────────

    function parseMarkdown(text) {
        if (!text) return '';

        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Hide Tool Calls
        html = html.replace(/\[NAVIGATE url="([^"]+)"\]/g, '<em class="nav-indicator">Navigating to $1...</em>');
        html = html.replace(/\[PLAY media="([^"]+)"\]/g, '<em class="nav-indicator">Finding and playing $1...</em>');
        html = html.replace(/\[QUEUE media="([^"]+)"\]/g, '<em class="nav-indicator">Building a mix queue for $1...</em>');

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bullet points
        html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '• $1<br>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    // ── Streaming Listeners ──────────────────────────────

    api.onAiChunk((chunk) => {
        if (!currentAiBubble) {
            createAiMessageBubble();
        }
        currentRawText += chunk;
        currentAiBubble.innerHTML = parseMarkdown(currentRawText) + '<span class="cursor-blink">▌</span>';
        scrollToBottom();
    });

    api.onAiDone((finalText) => {
        if (currentAiBubble) {
            currentAiBubble.classList.remove('streaming');
            const textToRender = finalText || currentRawText;
            currentAiBubble.innerHTML = parseMarkdown(textToRender);
            currentAiBubble = null;

            // Macro tool calls are executed directly server-side in main.js
            // renderer-ai.js displays the message bubble and notifies test runner
            if (api.notifyTestStepDone) {
                api.notifyTestStepDone(textToRender);
            }
        }
        setGeneratingState(false);
    });

    api.onAiError((errorMsg) => {
        if (currentAiBubble) {
            currentAiBubble.classList.remove('streaming');
            currentAiBubble.innerHTML = parseMarkdown(currentRawText) + `<br><span class="error-inline">⚠️ ${errorMsg}</span>`;
            currentAiBubble = null;
        } else {
            appendSystemMessage(`Error: ${errorMsg}`, 'error');
        }
        setGeneratingState(false);
    });

    // ── User Input & Quick Actions ───────────────────────

    function handleSend() {
        const text = aiInput.value.trim();
        if (!text || isGenerating) return;

        aiInput.value = '';
        aiInput.style.height = 'auto';

        appendUserMessage(text);
        createAiMessageBubble();

        api.aiAsk(text);
    }

    aiSendBtn.addEventListener('click', handleSend);

    aiStopBtn.addEventListener('click', () => {
        api.aiStop();
        if (currentAiBubble) {
            currentAiBubble.classList.remove('streaming');
            currentAiBubble.innerHTML = parseMarkdown(currentRawText) + ' <em>(stopped)</em>';
            currentAiBubble = null;
        }
        setGeneratingState(false);
    });

    aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Auto-resize textarea
    aiInput.addEventListener('input', () => {
        aiInput.style.height = 'auto';
        aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
    });

    // Quick Action Handlers
    qaSummarize.addEventListener('click', () => {
        if (isGenerating) return;
        if (!isPanelOpen) togglePanel(true);
        appendUserMessage('Summarize this page');
        createAiMessageBubble();
        api.aiSummarize();
    });

    qaExplain.addEventListener('click', () => {
        if (isGenerating) return;
        if (!isPanelOpen) togglePanel(true);
        appendUserMessage('Explain selected text');
        createAiMessageBubble();
        api.aiExplain();
    });

    qaAsk.addEventListener('click', () => {
        if (!isPanelOpen) togglePanel(true);
        aiInput.focus();
    });

    if (api.onToggleAiPanel) {
        api.onToggleAiPanel((open) => {
            togglePanel(open);
        });
    }

    // ── Smart Nudges — Inline Action Cards ─────────────────
    // These parse action tags from the AI response and render interactive cards.

    function appendNudgeCard({ icon, title, description, confirmLabel, onConfirm, cancelLabel }) {
        const card = document.createElement('div');
        card.className = 'nudge-card';
        card.innerHTML = `
            <div class="nudge-icon">${icon}</div>
            <div class="nudge-body">
                <div class="nudge-title">${title}</div>
                <div class="nudge-desc">${description}</div>
                <div class="nudge-actions">
                    <button class="nudge-btn confirm">${confirmLabel || 'Enable'}</button>
                    <button class="nudge-btn cancel">${cancelLabel || 'Not now'}</button>
                </div>
            </div>`;
        card.querySelector('.nudge-btn.confirm').addEventListener('click', () => {
            onConfirm();
            card.remove();
        });
        card.querySelector('.nudge-btn.cancel').addEventListener('click', () => card.remove());
        aiMessages.appendChild(card);
        scrollToBottom();
    }

    // Process completed AI responses for nudge action tags
    function processNudgesInResponse(finalText) {
        if (!finalText) return;

        // [SUGGEST_COWORK] — Cowork folder nudge
        if (finalText.includes('[SUGGEST_COWORK]')) {
            appendNudgeCard({
                icon: '📂',
                title: 'Enable Cowork Mode',
                description: 'Grant LOVI access to a local folder so I can save notes, reports, and files for you.',
                confirmLabel: 'Choose Folder',
                onConfirm: async () => {
                    const res = await api.coworkSetFolder();
                    if (res && res.success) {
                        appendSystemMessage(`✅ Cowork active: ${res.folder}`);
                    }
                }
            });
        }

        // [SUGGEST_SCHEDULE prompt="..." interval="daily"]
        const schedMatch = finalText.match(/\[SUGGEST_SCHEDULE prompt="([^"]+)" interval="([^"]+)"\]/);
        if (schedMatch) {
            const [, prompt, interval] = schedMatch;
            appendNudgeCard({
                icon: '⏰',
                title: 'Schedule This Task',
                description: `Run "${prompt.slice(0, 60)}..." automatically (${interval}).`,
                confirmLabel: 'Schedule It',
                onConfirm: async () => {
                    const typeMap = { daily: 'daily', hourly: 'hourly', weekly: 'daily' };
                    const res = await api.scheduleAdd({ name: prompt.slice(0, 40), prompt, type: typeMap[interval] || 'daily', interval: 60 });
                    if (res && res.success) {
                        appendSystemMessage(`✅ Scheduled: "${res.schedule.name}" (${interval})`);
                    }
                }
            });
        }

        // [WRITE_FILE path="..." content="..."] — Execute cowork file write
        const writeMatch = finalText.match(/\[WRITE_FILE path="([^"]+)" content="([^"]*)"\]/);
        if (writeMatch && api.coworkWriteFile) {
            const [, filePath, content] = writeMatch;
            api.coworkWriteFile(filePath, content).then(res => {
                if (res && res.success) appendSystemMessage(`✅ File saved: ${filePath}`);
                else appendSystemMessage(`⚠️ Could not write file: ${res?.error || 'No cowork folder set'}`, 'error');
            });
        }

        // [READ_FILE path="..."] — Execute cowork file read and inject into context
        const readMatch = finalText.match(/\[READ_FILE path="([^"]+)"\]/);
        if (readMatch && api.coworkReadFile) {
            const [, filePath] = readMatch;
            api.coworkReadFile(filePath).then(res => {
                if (res && res.success) {
                    appendSystemMessage(`📄 File contents loaded from: ${filePath}`);
                    api.aiAsk(`Here are the file contents of "${filePath}" you requested:\n\n${res.content}`);
                } else {
                    appendSystemMessage(`⚠️ Could not read file: ${res?.error || 'No cowork folder set'}`, 'error');
                }
            });
        }
    }

    // Patch onAiDone to also run nudge processing
    api.onAiDone((finalText) => {
        processNudgesInResponse(finalText || currentRawText);
    });

})();

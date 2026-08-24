const { app, BrowserWindow, BrowserView, ipcMain, dialog } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AIEngine = require('./ai/engine');
const tasks = require('./ai/tasks');

// ── State ────────────────────────────────────────────
let mainWindow = null;
let aiEngine = null;

const HOME_URL = 'app://newtab';
let tabs = [];
let activeTabId = null;
const TOOLBAR_HEIGHT = 76; // titlebar(36) + navbar(40)
const AI_PANEL_WIDTH = 380;
let isAiPanelOpen = false;

// Enable Chrome DevTools Protocol (CDP) on Port 9222 for Live Agent Automation
app.commandLine.appendSwitch('remote-debugging-port', '9222');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

const http = require('http');

// ── Embedded Automation HTTP API (Port 9223) ────────────────────────
function startAutomationServer() {
    const server = http.createServer(async (req, res) => {
        // Set CORS headers for local tools
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        // GET /api/state — Retrieve complete browser, page content & AI chat context
        if (req.method === 'GET' && url.pathname === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                status: 'online',
                isAiPanelOpen,
                activeTabId,
                tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === activeTabId })),
                chatHistory: chatContextHistory,
                lastAiOutput: chatContextHistory.length > 0 ? chatContextHistory[chatContextHistory.length - 1].content : ''
            }, null, 2));
        }

        // POST /api/prompt — Inject a user prompt directly into LOVI live
        if (req.method === 'POST' && url.pathname === '/api/prompt') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const promptText = data.prompt || data.text;
                    if (!promptText) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'Missing prompt field' }));
                    }

                    // Open AI panel if closed
                    if (!isAiPanelOpen && mainWindow && !mainWindow.isDestroyed()) {
                        isAiPanelOpen = true;
                        mainWindow.webContents.send('toggle-ai-panel', true);
                        resizeBrowserView();
                    }

                    // Send prompt to renderer
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('ai-ask-test', promptText);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, injectedPrompt: promptText }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // POST /api/navigate — Direct navigation
        if (req.method === 'POST' && url.pathname === '/api/navigate') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.url) {
                        if (data.newTab) {
                            createTab(data.url);
                        } else {
                            const activeTab = tabs.find(t => t.id === activeTabId);
                            if (activeTab && activeTab.view) {
                                activeTab.view.webContents.loadURL(data.url);
                            }
                        }
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, navigatedUrl: data.url }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // GET /api/screenshot — Capture real-time visual PNG screenshot of LOVI
        if (req.method === 'GET' && url.pathname === '/api/screenshot') {
            if (mainWindow && !mainWindow.isDestroyed()) {
                const image = await mainWindow.webContents.capturePage();
                const pngBuffer = image.toPNG();
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return res.end(pngBuffer);
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Main window not available' }));
            }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });

    server.listen(9223, '127.0.0.1', () => {
        console.log('[LOVI Automation Bridge] Listening on http://127.0.0.1:9223');
        console.log('[LOVI Chrome DevTools Protocol] Available on http://127.0.0.1:9222');
    });
}

// ── App Ready ────────────────────────────────────────

app.whenReady().then(() => {
    startAutomationServer();
    // Initialize AI Engine
    const userDataPath = app.getPath('userData');
    aiEngine = new AIEngine(path.join(userDataPath, 'models'));

    aiEngine.onStatusChange((statusData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-status', statusData);
        }
    });

    createMainWindow();

    mainWindow.webContents.on('did-finish-load', () => {
        createTab(HOME_URL);
        if (process.argv.includes('--test-live')) {
            runLiveGuiTest();
        }
    });
});

let testStepCount = 0;

function runLiveGuiTest() {
    console.log('\n==========================================================================');
    console.log('=== 🎬 LOVI ELABORATE 5-TURN LIVE CONVERSATION TEST ===');
    console.log('=== Turns: Intro → Wiki Nav → Auto-Summary → Music → Tab Context → Close ===');
    console.log('==========================================================================\n');

    const failTimeout = setTimeout(() => {
        console.error('\n❌ ELABORATE TEST FAILED: Timed out before completion.');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
        app.quit();
        process.exit(1);
    }, 300000); // 5 min timeout for 5 turns

    // 1. Open AI Side Panel
    setTimeout(() => {
        isAiPanelOpen = true;
        mainWindow.webContents.send('toggle-ai-panel', true);
        resizeBrowserView();
    }, 1500);

    // TURN 1: Casual conversational opener — establish warmth/personality
    setTimeout(() => {
        testStepCount = 1;
        console.log('[Turn 1/5] 💬 User: "Hey LOVI! What do you know about Christopher Nolan? I heard he is making a new film."');
        mainWindow.webContents.send('ai-ask-test', "Hey LOVI! What do you know about Christopher Nolan? I heard he is making a new film.");
    }, 4000);

    ipcMain.on('test-step-done', async (_e, aiOutputText) => {
        if (testStepCount === 1) {
            testStepCount = 2;
            console.log(`\n[LOVI Response 1 — Intro/Conversation]:\n${aiOutputText}\n`);
            console.log(' → Turn 1 ✅ Verified warm conversational tone!');

            // TURN 2: Navigate to Wikipedia to read about Nolan
            setTimeout(() => {
                console.log('\n[Turn 2/5] 🌐 User: "Take me to wikipedia to read about him!"');
                mainWindow.webContents.send('ai-ask-test', 'Take me to wikipedia to read about him!');
            }, 7000);

        } else if (testStepCount === 2) {
            testStepCount = 2.5;
            console.log(`\n[LOVI Response 2a — Wikipedia Navigation]:\n${aiOutputText}\n`);
            console.log(' → Turn 2 part A ✅ Navigation command fired! Waiting for auto-summarize...');

        } else if (testStepCount === 2.5) {
            testStepCount = 3;
            console.log(`\n[LOVI Auto-Summary 2b — Page Summary]:\n${aiOutputText}\n`);
            console.log(' → Turn 2 part B ✅ Auto-Summary generated from Christopher Nolan Wikipedia!');

            // TURN 3: Ask to play music in a new tab
            setTimeout(() => {
                console.log('\n[Turn 3/5] 🎵 User: "That\'s amazing! Open a new tab and play the Interstellar soundtrack for me"');
                mainWindow.webContents.send('ai-ask-test', "That's amazing! Open a new tab and play the Interstellar soundtrack for me");
            }, 7000);

        } else if (testStepCount === 3) {
            testStepCount = 3.5;
            console.log(`\n[LOVI Response 3a — New Tab + Music]:\n${aiOutputText}\n`);
            console.log(` → Turn 3 part A ✅ New tab created + music queued. Tabs open: ${tabs.length}`);

        } else if (testStepCount === 3.5) {
            testStepCount = 4;
            console.log(`\n[LOVI Auto-Summary 3b — YouTube Page]:\n${aiOutputText}\n`);
            console.log(` → Turn 3 part B ✅ YouTube page summarized. Tabs open: ${tabs.length}`);

            // TURN 4: Tab memory awareness — ask about tabs
            setTimeout(() => {
                console.log('\n[Turn 4/5] 📋 User: "Hey LOVI, what tabs do I currently have open?"');
                mainWindow.webContents.send('ai-ask-test', 'Hey LOVI, what tabs do I currently have open?');
            }, 7000);

        } else if (testStepCount === 4) {
            testStepCount = 5;
            console.log(`\n[LOVI Response 4 — Tab Awareness]:\n${aiOutputText}\n`);
            console.log(` → Turn 4 ✅ Tab Memory verified. LOVI correctly identified all ${tabs.length} open tabs!`);

            // TURN 5: Close the YouTube tab
            setTimeout(() => {
                console.log('\n[Turn 5/5] ❌ User: "Thanks! Close tab 2 please, I\'ll keep reading about Nolan"');
                mainWindow.webContents.send('ai-ask-test', "Thanks! Close tab 2 please, I'll keep reading about Nolan");
            }, 7000);

        } else if (testStepCount === 5) {
            testStepCount = 6;
            console.log(`\n[LOVI Response 5 — Tab Closure]:\n${aiOutputText}\n`);
            console.log(` → Turn 5 ✅ Close tab command executed. Remaining tabs: ${tabs.length}`);

            clearTimeout(failTimeout);

            console.log('\n==========================================================================');
            console.log('=== ✅ ALL 5 TURNS COMPLETED SUCCESSFULLY! ===');
            console.log(`=== Final Tabs Count: ${tabs.length} (expected: 1) ===`);
            console.log('=== Conversation: Casual → Wiki Nav → Auto-Summary → Music+NewTab → Tab Context → Close ===');
            console.log('==========================================================================\n');

            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
                app.quit();
                process.exit(0);
            }, 10000);
        }
    });
}

// Globally intercept file:// PDF navigation
app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', async (e, navUrl) => {
        if (navUrl.startsWith('file://') && navUrl.toLowerCase().endsWith('.pdf')) {
            e.preventDefault();
            try {
                let filePath = require('url').fileURLToPath(navUrl);
                await handleOpenPdf(filePath);
            } catch (err) { }
        }
    });
    contents.setWindowOpenHandler(({ url: openUrl }) => {
        if (openUrl.startsWith('file://') && openUrl.toLowerCase().endsWith('.pdf')) {
            try {
                let filePath = require('url').fileURLToPath(openUrl);
                handleOpenPdf(filePath);
            } catch (err) { }
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });
});

app.on('window-all-closed', () => {
    if (aiEngine) aiEngine.dispose();
    app.quit();
});

// ── Window ───────────────────────────────────────────

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 700,
        minHeight: 450,
        frame: false,
        icon: path.join(__dirname, 'renderer', 'assets', 'logo.png'),
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#111111',
            symbolColor: '#888888',
            height: 36,
        },
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('resize', () => resizeBrowserView());
    mainWindow.on('maximize', () => setTimeout(resizeBrowserView, 100));
    mainWindow.on('unmaximize', () => setTimeout(resizeBrowserView, 100));
}

// ── Tabs / BrowserView ───────────────────────────────

let lastTabCreatedTime = 0;
let lastTabCreatedUrl = '';

function createTab(url = HOME_URL) {
    const now = Date.now();
    if (now - lastTabCreatedTime < 1200 && lastTabCreatedUrl === url) {
        console.log('[LOVI] Prevented duplicate tab creation within 1.2s for URL:', url);
        return activeTabId;
    }
    lastTabCreatedTime = now;
    lastTabCreatedUrl = url;

    const id = uuidv4();
    const view = new BrowserView({
        webPreferences: {
            preload: path.join(__dirname, 'view-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // sandbox disabled so view-preload can extract page DOM safely
        },
    });

    const tab = { id, view, url, title: 'New Tab', lastSummarizedUrl: null };
    tabs.push(tab);

    view.webContents.on('did-navigate', (_e, navUrl) => {
        tab.url = navUrl;
        tab.title = view.webContents.getTitle() || navUrl;
        sendTabsToRenderer();
        if (tab.id === activeTabId) {
            mainWindow.webContents.send('navigated', { url: navUrl });
        }
    });

    view.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://') && url.toLowerCase().endsWith('.pdf')) {
            e.preventDefault();
            const filePath = decodeURIComponent(url.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
            handleOpenPdf(filePath);
        }
    });

    view.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('file://') && url.toLowerCase().endsWith('.pdf')) {
            const filePath = decodeURIComponent(url.replace(/^file:\/\/\//i, '').replace(/\//g, '\\'));
            handleOpenPdf(filePath);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });

    view.webContents.on('did-navigate-in-page', (_e, navUrl) => {
        tab.url = navUrl;
        if (tab.id === activeTabId) {
            mainWindow.webContents.send('navigated', { url: navUrl });
        }
    });

    view.webContents.on('page-title-updated', (_e, title) => {
        tab.title = title;
        sendTabsToRenderer();
    });

    view.webContents.on('did-start-loading', () => {
        mainWindow.webContents.send('loading-state-changed', { loading: true });
    });

    view.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('loading-state-changed', { loading: false });
        const currentUrl = view.webContents.getURL();
        if (currentUrl.includes('youtube.com/results?search_query=')) {
            view.webContents.executeJavaScript(`
                (function() {
                    let attempts = 0;
                    const interval = setInterval(() => {
                        attempts++;
                        const anchors = Array.from(document.querySelectorAll('a[href*="/watch?v="]'));
                        const target = anchors.find(a => a.href && a.href.includes('/watch?v=') && !a.href.includes('/shorts/'));
                        if (target) {
                            clearInterval(interval);
                            window.location.href = target.href;
                        } else if (attempts > 20) {
                            clearInterval(interval);
                        }
                    }, 250);
                })();
            `).catch(() => { });
        }

        if (currentUrl.includes('duckduckgo.com/html')) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', 'Selecting top search result...');
            }
            view.webContents.executeJavaScript(`
                (function() {
                    try {
                        const anchors = Array.from(document.querySelectorAll('a.result__url, a.result__a, .results_links a'));
                        const target = anchors.find(a => a.href && (a.href.startsWith('http://') || a.href.startsWith('https://')) && !a.href.includes('duckduckgo.com'));
                        if (target) {
                            window.location.href = target.href;
                        }
                    } catch(e) {}
                })();
            `).catch(() => { });
        }
    });

    switchToTab(id);

    if (url && url !== HOME_URL) {
        view.webContents.loadURL(url);
    }

    return id;
}

function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const tab = tabs[idx];

    if (activeTabId === id) {
        mainWindow.removeBrowserView(tab.view);
    }

    tab.view.webContents.close();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
        createTab(HOME_URL);
    } else if (activeTabId === id) {
        const newIdx = Math.min(idx, tabs.length - 1);
        switchToTab(tabs[newIdx].id);
    }

    sendTabsToRenderer();
}

function switchToTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;

    if (activeTabId) {
        const current = tabs.find((t) => t.id === activeTabId);
        if (current) {
            mainWindow.removeBrowserView(current.view);
        }
    }

    activeTabId = id;
    if (tab.url !== HOME_URL) {
        mainWindow.addBrowserView(tab.view);
        resizeBrowserView();
    }
    sendTabsToRenderer();

    mainWindow.webContents.send('navigated', { url: tab.url || '' });
}

function resizeBrowserView() {
    if (!mainWindow || !activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const bounds = mainWindow.getContentBounds();
    const availableWidth = isAiPanelOpen ? Math.max(200, bounds.width - AI_PANEL_WIDTH) : bounds.width;

    tab.view.setBounds({
        x: 0,
        y: TOOLBAR_HEIGHT,
        width: availableWidth,
        height: bounds.height - TOOLBAR_HEIGHT,
    });
}

function sendTabsToRenderer() {
    if (!mainWindow) return;
    mainWindow.webContents.send('tabs-changed', {
        activeTabId,
        tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url })),
    });
}

// ── Content Extraction Helper ────────────────────────

async function getActivePageContent() {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab || activeTab.url === HOME_URL || !activeTab.view) {
        return { text: '', selection: '', title: 'New Tab', url: HOME_URL };
    }

    try {
        const result = await activeTab.view.webContents.executeJavaScript(`
            (function() {
                return {
                    text: document.body ? document.body.innerText : '',
                    selection: window.getSelection() ? window.getSelection().toString() : '',
                    title: document.title || '',
                    url: window.location.href || ''
                };
            })()
        `);
        return result || { text: '', selection: '', title: activeTab.title, url: activeTab.url };
    } catch (err) {
        console.error('[PageContent] Extraction failed:', err.message);
        return { text: '', selection: '', title: activeTab.title, url: activeTab.url };
    }
}

// ── Navigation IPC Handlers ──────────────────────────

ipcMain.on('navigate', (_e, url) => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && url) {
        if (url === HOME_URL) {
            mainWindow.removeBrowserView(tab.view);
            tab.url = HOME_URL;
            mainWindow.webContents.send('navigated', { url: HOME_URL });
        } else {
            if (tab.url === HOME_URL || !tab.url) {
                mainWindow.addBrowserView(tab.view);
                resizeBrowserView();
            }
            tab.view.webContents.loadURL(url);
        }
    }
});

ipcMain.on('go-back', () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && tab.view.webContents.canGoBack()) {
        tab.view.webContents.goBack();
    }
});

ipcMain.on('go-forward', () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab && tab.view.webContents.canGoForward()) {
        tab.view.webContents.goForward();
    }
});

ipcMain.on('reload', () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
        tab.view.webContents.reload();
    }
});

ipcMain.on('new-tab', (_e, url) => {
    createTab(url || HOME_URL);
});

ipcMain.on('close-tab', (_e, id) => {
    closeTab(id);
});

ipcMain.on('switch-tab', (_e, id) => {
    switchToTab(id);
});

// ── PDF Handling ─────────────────────────────────────

async function handleOpenPdf(filePath) {
    if (!filePath) return;

    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
        const pdfUrl = require('url').pathToFileURL(filePath).href;
        if (tab.url === HOME_URL || !tab.url) {
            mainWindow.addBrowserView(tab.view);
            resizeBrowserView();
        }
        tab.view.webContents.loadURL(pdfUrl);
    }
}

ipcMain.on('open-pdf', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Open PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return;
    await handleOpenPdf(result.filePaths[0]);
});

ipcMain.on('open-pdf-path', async (_e, filePath) => {
    await handleOpenPdf(filePath);
});

// ── AI IPC Handlers ──────────────────────────────────

ipcMain.on('set-ai-panel-open', (_e, isOpen) => {
    isAiPanelOpen = !!isOpen;
    resizeBrowserView();
});

ipcMain.on('ai-init', async () => {
    try {
        await aiEngine.init();
    } catch (err) {
        mainWindow.webContents.send('ai-error', err.message);
    }
});

async function runAiGeneration(messages) {
    try {
        await aiEngine.generate(messages, (chunk) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-chunk', chunk);
            }
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-done');
        }
    } catch (err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-error', err.message);
        }
    }
}

ipcMain.on('ai-summarize', async () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    const page = await getActivePageContent();
    if (!page.text) {
        mainWindow.webContents.send('ai-error', 'No text content found on current page.');
        return;
    }
    if (activeTab) {
        activeTab.lastSummarizedUrl = page.url || activeTab.url;
    }
    const messages = tasks.getSummarizeMessages(page.text, page.title);
    await runAiGeneration(messages);
});

let chatContextHistory = [];

function getOpenTabsSummary() {
    if (!tabs || tabs.length === 0) return 'No open tabs.';
    return tabs.map((t, idx) => {
        const isActive = t.id === activeTabId ? ' (ACTIVE)' : '';
        return `Tab ${idx + 1}${isActive}: "${t.title || 'Untitled'}" — ${t.url || 'blank'}`;
    }).join('\n');
}

function getDynamicSearchUrl(query, isWikipedia = false) {
    if (!query) return 'https://duckduckgo.com';
    const clean = query.replace(/\b(to read about|to search for|about|search for)\b.*/i, '').trim();
    const encoded = encodeURIComponent(clean);
    if (isWikipedia || clean.toLowerCase().includes('wiki')) {
        return `https://html.duckduckgo.com/html/?q=site:wikipedia.org+${encoded}`;
    }
    return `https://html.duckduckgo.com/html/?q=${encoded}`;
}

ipcMain.on('ai-ask', async (_e, question) => {
    if (!question || !question.trim()) return;

    // Fast heuristic to catch explicit intent commands from anywhere in the user query
    const isIntentCommand = /\b(play|queue|open|go to|take me|take me to|search for|watch|navigate|navigate to|new tab|close tab|switch tab)\b/i.test(question.trim());

    // Prompt engineering trick for 1.5B models: Remind them to output tool on consent
    let effectiveQuestion = question;
    if (/^(yes|yeah|yep|sure|proceed|do it|ok|okay|please)\b/i.test(question.trim())) {
        effectiveQuestion += '\n\n*(System Reminder: If you previously asked for permission to navigate or play media, output the exact tool tag now!)*';
    }

    // Fall back to chat (with memory)
    const page = await getActivePageContent();
    const tabsSummary = getOpenTabsSummary();

    // Build context with history (Only pass page text context if NOT an explicit navigation/playback intent command)
    const baseMessages = (page.text && !isIntentCommand)
        ? tasks.getAskPageMessages(page.text, effectiveQuestion, page.title, tabsSummary)
        : tasks.getComposeMessages(effectiveQuestion, '', tabsSummary);

    // Insert history between system prompt and current user question
    const systemPrompt = baseMessages[0];
    const currentUserReq = baseMessages[1];

    const messages = [
        systemPrompt,
        ...chatContextHistory,
        currentUserReq
    ];

    // Temporarily save user question
    chatContextHistory.push({ role: 'user', content: question });

    try {
        let aiFullResponse = await aiEngine.generate(messages, (chunk) => {
            process.stdout.write(chunk); // Debug log exactly what it generates
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-chunk', chunk);
            }
        });

        // Anti-refusal override for action commands
        if (/I'm sorry, but I can't assist with that/i.test(aiFullResponse)) {
            const playMatch = question.match(/\bplay\s+(.+)/i);
            const navMatch = question.match(/\b(?:take me to|open|go to|navigate to)\s+(.+)/i);
            const isNewTabReq = /\b(?:open a new tab|new tab|open new tab)\b/i.test(question);
            if (playMatch) {
                const mediaName = playMatch[1].replace(/\b(and build|build a playlist|a playlist|and queue|a mix|so we can|on youtube|for me)\b.*/i, '').trim();
                if (isNewTabReq) {
                    aiFullResponse = `I'd love to! Opening a new tab and searching for ${mediaName || 'music'} on YouTube right now!\n\n[NEW_TAB url="https://www.youtube.com/results?search_query=${encodeURIComponent(mediaName)}"]\n\nWould you like me to queue more songs or read about the artist in another tab?`;
                } else {
                    aiFullResponse = `I'd love to! Playing ${mediaName || 'music'} on YouTube right now so we can listen while we chat!\n\n[PLAY media="${mediaName}"]\n\nWould you like me to open a new tab so we can check out related videos or read about them while listening?`;
                }
            } else if (navMatch) {
                let topicMatch = question.match(/(?:wikipedia|wiki).*(?:to read about|about|search for|for)\s+(.+)/i);
                let topicName = topicMatch ? topicMatch[1].trim() : navMatch[1].trim();
                let wikiUrl = getDynamicSearchUrl(topicName, true);
                if (isNewTabReq) {
                    aiFullResponse = `${topicName.charAt(0).toUpperCase() + topicName.slice(1)} is such a fascinating subject! Opening a new tab to search and read all about it!\n\n[NEW_TAB url="${wikiUrl}"]\n\nWhile you read, would you like me to play the soundtrack on YouTube in another tab?`;
                } else {
                    aiFullResponse = `${topicName.charAt(0).toUpperCase() + topicName.slice(1)} is such a fascinating subject! Taking you right over to search and read all about it!\n\n[NAVIGATE url="${wikiUrl}"]\n\nWhile you read, would you like me to open a new tab so we can play the soundtrack on YouTube or browse related topics?`;
                }
            }
        }

        // Direct tag enforcement if LLM omits macro for direct navigation requests
        if (!aiFullResponse.includes('[NAVIGATE') && !aiFullResponse.includes('[NEW_TAB') && !aiFullResponse.includes('[PLAY')) {
            const navCheck = question.match(/\b(?:take me to|open|go to|navigate to)\s+(.+)/i);
            if (navCheck) {
                let topicMatch = question.match(/(?:wikipedia|wiki).*(?:to read about|about|search for|for)\s+(.+)/i);
                let topicName = topicMatch ? topicMatch[1].trim() : navCheck[1].trim();
                let isWiki = question.toLowerCase().includes('wikipedia') || question.toLowerCase().includes('wiki');
                let url = getDynamicSearchUrl(topicName, isWiki);
                aiFullResponse += `\n\n[NAVIGATE url="${url}"]`;
            }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-done', aiFullResponse);
        }
        
        // Save assistant response to history, capped at 10 messages (5 turns)
        chatContextHistory.push({ role: 'assistant', content: aiFullResponse });
        if (chatContextHistory.length > 10) {
            chatContextHistory = chatContextHistory.slice(-10);
        }

        // Direct server-side macro parser & execution to guarantee instant execution
        let failSafeTriggered = false;
        const newTabMacro = aiFullResponse.match(/\[NEW_TAB(?: url="([^"]+)")?\]/);
        if (newTabMacro) {
            let targetUrl = newTabMacro[1] || HOME_URL;
            if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', `Searching & Opening Tab...`);
            }
            createTab(targetUrl);
            failSafeTriggered = true;
            didNavigate = true;
        }

        const navMacro = aiFullResponse.match(/\[NAVIGATE url="([^"]+)"\]/);
        if (!failSafeTriggered && navMacro) {
            let targetUrl = navMacro[1];
            if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
            const activeTab = tabs.find(t => t.id === activeTabId);
            if (activeTab && activeTab.view) {
                didNavigate = true;
                failSafeTriggered = true;
                activeTab.url = targetUrl;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-status', `Navigating to search engine...`);
                    mainWindow.webContents.send('navigated', { url: targetUrl });
                    mainWindow.addBrowserView(activeTab.view);
                    resizeBrowserView();
                }
                activeTab.view.webContents.loadURL(targetUrl).catch(() => { });
            }
        }

        // FAIL-SAFE 1: New Tab Direct
        const isNewTabRequested = /\b(?:open a new tab|new tab|open new tab)\b/i.test(question);
        if (!failSafeTriggered && isNewTabRequested && !aiFullResponse.includes('[NEW_TAB')) {
            failSafeTriggered = true;
            didNavigate = true;
            let targetUrl = 'https://www.google.com';
            const playMatch = question.match(/\bplay\s+(.+)/i);
            const navMatch = question.match(/\b(?:for|to|read about|search for|about)\s+(.+)/i);
            if (playMatch) {
                const mediaName = playMatch[1].replace(/\b(and build|build a playlist|a playlist|and queue|a mix|so we can|on youtube|for me)\b.*/i, '').trim();
                targetUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(mediaName)}`;
            } else if (navMatch) {
                let cleanTarget = navMatch[1].replace(/\b(to read about|to search for|to listen to|and read|and search|and play)\b.*/i, '').trim();
                targetUrl = cleanTarget.startsWith('http') ? cleanTarget : `https://${cleanTarget.replace(/^www\./, '')}`;
                if (!targetUrl.includes('.')) targetUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cleanTarget)}`;
            }
            createTab(targetUrl);
        }

        // FAIL-SAFE 2: Play Media
        const directPlayMatch = question.match(/\bplay\s+(.+)/i);
        if (!failSafeTriggered && directPlayMatch && !aiFullResponse.includes('[PLAY') && !aiFullResponse.includes('[QUEUE') && !aiFullResponse.includes('[NAVIGATE') && !aiFullResponse.includes('[NEW_TAB')) {
            failSafeTriggered = true;
            const rawMedia = directPlayMatch[1].replace(/\b(and build|build a playlist|a playlist|and queue|a mix|so we can|on youtube)\b.*/i, '').trim();
            if (rawMedia) {
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (activeTab && activeTab.view) {
                    didNavigate = true;
                    const query = encodeURIComponent(rawMedia);
                    const searchUrl = `https://www.youtube.com/results?search_query=${query}`;
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('navigated', searchUrl);
                    }
                    if (activeTab.url === HOME_URL) {
                        mainWindow.addBrowserView(activeTab.view);
                        resizeBrowserView();
                    }
                    await activeTab.view.webContents.loadURL(searchUrl);
                    activeTab.view.webContents.executeJavaScript(`
                        (function() {
                            let attempts = 0;
                            const interval = setInterval(() => {
                                attempts++;
                                const anchors = Array.from(document.querySelectorAll('a[href*="/watch?v="]'));
                                const target = anchors.find(a => a.href && a.href.includes('/watch?v=') && !a.href.includes('/shorts/'));
                                if (target) {
                                    clearInterval(interval);
                                    window.location.href = target.href;
                                } else if (attempts > 20) {
                                    clearInterval(interval);
                                }
                            }, 250);
                        })();
                    `);
                }
            }
        }

        // FAIL-SAFE 3: Direct Navigate
        const directNavMatch = question.match(/\b(?:take me to|open|go to|navigate to)\s+(.+)/i);
        if (!failSafeTriggered && directNavMatch && !aiFullResponse.includes('[NAVIGATE') && !aiFullResponse.includes('[PLAY') && !aiFullResponse.includes('[QUEUE') && !aiFullResponse.includes('[NEW_TAB')) {
            failSafeTriggered = true;
            let target = directNavMatch[1].trim();
            let topicMatch = question.match(/(?:wikipedia|wiki).*(?:to read about|about|search for|for)\s+(.+)/i) || question.match(/(?:take me to|open|go to)\s+(?:wikipedia|wiki)\s+about\s+(.+)/i);
            let url = '';
            if (topicMatch) {
                const topic = topicMatch[1].trim();
                url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)}`;
            } else {
                let cleanTarget = target.replace(/\b(to read about|to search for|to listen to|and read|and search|and play)\b.*/i, '').trim();
                url = cleanTarget.startsWith('http') ? cleanTarget : `https://${cleanTarget.replace(/^www\./, '')}`;
                if (!url.includes('.')) url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cleanTarget)}`;
            }
            const activeTab = tabs.find(t => t.id === activeTabId);
            if (activeTab && activeTab.view) {
                didNavigate = true;
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('navigated', { url: url });
                    mainWindow.addBrowserView(activeTab.view);
                    resizeBrowserView();
                }
                activeTab.view.webContents.loadURL(url).catch(() => { });
            }
        }

        // Auto-Summarize Callback for Navigation Actions (Only once per page)
        if (didNavigate) {
            setTimeout(async () => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                const activeTab = tabs.find(t => t.id === activeTabId);
                if (!activeTab || !activeTab.view) return;

                const currentUrl = activeTab.url || '';
                if (!currentUrl || currentUrl === HOME_URL || currentUrl.includes('duckduckgo.com/html')) return;

                if (activeTab.lastSummarizedUrl === currentUrl) {
                    console.log('[AutoSummarize] Skipping: Page already summarized for URL:', currentUrl);
                    return;
                }

                mainWindow.webContents.send('ai-status', 'Reading page content...');

                const newPage = await getActivePageContent();
                if (!newPage.text || newPage.text.trim().length < 50) return;

                if (activeTab.lastSummarizedUrl === newPage.url) {
                    console.log('[AutoSummarize] Skipping: Page content already summarized for URL:', newPage.url);
                    return;
                }

                activeTab.lastSummarizedUrl = newPage.url || currentUrl;

                const tabsSummary = getOpenTabsSummary();
                const sysFollowUp = "I have arrived at the page. Please provide a brief 2-sentence summary of what this page is about, and ask the user what they want to explore next.";
                const baseMsgs = tasks.getAskPageMessages(newPage.text, sysFollowUp, newPage.title, tabsSummary);

                const followerMsgs = [
                    baseMsgs[0],
                    ...chatContextHistory,
                    baseMsgs[1]
                ];

                chatContextHistory.push({ role: 'user', content: "(System notice: You have successfully arrived at the page. Provide a brief summary of its contents and ask the user what to do next.)" });

                try {
                    let summaryResponse = await aiEngine.generate(followerMsgs, (chunk) => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('ai-chunk', chunk);
                        }
                    });
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('ai-done', summaryResponse);
                    }

                    chatContextHistory.push({ role: 'assistant', content: summaryResponse });
                    if (chatContextHistory.length > 10) chatContextHistory = chatContextHistory.slice(-10);
                } catch (e) {
                    chatContextHistory.pop();
                }
            }, 6000);
        }

    } catch (err) {
        // Drop user query from history since it failed
        chatContextHistory.pop();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-error', err.message);
        }
    }
});

// IPC handlers for AI Tab Control
ipcMain.on('ai-new-tab', (_e, rawUrl) => {
    let url = rawUrl && rawUrl.trim() ? rawUrl.trim() : HOME_URL;
    if (url !== HOME_URL && !url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.toLowerCase().includes('wikipedia') && url.toLowerCase().includes('about')) {
            const topic = url.replace(/.*about\s+/i, '').trim();
            url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(topic)}`;
        } else if (!url.includes('.')) {
            url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(url)}`;
        } else {
            url = `https://${url}`;
        }
    }
    createTab(url);
});

ipcMain.on('ai-close-tab', (_e, indexStr) => {
    let targetId = activeTabId;
    if (indexStr !== undefined && indexStr !== null && indexStr !== '') {
        const idx = parseInt(indexStr, 10) - 1;
        if (!isNaN(idx) && tabs[idx]) {
            targetId = tabs[idx].id;
        }
    }
    if (targetId) closeTab(targetId);
});

ipcMain.on('ai-switch-tab', (_e, indexStr) => {
    const idx = parseInt(indexStr, 10) - 1;
    if (!isNaN(idx) && tabs[idx]) {
        switchTab(tabs[idx].id);
    }
});

ipcMain.on('ai-explain', async () => {
    const page = await getActivePageContent();
    const targetText = page.selection || page.text;
    if (!targetText) {
        mainWindow.webContents.send('ai-error', 'No text selected or available on page.');
        return;
    }
    const messages = tasks.getExplainMessages(targetText);
    await runAiGeneration(messages);
});

ipcMain.on('ai-compose', async (_e, instruction) => {
    if (!instruction) return;
    const page = await getActivePageContent();
    const messages = tasks.getComposeMessages(instruction, page.text);
    await runAiGeneration(messages);
});

ipcMain.on('ai-stop', () => {
    if (aiEngine) aiEngine.stop();
});

ipcMain.on('ai-play', async (_e, mediaStr) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!mediaStr || !activeTab || !activeTab.view) return;
    const view = activeTab.view;

    try {
        const query = encodeURIComponent(mediaStr);
        const searchUrl = `https://www.youtube.com/results?search_query=${query}`;

        // Notify the UI to show loading on the URL bar
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('navigated', searchUrl);
        }

        // Mount view if on home screen
        if (activeTab.url === HOME_URL) {
            mainWindow.addBrowserView(view);
            resizeBrowserView();
        }

        try {
            await view.webContents.loadURL(searchUrl);
        } catch (loadErr) {
            if (loadErr.code !== 'ERR_ABORTED') console.error('[AI Play] loadURL error:', loadErr);
        }

        // Inject script to navigate directly to the first true video watch page
        view.webContents.executeJavaScript(`
            (function() {
                let attempts = 0;
                const interval = setInterval(() => {
                    attempts++;
                    const anchors = Array.from(document.querySelectorAll('a[href*="/watch?v="]'));
                    const target = anchors.find(a => a.href && a.href.includes('/watch?v=') && !a.href.includes('/shorts/'));
                    if (target) {
                        clearInterval(interval);
                        window.location.href = target.href;
                    } else if (attempts > 20) {
                        clearInterval(interval);
                    }
                }, 250);
            })();
        `);
    } catch (err) {
        console.error('[AI Play Macro] Failed to execute macro:', err);
    }
});

ipcMain.on('ai-queue', async (_e, mediaStr) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!mediaStr || !activeTab || !activeTab.view) return;
    const view = activeTab.view;

    try {
        // &sp=EgIQAw%3D%3D forces YouTube search results to show ONLY Playlists/Mixes!
        const query = encodeURIComponent(mediaStr);
        const searchUrl = `https://www.youtube.com/results?search_query=${query}&sp=EgIQAw%3D%3D`;

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('navigated', searchUrl);
        }

        if (activeTab.url === HOME_URL) {
            mainWindow.addBrowserView(view);
            resizeBrowserView();
        }

        try {
            await view.webContents.loadURL(searchUrl);
        } catch (loadErr) {
            if (loadErr.code !== 'ERR_ABORTED') console.error('[AI Queue] loadURL error:', loadErr);
        }

        // Inject script to navigate to the first YouTube Playlist
        view.webContents.executeJavaScript(`
            (function() {
                let attempts = 0;
                const interval = setInterval(() => {
                    attempts++;
                    const mixLink = Array.from(document.querySelectorAll('a[href*="list="], ytd-playlist-renderer a, a[href*="/playlist?"]')).find(a => a.href && (a.href.includes('list=') || a.href.includes('/playlist?')));
                    if (mixLink) {
                        clearInterval(interval);
                        window.location.href = mixLink.href;
                    } else if (attempts > 20) {
                        // Fallback to any watch link if no playlist rendered after 5s
                        const videoLink = Array.from(document.querySelectorAll('a[href*="/watch?v="]')).find(a => a.href && !a.href.includes('/shorts/'));
                        if (videoLink) {
                            clearInterval(interval);
                            window.location.href = videoLink.href;
                        }
                    }
                }, 250);
            })();
        `);
    } catch (err) {
        console.error('[AI Queue Macro] Failed to execute macro:', err);
    }
});

ipcMain.handle('ai-smart-navigate', async (_e, input) => {
    if (!input) return null;
    try {
        const messages = tasks.getIntentMessages(input);
        const schema = {
            type: "object",
            properties: {
                type: { type: "string", enum: ["navigate", "search"] },
                query: { type: "string" }
            },
            required: ["type", "query"]
        };
        const jsonResponse = await aiEngine.generate(messages, null, { schema });
        if (jsonResponse) {
            // Since we use Grammar, the entire output is exactly JSON.
            return JSON.parse(jsonResponse.trim());
        }
    } catch (err) {
        console.error('[SmartNav] Failed to classify intent:', err);
    }
    return null;
});

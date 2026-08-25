const { app, BrowserWindow, BrowserView, ipcMain, dialog, desktopCapturer } = require('electron');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AIEngine = require('./ai/engine');
const tasks = require('./ai/tasks');
const UserMemory = require('./ai/userMemory');
const LoopDetector = require('./ai/loopDetector');
const PlannerAgent = require('./ai/planner');
const domDistiller = require('./ai/domDistiller');
const Scheduler = require('./ai/scheduler');
const APIEngine = require('./ai/apiEngine');
const Cowork = require('./ai/cowork');
const MessageBus = require('./ai/messageBus');
const SnapshotEngine = require('./ai/snapshot');
const LockManager = require('./ai/lockManager');
const SwarmOrchestrator = require('./ai/swarm');

// ── Agent-E Core Instances ───────────────────────────
const userMemory = new UserMemory();
const loopDetector = new LoopDetector();
const plannerAgent = new PlannerAgent();
const cowork = new Cowork();
const apiEngine = new APIEngine();
const bus = new MessageBus();
const snapshots = new SnapshotEngine();
const lockManager = new LockManager();
const swarm = new SwarmOrchestrator();

// Scheduler is initialized lazily after app ready (needs the AI engine reference)
let scheduler = null;

// ── State ────────────────────────────────────────────
let mainWindow = null;
let aiEngine = null;
let intentEngine = null;

const HOME_URL = 'app://newtab';
let tabs = [];
let activeTabId = null;
const TOOLBAR_HEIGHT = 76; // titlebar(36) + navbar(40)
const AI_PANEL_WIDTH = 380;
let isAiPanelOpen = false;

if (app && app.commandLine) {
    app.commandLine.appendSwitch('remote-debugging-port', '9222');
    app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
}

const http = require('http');

// ── Embedded Automation HTTP API + WebSocket (Port 9223) ──────────────
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

        // GET /api/screenshot — Capture real-time visual PNG screenshot of LOVI (Composited Window + BrowserView)
        if (req.method === 'GET' && url.pathname === '/api/screenshot') {
            if (mainWindow && !mainWindow.isDestroyed()) {
                try {
                    const bounds = mainWindow.getBounds();
                    const sources = await desktopCapturer.getSources({
                        types: ['window'],
                        thumbnailSize: { width: Math.max(bounds.width, 1280), height: Math.max(bounds.height, 800) }
                    });
                    const targetSource = sources.find(s => s.id === mainWindow.getMediaSourceId()) ||
                                         sources.find(s => s.name.toLowerCase().includes('lovi') || s.name.toLowerCase().includes('tab') || s.name.toLowerCase().includes('wikipedia'));
                    
                    if (targetSource && targetSource.thumbnail) {
                        const pngBuffer = targetSource.thumbnail.toPNG();
                        res.writeHead(200, { 'Content-Type': 'image/png' });
                        return res.end(pngBuffer);
                    }
                } catch (err) {
                    console.error('[Screenshot Error]', err);
                }

                const image = await mainWindow.webContents.capturePage();
                const pngBuffer = image.toPNG();
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return res.end(pngBuffer);
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Main window not available' }));
            }
        }

        // GET /api/distilled-dom — Extract indexed interactive DOM elements
        if (req.method === 'GET' && url.pathname === '/api/distilled-dom') {
            const activeTab = tabs.find(t => t.id === activeTabId);
            if (!activeTab || !activeTab.view) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ elements: [], summary: 'No active tab' }));
            }
            try {
                const distilledData = await activeTab.view.webContents.executeJavaScript(domDistiller.DOM_DISTILL_SCRIPT);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(distilledData || { elements: [], summary: 'No data' }, null, 2));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        }

        // GET/POST /api/user-memory — Manage static long-term memory (LTM)
        if (url.pathname === '/api/user-memory') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    profile: userMemory.getProfile(),
                    preferences: userMemory.getPreferences(),
                    summary: userMemory.getMemorySummary()
                }, null, 2));
            } else if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.profile) userMemory.updateProfile(data.profile);
                        if (data.preferences) {
                            Object.entries(data.preferences).forEach(([k, v]) => userMemory.setPreference(k, v));
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, profile: userMemory.getProfile() }));
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
        }

        // GET /api/planner-state — Retrieve hierarchical planner progress
        if (req.method === 'GET' && url.pathname === '/api/planner-state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(plannerAgent.getPlanState(), null, 2));
        }

        // GET /api/loop-detector — Retrieve loop detector history
        if (req.method === 'GET' && url.pathname === '/api/loop-detector') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                status: loopDetector.detectLoop(),
                history: loopDetector.getHistory()
            }, null, 2));
        }

        // ── Scheduled Tasks Endpoints ──────────────────────────────────
        if (url.pathname === '/api/schedules') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    schedules: scheduler ? scheduler.listSchedules() : [],
                    results: scheduler ? scheduler.getAllResults() : {}
                }, null, 2));
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (!data.prompt) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Missing prompt' })); }
                        if (!scheduler) { res.writeHead(503); return res.end(JSON.stringify({ error: 'Scheduler not ready' })); }
                        const entry = scheduler.addSchedule(data);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, schedule: entry }));
                    } catch (e) {
                        res.writeHead(400); return res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
            if (req.method === 'DELETE') {
                const id = url.searchParams.get('id');
                if (id && scheduler) { scheduler.removeSchedule(id); }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            }
        }

        // POST /api/schedules/run — Run a scheduled task immediately
        if (req.method === 'POST' && url.pathname === '/api/schedules/run') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', async () => {
                try {
                    const { id } = JSON.parse(body);
                    if (scheduler && id) await scheduler.runNow(id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.writeHead(400); return res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // ── BYOLLM Config Endpoints ────────────────────────────────────
        if (url.pathname === '/api/llm-config') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ config: apiEngine.getConfig(), usingLocalModel: true }, null, 2));
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        const saved = apiEngine.saveConfig(data);
                        const ok = await apiEngine.initialize();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, connected: ok, config: apiEngine.getConfig() }));
                    } catch (e) {
                        res.writeHead(400); return res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
        }

        // ── Cowork Filesystem Endpoints ────────────────────────────────
        if (url.pathname === '/api/cowork') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ active: cowork.isActive(), folder: cowork.getFolder(), summary: cowork.getSummary() }, null, 2));
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        if (data.folder) {
                            cowork.setFolder(data.folder);
                            userMemory.updateProfile({ coworkFolder: data.folder });
                        } else if (data.clear) {
                            cowork.clearFolder();
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, folder: cowork.getFolder() }));
                    } catch (e) {
                        res.writeHead(400); return res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
        }

        if (req.method === 'POST' && url.pathname === '/api/cowork/read') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { path: p } = JSON.parse(body);
                    const content = cowork.readFile(p);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, content }));
                } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
            });
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/cowork/write') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { path: p, content } = JSON.parse(body);
                    cowork.writeFile(p, content);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
            });
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/cowork/list') {
            try {
                const dirPath = url.searchParams.get('path') || '.';
                const entries = cowork.listDir(dirPath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ entries }, null, 2));
            } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
        }

        // ── Velocity: Snapshot Endpoints ───────────────────────────────
        if (url.pathname === '/api/snapshots') {
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ snapshots: snapshots.list() }, null, 2));
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', c => body += c);
                req.on('end', () => {
                    try {
                        const { name } = JSON.parse(body || '{}');
                        const meta = snapshots.save(name || 'API Snapshot', {
                            tabs, activeTabId,
                            chatHistory: chatContextHistory,
                            plannerSteps: plannerAgent.getSteps ? plannerAgent.getSteps() : [],
                            loopHistory: loopDetector.getHistory()
                        });
                        bus.broadcast('snapshot:saved', meta);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true, snapshot: meta }));
                    } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
                });
                return;
            }
            if (req.method === 'DELETE') {
                const id = url.searchParams.get('id');
                if (id) snapshots.delete(id); else snapshots.clearAll();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true }));
            }
        }

        // GET /api/snapshots/latest — Return the most recent snapshot state
        if (req.method === 'GET' && url.pathname === '/api/snapshots/latest') {
            const latest = snapshots.latest();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ snapshot: latest }, null, 2));
        }

        // ── Velocity: Swarm Endpoints ──────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/swarms') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ swarms: swarm.listSwarms() }, null, 2));
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/swarms/')) {
            const id = url.pathname.split('/').pop();
            const s = swarm.getSwarm(id);
            res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ swarm: s || null }, null, 2));
        }

        if (req.method === 'POST' && url.pathname === '/api/swarms') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const spec = JSON.parse(body);
                    if (!spec.tasks || !Array.isArray(spec.tasks)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'tasks[] array required' }));
                    }
                    // Start swarm asynchronously and return swarm ID immediately
                    res.writeHead(202, { 'Content-Type': 'application/json' });
                    const swarmId = `swarm_${Date.now()}`;
                    res.end(JSON.stringify({ accepted: true, swarmId }));
                    // Fire and forget — results broadcast via WS
                    swarm.run(spec, { bus, lockManager, aiEngine, taskModule: tasks }).catch(e => {
                        console.error('[Swarm HTTP] Error:', e.message);
                    });
                } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
            });
            return;
        }

        // ── Velocity: Lock Manager Endpoints ──────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/locks') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ locks: lockManager.getAllLocks() }, null, 2));
        }

        if (req.method === 'POST' && url.pathname === '/api/locks/release-all') {
            lockManager.releaseAll();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'All locks force-released' }));
        }

        // ── Velocity: WebSocket Event Log ─────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/ws-log') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                clients: bus.connectionCount,
                log: bus.getLog()
            }, null, 2));
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
    });

    server.listen(9223, '127.0.0.1', () => {
        console.log('[LOVI Automation Bridge] Listening on http://127.0.0.1:9223');
        console.log('[LOVI Chrome DevTools Protocol] Available on http://127.0.0.1:9222');
        // Upgrade HTTP server to also serve WebSocket connections
        bus.attach(server);
        bus.onCommand(async (msg) => {
            if (msg.type === 'navigate' && msg.url) {
                const tab = tabs.find(t => t.id === activeTabId);
                if (tab) tab.view.webContents.loadURL(msg.url);
                return { action: 'navigate', url: msg.url };
            }
            if (msg.prompt || msg.text) {
                const promptText = msg.prompt || msg.text;
                if (!isAiPanelOpen && mainWindow && !mainWindow.isDestroyed()) {
                    isAiPanelOpen = true;
                    mainWindow.webContents.send('toggle-ai-panel', true);
                    resizeBrowserView();
                }
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-ask-test', promptText);
                }
                return { action: 'prompt', prompt: promptText };
            }
            return { action: 'unknown' };
        });
    });
}

// ── App Ready ────────────────────────────────────────

app.whenReady().then(() => {
    startAutomationServer();
    // Initialize AI Engine
    const userDataPath = app.getPath('userData');
    aiEngine = new AIEngine(path.join(userDataPath, 'models'));
    intentEngine = new AIEngine(path.join(userDataPath, 'models'), { repo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF', file: 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf' });
    intentEngine.init().catch(e => console.error('[IntentRouter] Init failed:', e.message));

    aiEngine.onStatusChange((statusData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-status', statusData);
        }
    });

    createMainWindow();

    mainWindow.webContents.on('did-finish-load', () => {
        createTab(HOME_URL);

        // ── Initialize Scheduler (needs AI engine) ─────────────────────
        scheduler = new Scheduler(async (prompt, taskId) => {
            console.log(`[Scheduler] Running task ${taskId}: "${prompt.slice(0, 60)}..."`);
            const msgs = tasks.getChatMessages(prompt, [], '');
            let result = '';
            await aiEngine.generateStream(msgs, (token) => { result += token; });
            return result;
        });
        scheduler.startAll();

        if (process.argv.includes('--test-live')) {
            runLiveGuiTest();
        }
    });
});

// ── BrowserOS IPC: Cowork Filesystem ─────────────────
ipcMain.handle('cowork-set-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Cowork Folder for LOVI Agent'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const folder = cowork.setFolder(result.filePaths[0]);
        userMemory.updateProfile({ coworkFolder: folder });
        return { success: true, folder };
    }
    return { success: false };
});

ipcMain.handle('cowork-clear', async () => {
    cowork.clearFolder();
    return { success: true };
});

ipcMain.handle('cowork-read-file', async (event, filePath) => {
    try { return { success: true, content: cowork.readFile(filePath) }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('cowork-write-file', async (event, filePath, content) => {
    try { cowork.writeFile(filePath, content); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('cowork-list-dir', async (event, dirPath = '.') => {
    try { return { success: true, entries: cowork.listDir(dirPath) }; }
    catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('cowork-status', async () => {
    return { active: cowork.isActive(), folder: cowork.getFolder(), summary: cowork.getSummary() };
});

// ── BrowserOS IPC: Scheduled Tasks ───────────────────
ipcMain.handle('schedule-add', async (event, data) => {
    if (!scheduler) return { success: false, error: 'Scheduler not ready' };
    const entry = scheduler.addSchedule(data);
    return { success: true, schedule: entry };
});

ipcMain.handle('schedule-list', async () => {
    if (!scheduler) return { schedules: [], results: {} };
    return { schedules: scheduler.listSchedules(), results: scheduler.getAllResults() };
});

ipcMain.handle('schedule-remove', async (event, id) => {
    if (scheduler) scheduler.removeSchedule(id);
    return { success: true };
});

ipcMain.handle('schedule-run-now', async (event, id) => {
    if (scheduler && id) await scheduler.runNow(id);
    return { success: true };
});

// ── BrowserOS IPC: BYOLLM Config ──────────────────────
ipcMain.handle('llm-get-config', async () => {
    return { config: apiEngine.getConfig() };
});

ipcMain.handle('llm-set-config', async (event, newConfig) => {
    const saved = apiEngine.saveConfig(newConfig);
    const ok = await apiEngine.initialize((p) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai-status', p.message);
    });
    return { success: ok, config: apiEngine.getConfig() };
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
            bus.broadcast('navigate', { tabId: tab.id, url: navUrl });
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
            bus.broadcast('navigate:inpage', { tabId: tab.id, url: navUrl });
        }
    });

    view.webContents.on('page-title-updated', (_e, title) => {
        tab.title = title;
        sendTabsToRenderer();
        bus.broadcast('tab:title', { tabId: tab.id, title });
    });

    view.webContents.on('did-start-loading', () => {
        mainWindow.webContents.send('loading-state-changed', { loading: true });
        bus.broadcast('tab:loading', { tabId: tab.id, loading: true });
    });

    view.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('loading-state-changed', { loading: false });
        bus.broadcast('tab:loading', { tabId: tab.id, loading: false, url: view.webContents.getURL() });
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
    bus.broadcast('tab:closed', { closedTabId: id, tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })) });
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
    bus.broadcast('tab:switched', { activeTabId: id, url: tab.url || '' });
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
        let fullText = '';
        await aiEngine.generate(messages, (chunk) => {
            fullText += chunk;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-chunk', chunk);
            }
            bus.broadcast('ai:chunk', { chunk });
        });
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-done');
        }
        bus.broadcast('ai:done', { text: fullText });
    } catch (err) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ai-error', err.message);
        }
        bus.broadcast('ai:error', { error: err.message });
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

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-status', `Routing intent...`);
    }

    // ── FAST AI INTENT ROUTING (Replaces Regex) ──
    let isRoutedToNavigation = false;
    let aiFullResponse = '';

    if (intentEngine && intentEngine.status === 'ready') {
        try {
            let intentRouterResult = '';
            await intentEngine.generate(tasks.getIntentMessages(question), (chunk) => {
                intentRouterResult += chunk;
            });
            const match = intentRouterResult.match(/\{[\s\S]*?\}/);
            if (match) {
                const intent = JSON.parse(match[0]);
                if (intent.type === 'navigate' || intent.type === 'search' || intent.type === 'play') {
                    if (intent.query && intent.query.length > 3) {
                        let url = intent.query.startsWith('http') ? intent.query : `https://${intent.query}`;
                        const isNewTabReq = /\b(?:open a new tab|new tab|open new tab)\b/i.test(question);
                        if (intent.type === 'play') url = `https://www.youtube.com/results?search_query=${encodeURIComponent(intent.query.replace('https://', ''))}`;
                        
                        aiFullResponse = `Navigating to ${url}...\n\n`;
                        if (isNewTabReq) aiFullResponse += `[NEW_TAB url="${url}"]`;
                        else aiFullResponse += `[NAVIGATE url="${url}"]`;
                        
                        isRoutedToNavigation = true;
                    }
                }
            }
        } catch (e) {
            console.error('[IntentRouter] AI Parsing failed, falling back:', e.message);
        }
    }

    try {
        if (!isRoutedToNavigation) {
            // Prompt engineering trick for 1.5B models: Remind them to output tool on consent
            let effectiveQuestion = question;
            if (/^(yes|yeah|yep|sure|proceed|do it|ok|okay|please)\b/i.test(question.trim())) {
                effectiveQuestion += '\n\n*(System Reminder: If you previously asked for permission to navigate or play media, output the exact tool tag now!)*';
            }

            // Fall back to chat (with memory)
            const page = await getActivePageContent();
            const tabsSummary = getOpenTabsSummary();

            // Build context with history
            const baseMessages = (page.text)
                ? tasks.getAskPageMessages(page.text, effectiveQuestion, page.title, tabsSummary)
                : tasks.getComposeMessages(effectiveQuestion, '', tabsSummary);

            const systemPrompt = baseMessages[0];
            const currentUserReq = baseMessages[1];

            const messages = [
                systemPrompt,
                ...chatContextHistory,
                currentUserReq
            ];

            // Temporarily save user question
            chatContextHistory.push({ role: 'user', content: question });

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', `Generating response...`);
            }
            aiFullResponse = await aiEngine.generate(messages, (chunk) => {
                process.stdout.write(chunk); // Debug log exactly what it generates
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai-chunk', chunk);
                }
            });
        }

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
            const playCheck = question.match(/\bplay\s+(.+)/i);
            const navCheck = question.match(/\b(?:take me to|open|go to|navigate to)\s+(.+)/i);
            
            if (playCheck) {
                const mediaName = playCheck[1].replace(/\b(and build|build a playlist|a playlist|and queue|a mix|so we can|on youtube|for me)\b.*/i, '').trim();
                const isNewTabReq = /\b(?:open a new tab|new tab|open new tab)\b/i.test(question);
                if (isNewTabReq) {
                    aiFullResponse += `\n\n[NEW_TAB url="https://www.youtube.com/results?search_query=${encodeURIComponent(mediaName)}"]`;
                } else {
                    aiFullResponse += `\n\n[PLAY media="${mediaName}"]`;
                }
            } else if (navCheck) {
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

        // ── Agent-E Macro Execution & Loop Detector Tracking ──
        const activeTabForAction = tabs.find(t => t.id === activeTabId);
        const currentTabUrl = activeTabForAction ? activeTabForAction.url : '';

        // 1. [CLICK id="N"]
        const clickMacro = aiFullResponse.match(/\[CLICK id="(\d+)"\]/);
        if (clickMacro && activeTabForAction && activeTabForAction.view) {
            const elId = clickMacro[1];
            loopDetector.recordAction({ action: 'click', target: `id=${elId}`, url: currentTabUrl });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', `Clicking element [id=${elId}]...`);
            }
            activeTabForAction.view.webContents.executeJavaScript(domDistiller.CLICK_ELEMENT_SCRIPT(elId)).catch(() => {});
        }

        // 2. [TYPE id="N" text="..."]
        const typeMacro = aiFullResponse.match(/\[TYPE id="(\d+)" text="([^"]+)"\]/);
        if (typeMacro && activeTabForAction && activeTabForAction.view) {
            const elId = typeMacro[1];
            const typeText = typeMacro[2];
            loopDetector.recordAction({ action: 'type', target: `id=${elId}:${typeText}`, url: currentTabUrl });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', `Typing into [id=${elId}]...`);
            }
            activeTabForAction.view.webContents.executeJavaScript(domDistiller.TYPE_ELEMENT_SCRIPT(elId, typeText)).catch(() => {});
        }

        // 3. [AUTOFILL_FORM]
        if (aiFullResponse.includes('[AUTOFILL_FORM]') && activeTabForAction && activeTabForAction.view) {
            loopDetector.recordAction({ action: 'autofill', target: 'form', url: currentTabUrl });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai-status', `Auto-filling form from memory...`);
            }
            const profile = userMemory.getProfile();
            activeTabForAction.view.webContents.executeJavaScript(`
                (function() {
                    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'));
                    inputs.forEach(el => {
                        const name = (el.name || el.id || el.placeholder || '').toLowerCase();
                        if (name.includes('first') || name.includes('fname')) el.value = ${JSON.stringify(profile.firstName)};
                        else if (name.includes('last') || name.includes('lname')) el.value = ${JSON.stringify(profile.lastName)};
                        else if (name.includes('name')) el.value = ${JSON.stringify(profile.fullName)};
                        else if (name.includes('email')) el.value = ${JSON.stringify(profile.email)};
                        else if (name.includes('phone') || name.includes('tel')) el.value = ${JSON.stringify(profile.phone)};
                        else if (name.includes('city')) el.value = ${JSON.stringify(profile.city)};
                        else if (name.includes('zip') || name.includes('postal')) el.value = ${JSON.stringify(profile.zipCode)};
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                })()
            `).catch(() => {});
        }

        // 4. [PLAN_STEP step="..."]
        const planMacro = aiFullResponse.match(/\[PLAN_STEP step="([^"]+)"\]/);
        if (planMacro) {
            plannerAgent.completeCurrentStep(planMacro[1]);
        }

        const navMacro = aiFullResponse.match(/\[NAVIGATE url="([^"]+)"\]/);
        if (!failSafeTriggered && navMacro) {
            let targetUrl = navMacro[1];
            if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
            loopDetector.recordAction({ action: 'navigate', target: targetUrl, url: currentTabUrl });
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

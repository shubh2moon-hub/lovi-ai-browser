const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  // Navigation
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),

  // Tabs
  newTab: (url) => ipcRenderer.send('new-tab', url),
  closeTab: (id) => ipcRenderer.send('close-tab', id),
  switchTab: (id) => ipcRenderer.send('switch-tab', id),

  // PDF
  openPdf: () => ipcRenderer.send('open-pdf'),
  openPdfFromPath: (filePath) => ipcRenderer.send('open-pdf-path', filePath),
  openPdfFromFile: (file) => {
    const { webUtils } = require('electron');
    const path = webUtils ? webUtils.getPathForFile(file) : file.path;
    if (path) ipcRenderer.send('open-pdf-path', path);
  },

  // AI Assistant
  aiSummarize: () => ipcRenderer.send('ai-summarize'),
  aiSmartNavigate: (input) => ipcRenderer.invoke('ai-smart-navigate', input),
  aiPlay: (mediaString) => ipcRenderer.send('ai-play', mediaString),
  aiQueue: (mediaString) => ipcRenderer.send('ai-queue', mediaString),
  aiAsk: (question) => ipcRenderer.send('ai-ask', question),
  aiExplain: () => ipcRenderer.send('ai-explain'),
  aiCompose: (instruction) => ipcRenderer.send('ai-compose', instruction),
  aiStop: () => ipcRenderer.send('ai-stop'),
  aiInit: () => ipcRenderer.send('ai-init'),
  setAiPanelOpen: (isOpen) => ipcRenderer.send('set-ai-panel-open', isOpen),
  aiNewTab: (url) => ipcRenderer.send('ai-new-tab', url),
  aiCloseTab: (index) => ipcRenderer.send('ai-close-tab', index),
  aiSwitchTab: (index) => ipcRenderer.send('ai-switch-tab', index),

  // Listeners from main process
  onTabsChanged: (cb) => ipcRenderer.on('tabs-changed', (_e, data) => cb(data)),
  onNavigated: (cb) => ipcRenderer.on('navigated', (_e, data) => cb(data)),
  onLoadingStateChanged: (cb) => ipcRenderer.on('loading-state-changed', (_e, data) => cb(data)),

  // AI Listeners
  onAiChunk: (cb) => ipcRenderer.on('ai-chunk', (_e, data) => cb(data)),
  onAiDone: (cb) => ipcRenderer.on('ai-done', (_e, data) => cb(data)),
  onAiStatus: (cb) => ipcRenderer.on('ai-status', (_e, data) => cb(data)),
  onAiError: (cb) => ipcRenderer.on('ai-error', (_e, data) => cb(data)),
  onAiAskTest: (cb) => ipcRenderer.on('ai-ask-test', (_e, text) => cb(text)),
  onToggleAiPanel: (cb) => ipcRenderer.on('toggle-ai-panel', (_e, open) => cb(open)),
  notifyTestStepDone: (stepName) => ipcRenderer.send('test-step-done', stepName),

  // ── Cowork Filesystem ───────────────────────────────
  coworkSetFolder: () => ipcRenderer.invoke('cowork-set-folder'),
  coworkClear: () => ipcRenderer.invoke('cowork-clear'),
  coworkReadFile: (filePath) => ipcRenderer.invoke('cowork-read-file', filePath),
  coworkWriteFile: (filePath, content) => ipcRenderer.invoke('cowork-write-file', filePath, content),
  coworkListDir: (dirPath) => ipcRenderer.invoke('cowork-list-dir', dirPath),
  coworkStatus: () => ipcRenderer.invoke('cowork-status'),

  // ── Scheduled Tasks ─────────────────────────────────
  scheduleAdd: (data) => ipcRenderer.invoke('schedule-add', data),
  scheduleList: () => ipcRenderer.invoke('schedule-list'),
  scheduleRemove: (id) => ipcRenderer.invoke('schedule-remove', id),
  scheduleRunNow: (id) => ipcRenderer.invoke('schedule-run-now', id),

  // ── Bring Your Own LLM ──────────────────────────────
  llmGetConfig: () => ipcRenderer.invoke('llm-get-config'),
  llmSetConfig: (config) => ipcRenderer.invoke('llm-set-config', config),
});

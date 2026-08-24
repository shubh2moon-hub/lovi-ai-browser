// View preload — injected into each BrowserView tab
const { ipcRenderer } = require('electron');

// Content extraction listener for AI assistant
ipcRenderer.on('ai-extract-content', (event, replyChannel) => {
    try {
        const text = document.body ? document.body.innerText : '';
        const selection = window.getSelection() ? window.getSelection().toString() : '';
        const title = document.title || '';
        const url = window.location.href || '';

        ipcRenderer.send(replyChannel || 'ai-content-response', {
            text,
            selection,
            title,
            url,
        });
    } catch (err) {
        ipcRenderer.send(replyChannel || 'ai-content-response', {
            text: '',
            selection: '',
            title: '',
            url: '',
            error: err.message,
        });
    }
});

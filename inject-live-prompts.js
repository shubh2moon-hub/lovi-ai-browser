const http = require('http');

function postPrompt(promptText) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ prompt: promptText });
        const req = http.request({
            hostname: '127.0.0.1',
            port: 9223,
            path: '/api/prompt',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function getState() {
    return new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9223/api/state', res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function runLiveTest() {
    console.log('\n==========================================================================');
    console.log('=== 🚀 EXECUTING LIVE DESKTOP AUTOMATION SEQUENCE VIA HTTP API ===');
    console.log('==========================================================================\n');

    // Turn 1: Open Youtube/Interstellar tab
    console.log('[Injecting Turn 2 Prompt]: "Open a new tab and play the Interstellar soundtrack for me"');
    await postPrompt("Open a new tab and play the Interstellar soundtrack for me");
    console.log(' -> Injected! Waiting 12s for LOVI to stream response and auto-summarize...');
    await sleep(12000);

    let state1 = await getState();
    console.log(' Current Live App State:');
    console.log(JSON.stringify(state1, null, 2));

    // Turn 2: Ask about open tabs
    console.log('\n[Injecting Turn 3 Prompt]: "What tabs do I have open right now?"');
    await postPrompt("What tabs do I have open right now?");
    console.log(' -> Injected! Waiting 8s for LOVI to respond...');
    await sleep(8000);

    // Turn 3: Close Tab 2
    console.log('\n[Injecting Turn 4 Prompt]: "Close tab 2 for me please"');
    await postPrompt("Close tab 2 for me please");
    console.log(' -> Injected! Waiting 8s for tab closure...');
    await sleep(8000);

    let finalState = await getState();
    console.log('\n==========================================================================');
    console.log('=== ✅ LIVE DESKTOP AUTOMATION SEQUENCE COMPLETED! ===');
    console.log(`=== Remaining Open Tabs: ${finalState.tabs.length} ===`);
    console.log('==========================================================================\n');

})();

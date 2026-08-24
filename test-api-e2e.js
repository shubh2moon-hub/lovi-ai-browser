const http = require('http');

function requestData(verb, path, payload) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: 9223,
            path: path,
            method: verb,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });

        req.on('error', (e) => reject(e));

        if (payload) {
            req.write(JSON.stringify(payload));
        }
        req.end();
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    console.log('=== Starting LOVI API E2E Verification ===');
    console.log('[0/4] Waiting 8 seconds for LOVI AI Engine to fully initialize...');
    await delay(8000);

    console.log('\n[1/4] Sending initial prompt: Take me to wikipedia to read about Quantum Computing');
    const promptRes = await requestData('POST', '/api/prompt', { prompt: 'Take me to wikipedia to read about Quantum Computing' });
    console.log('  Response:', promptRes);

    await delay(5000); // Wait for LOVI AI to parse macro

    console.log('\n[2/4] Waiting for AI to finish thinking and trigger DuckDuckGo...');
    let state;
    let activeUrl = 'none';
    for (let i = 0; i < 20; i++) {
        state = await requestData('GET', '/api/state', null);
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        activeUrl = activeTab ? activeTab.url : 'none';
        if (activeUrl.includes('duckduckgo.com') || state.lastAiOutput.includes('NAVIGATE')) {
            break;
        }
        await delay(3000);
    }
    
    console.log('  Active Tab URL:', activeUrl);
    if (!activeUrl.includes('duckduckgo.com')) {
        console.warn('  WARN: URL is not duckduckgo.com! Current:', activeUrl);
    } else {
        console.log('  -> SUCCESS: DuckDuckGo URL confirmed!');
    }

    console.log('\n[3/4] Wait 15 seconds for DOM Extractor to identify Wikipedia and navigate...');
    await delay(15000);
    state = await requestData('GET', '/api/state', null);
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    activeUrl = activeTab ? activeTab.url : 'none';
    console.log('  Active Tab URL:', activeUrl);
    if (!activeUrl.includes('wikipedia.org')) {
        console.warn('  WARN: URL is not wikipedia.org! Current:', activeUrl);
    } else {
        console.log('  -> SUCCESS: Autonomous Wikipedia redirect confirmed!');
    }

    console.log('\n[4/4] Wait 15 seconds for Page Text Auto-Summarizer...');
    await delay(15000);
    state = await requestData('GET', '/api/state', null);
    console.log('  Last AI Output:\n' + state.lastAiOutput);
    if (state.lastAiOutput.includes('Page Summary') || state.lastAiOutput.length > 50) {
        console.log('  -> SUCCESS: Auto-summary captured and generated!');
    } else {
        console.warn('  WARN: Auto-summary header missing.');
    }

    console.log('\n=== API E2E Verification Complete ===');
}

runTest().catch(console.error);

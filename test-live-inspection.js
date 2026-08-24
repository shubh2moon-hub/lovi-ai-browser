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

(async function runInspectionTest() {
    console.log('\n==========================================================================');
    console.log('=== 🔬 LOVI LIVE API INSPECTION & MULTI-TAB VERIFIER ===');
    console.log('==========================================================================\n');

    try {
        // TURN 1: Wikipedia Topic Navigation
        console.log('--- TURN 1: Wikipedia Topic Navigation ---');
        console.log('💬 User: "Take me to wikipedia.org to read about Christopher Nolan"');
        await postPrompt("Take me to wikipedia.org to read about Christopher Nolan");
        console.log('⏳ Waiting 14s for page load, navigation, and AI response...');
        await sleep(14000);

        let state1 = await getState();
        console.log('\n📊 [State After Turn 1]:');
        console.log(`   - Open Tabs Count: ${state1.tabs.length}`);
        console.log(`   - Active Tab URL: ${state1.tabs[0]?.url}`);
        console.log(`   - Active Tab Title: "${state1.tabs[0]?.title}"`);
        console.log(`\n🤖 [LOVI Output 1]:\n${state1.lastAiOutput}\n`);

        // TURN 2: Combined New Tab + Play Media
        console.log('--- TURN 2: Combined New Tab + Play Media ---');
        console.log('💬 User: "Open a new tab and play the Interstellar soundtrack for me"');
        await postPrompt("Open a new tab and play the Interstellar soundtrack for me");
        console.log('⏳ Waiting 14s for new tab creation and AI response...');
        await sleep(14000);

        let state2 = await getState();
        console.log('\n📊 [State After Turn 2]:');
        console.log(`   - Open Tabs Count: ${state2.tabs.length} (Expected: 2)`);
        state2.tabs.forEach((t, i) => {
            console.log(`   - Tab ${i + 1} (${t.active ? 'ACTIVE' : 'INACTIVE'}): "${t.title}" — ${t.url}`);
        });
        console.log(`\n🤖 [LOVI Output 2]:\n${state2.lastAiOutput}\n`);

        if (state2.tabs.length >= 2) {
            console.log('  ✅ SUCCESS: New tab opened successfully!');
        } else {
            console.error('  ❌ FAILURE: New tab creation failed!');
        }

        // TURN 3: Tab Context Memory
        console.log('\n--- TURN 3: Tab Context Memory ---');
        console.log('💬 User: "What tabs do I have open right now?"');
        await postPrompt("What tabs do I have open right now?");
        console.log('⏳ Waiting 10s for AI response...');
        await sleep(10000);

        let state3 = await getState();
        console.log(`\n🤖 [LOVI Output 3]:\n${state3.lastAiOutput}\n`);

        // TURN 4: Tab Closure
        console.log('--- TURN 4: Close Tab 2 ---');
        console.log('💬 User: "Close tab 2 for me please"');
        await postPrompt("Close tab 2 for me please");
        console.log('⏳ Waiting 8s for tab closure...');
        await sleep(8000);

        let state4 = await getState();
        console.log('\n📊 [State After Turn 4]:');
        console.log(`   - Open Tabs Count: ${state4.tabs.length} (Expected: 1)`);
        console.log(`\n🤖 [LOVI Output 4]:\n${state4.lastAiOutput}\n`);

        console.log('==========================================================================');
        console.log('=== ✅ LIVE API INSPECTION & MULTI-TAB TEST COMPLETED ===');
        console.log('==========================================================================\n');

    } catch (e) {
        console.error('❌ Inspection Test Error:', e.message);
    }
})();

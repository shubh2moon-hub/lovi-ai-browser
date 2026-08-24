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

(async function runPronounsAndAutoPlayTest() {
    console.log('\n==========================================================================');
    console.log('=== 🎬 LOVI PRONOUN RESOLUTION & YOUTUBE AUTO-PLAY LIVE TEST ===');
    console.log('==========================================================================\n');

    try {
        // TURN 1: Topic Navigation
        console.log('--- TURN 1: Establish Subject ---');
        console.log('💬 User: "Take me to wikipedia.org to read about Christopher Nolan"');
        await postPrompt("Take me to wikipedia.org to read about Christopher Nolan");
        console.log('⏳ Waiting 12s for page load...');
        await sleep(12000);

        let state1 = await getState();
        console.log('\n📊 [State After Turn 1]:');
        console.log(`   - Active Tab URL: ${state1.tabs[0]?.url}`);
        console.log(`   - Active Tab Title: "${state1.tabs[0]?.title}"`);

        // TURN 2: Pronoun Resolution ("his soundtrack") + Auto-Play in New Tab
        console.log('\n--- TURN 2: Pronoun Resolution ("his") & Auto-Play in New Tab ---');
        console.log('💬 User: "Open a new tab and play his Interstellar soundtrack for me"');
        await postPrompt("Open a new tab and play his Interstellar soundtrack for me");
        console.log('⏳ Waiting 14s for new tab creation, search, auto-play click, and summary...');
        await sleep(14000);

        let state2 = await getState();
        console.log('\n📊 [State After Turn 2]:');
        console.log(`   - Total Tabs: ${state2.tabs.length}`);
        state2.tabs.forEach((t, i) => {
            console.log(`   - Tab ${i + 1} (${t.active ? 'ACTIVE' : 'INACTIVE'}): "${t.title}" — ${t.url}`);
        });
        console.log(`\n🤖 [LOVI Output 2]:\n${state2.lastAiOutput}\n`);

        const activeTab2 = state2.tabs.find(t => t.active);
        if (activeTab2 && activeTab2.url.includes('/watch?v=')) {
            console.log('  🎉 EXCELLENT: YouTube video AUTO-PLAYED directly! URL contains /watch?v=');
        } else {
            console.log(`  ℹ️ Loaded URL: ${activeTab2?.url}`);
        }

        // TURN 3: Pronoun Question ("what other films has he directed?")
        console.log('--- TURN 3: Pronoun Conversational Context ("he") ---');
        console.log('💬 User: "What other films has he directed?"');
        await postPrompt("What other films has he directed?");
        console.log('⏳ Waiting 10s for AI response...');
        await sleep(10000);

        let state3 = await getState();
        console.log(`\n🤖 [LOVI Output 3]:\n${state3.lastAiOutput}\n`);

        // TURN 4: Pronoun Tab Closure ("close that tab")
        console.log('--- TURN 4: Pronoun Tab Closure ("close that tab") ---');
        console.log('💬 User: "Close that tab"');
        await postPrompt("Close that tab");
        console.log('⏳ Waiting 6s for tab closure...');
        await sleep(6000);

        let state4 = await getState();
        console.log('\n📊 [State After Turn 4]:');
        console.log(`   - Remaining Open Tabs: ${state4.tabs.length}`);

        console.log('\n==========================================================================');
        console.log('=== ✅ PRONOUN RESOLUTION & AUTO-PLAY TEST COMPLETED! ===');
        console.log('==========================================================================\n');

    } catch (e) {
        console.error('❌ Test Error:', e.message);
    }
})();

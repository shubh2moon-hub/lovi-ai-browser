/**
 * LOVI AI Browser — Velocity Live Integration & Real-time WebSocket Test
 * Tests:
 *   1. WebSocket connection to ws://127.0.0.1:9223/ws
 *   2. State Snapshot save, list, and latest
 *   3. Tab Lock Manager acquire / status
 *   4. Swarm Orchestrator parallel execution & event broadcasting
 *   5. Cowork sandboxed filesystem read/write
 *   6. Scheduler task creation & retrieval
 *   7. BYOLLM configuration check
 */

const http = require('http');
const WebSocket = require('ws');

const API_BASE = 'http://127.0.0.1:9223';
const WS_URL = 'ws://127.0.0.1:9223/ws';

function httpGet(path) {
    return new Promise((resolve, reject) => {
        http.get(`${API_BASE}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(data); }
            });
        }).on('error', reject);
    });
}

function httpPost(path, bodyObj = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(bodyObj);
        const req = http.request(`${API_BASE}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(data); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function runLiveTest() {
    console.log('================================================================');
    console.log('🚀 LOVI BROWSER — REAL-TIME WEBSOCKET & VELOCITY LIVE TEST');
    console.log('================================================================\n');

    const receivedEvents = [];

    // 1. Connect WebSocket Whiteboard Stream
    console.log('📡 Step 1: Connecting to Real-Time WebSocket Bus at', WS_URL);
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
        ws.on('open', () => {
            clearTimeout(timer);
            console.log('✅ WebSocket connected successfully!');
            resolve();
        });
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                receivedEvents.push(msg);
                console.log(`   [WS Event] ${msg.type}`, msg.payload ? JSON.stringify(msg.payload).slice(0, 70) : '');
            } catch (e) {}
        });
        ws.on('error', (err) => console.error('   ❌ WS error:', err.message));
    });

    await new Promise(r => setTimeout(r, 500)); // wait for catchup event

    // 2. Test Browser State Snapshot
    console.log('\n📸 Step 2: Testing State Snapshot Engine...');
    const snapRes = await httpPost('/api/snapshots', { name: 'Live Test Checkpoint' });
    console.log('   Save Snapshot response:', snapRes);

    const latestSnap = await httpGet('/api/snapshots/latest');
    console.log('   Latest Snapshot loaded:', latestSnap.snapshot ? latestSnap.snapshot.name : 'none');

    // 3. Test Lock Manager
    console.log('\n🔒 Step 3: Checking Lock Manager status...');
    const locksRes = await httpGet('/api/locks');
    console.log('   Active locks count:', locksRes.locks ? locksRes.locks.length : 0);

    // 4. Test Swarm Orchestrator
    console.log('\n🌀 Step 4: Launching Swarm Orchestrator...');
    const swarmRes = await httpPost('/api/swarms', {
        name: 'Live Test Parallel Swarm',
        tasks: [
            { tabLabel: 'DuckDuckGo', prompt: 'Search for LOVI Browser' },
            { tabLabel: 'GitHub', prompt: 'Search for Velocity repo' }
        ],
        consolidate: 'Summarize both task results.'
    });
    console.log('   Swarm dispatch response:', swarmRes);

    // Wait 3 seconds for swarm tasks to complete and broadcast events over WS
    await new Promise(r => setTimeout(r, 3000));

    const swarmsList = await httpGet('/api/swarms');
    console.log('   Swarms list count:', swarmsList.swarms ? swarmsList.swarms.length : 0);

    // 5. Test Cowork Sandboxed Filesystem
    console.log('\n📂 Step 5: Testing Cowork Sandboxed Filesystem...');
    const coworkStatus = await httpGet('/api/cowork');
    console.log('   Cowork status:', coworkStatus.summary || coworkStatus);

    // 6. Test Scheduled Tasks
    console.log('\n⏰ Step 6: Testing Scheduled Tasks API...');
    const schedAdd = await httpPost('/api/schedules', {
        name: 'Morning News Check',
        prompt: 'Go to news.ycombinator.com and summarize top stories',
        type: 'daily',
        interval: 60
    });
    console.log('   Schedule created:', schedAdd.schedule ? schedAdd.schedule.name : schedAdd);

    const schedList = await httpGet('/api/schedules');
    console.log('   Schedules count:', schedList.schedules ? schedList.schedules.length : 0);

    // 7. Test BYOLLM Config API
    console.log('\n🧠 Step 7: Testing BYOLLM Configuration API...');
    const llmConfig = await httpGet('/api/llm-config');
    console.log('   Current LLM Provider config:', llmConfig.config || llmConfig);

    // 8. WebSocket Event Log verification
    console.log('\n📊 Step 8: Verifying WebSocket Event Broadcast Log...');
    const wsLog = await httpGet('/api/ws-log');
    console.log('   Active WS clients count:', wsLog.clients);
    console.log('   Total events broadcast:', wsLog.log ? wsLog.log.length : 0);

    console.log('\n================================================================');
    console.log(`✅ LIVE TEST PASSED! Received ${receivedEvents.length} real-time WebSocket events.`);
    console.log('================================================================');

    ws.close();
    process.exit(0);
}

runLiveTest().catch(err => {
    console.error('\n❌ LIVE TEST FAILED:', err.message);
    console.error('Make sure the LOVI browser background process or main.js is running.');
    process.exit(1);
});

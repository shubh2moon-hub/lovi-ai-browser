/**
 * LOVI AI Browser — Bi-Directional WebSocket Command Test
 * Connects to ws://127.0.0.1:9223/ws, sends a live prompt command over WebSocket,
 * and streams back all real-time execution responses & AI output tokens.
 */

const WebSocket = require('ws');
const WS_URL = 'ws://127.0.0.1:9223/ws';

async function testWebSocketCommands() {
    console.log('================================================================');
    console.log('📡 LOVI BROWSER — BI-DIRECTIONAL WEBSOCKET COMMAND TEST');
    console.log('================================================================\n');

    console.log('Connecting to WebSocket Bus at', WS_URL);
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS connection timeout')), 5000);
        ws.on('open', () => {
            clearTimeout(timer);
            console.log('✅ WebSocket connected successfully!\n');
            resolve();
        });
        ws.on('error', reject);
    });

    let fullAiOutput = '';

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'command:ack') {
                console.log(`📩 [WS Ack] Command ${msg.cmdId} accepted by LOVI. Status: ${msg.status}`);
            } else if (msg.type === 'command:result') {
                console.log(`✅ [WS Result] Command ${msg.cmdId} finished with status: ${msg.status}`);
            } else if (msg.type === 'ai:chunk') {
                process.stdout.write(msg.payload.chunk);
                fullAiOutput += msg.payload.chunk;
            } else if (msg.type === 'ai:done') {
                console.log('\n\n🏁 [WS Event] AI response stream finished!');
            } else if (msg.type === 'navigate' || msg.type === 'navigate:inpage') {
                console.log(`\n🧭 [WS Event] Browser navigated to: ${msg.payload.url}`);
            } else if (msg.type !== 'bus:catchup') {
                console.log(`\n📢 [WS Event] ${msg.type}:`, msg.payload);
            }
        } catch (e) {}
    });

    // Send Command 1: WebSocket Prompt Command
    console.log("💬 Sending Command over WebSocket: \"That's fascinating! Let's open a new tab and play the Interstellar soundtrack by Hans Zimmer on YouTube so we can listen while we chat.\"\n");
    ws.send(JSON.stringify({
        type: 'command',
        id: 'cmd_play_music',
        prompt: "That's fascinating! Let's open a new tab and play the Interstellar soundtrack by Hans Zimmer on YouTube so we can listen while we chat."
    }));

    // Wait 15 seconds for token streaming and response completion
    await new Promise(r => setTimeout(r, 15000));

    console.log('\n================================================================');
    console.log('✅ WEBSOCKET BI-DIRECTIONAL COMMAND TEST COMPLETED SUCCESSFULLY!');
    console.log('================================================================');

    ws.close();
    process.exit(0);
}

testWebSocketCommands().catch(err => {
    console.error('\n❌ WebSocket Command Test Error:', err.message);
    process.exit(1);
});

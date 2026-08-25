/**
 * LOVI AI Browser — 5-Minute Multi-Turn WebSocket Live Conversation
 * Simulates a continuous live conversation over WebSockets:
 *   - Connects to ws://127.0.0.1:9223/ws
 *   - Sends prompts over WebSocket
 *   - Listens for real-time `ai:chunk` token streams
 *   - Reads LOVI's complete response
 *   - Dynamically crafts the next follow-up turn based on LOVI's output
 *   - Demonstrates multi-turn context, browser action tags, and real-time streaming
 */

const WebSocket = require('ws');
const WS_URL = 'ws://127.0.0.1:9223/ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));

class LiveConversationAgent {
    constructor() {
        this.ws = null;
        this.currentChunkBuffer = '';
        this.isDone = false;
        this.doneResolver = null;
    }

    async connect() {
        console.log('📡 Connecting to LOVI WebSocket at', WS_URL);
        this.ws = new WebSocket(WS_URL);

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
            this.ws.on('open', () => {
                clearTimeout(timer);
                console.log('✅ Connected to LOVI WebSocket!\n');
                resolve();
            });
            this.ws.on('error', reject);
        });

        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'ai:chunk') {
                    const chunk = msg.payload.chunk;
                    process.stdout.write(chunk);
                    this.currentChunkBuffer += chunk;
                } else if (msg.type === 'ai:done') {
                    this.isDone = true;
                    if (this.doneResolver) this.doneResolver(this.currentChunkBuffer);
                } else if (msg.type === 'navigate' || msg.type === 'navigate:inpage') {
                    console.log(`\n  🧭 [Browser Navigation Event]: ${msg.payload.url}`);
                } else if (msg.type === 'tab:switched' || msg.type === 'tab:closed') {
                    console.log(`\n  📑 [Tab Event]: ${msg.type}`);
                }
            } catch (e) {}
        });
    }

    async sendPromptAndWait(promptText, timeoutMs = 45000) {
        this.currentChunkBuffer = '';
        this.isDone = false;

        console.log(`\n==========================================================================`);
        console.log(`💬 USER (via WebSocket): "${promptText}"`);
        console.log(`--------------------------------------------------------------------------`);
        console.log(`🤖 LOVI (Streaming Response):`);

        const resultPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                resolve(this.currentChunkBuffer || '(Response timeout, proceeding...)');
            }, timeoutMs);

            this.doneResolver = (fullText) => {
                clearTimeout(timer);
                resolve(fullText);
            };
        });

        // Send command over WebSocket
        this.ws.send(JSON.stringify({
            type: 'command',
            id: `turn_${Date.now()}`,
            prompt: promptText
        }));

        const responseText = await resultPromise;
        console.log(`\n==========================================================================\n`);
        return responseText;
    }

    close() {
        if (this.ws) this.ws.close();
    }
}

(async function run5MinuteLiveConversation() {
    console.log('==========================================================================');
    console.log('🚀 LOVI BROWSER — 5-MINUTE MULTI-TURN WEBSOCKET LIVE CONVERSATION');
    console.log('==========================================================================\n');

    const agent = new LiveConversationAgent();

    try {
        await agent.connect();

        // ── TURN 1: Initial Friendly Greeting & Movie Conversation ────────────
        console.log('--- TURN 1 / 5: Warm Greeting & Movie Intro ---');
        const prompt1 = "Hi LOVI! I'm in a great mood today. I love cinema and mind-bending movies. What's your favorite Christopher Nolan film?";
        const response1 = await agent.sendPromptAndWait(prompt1);
        console.log('⏳ Pausing 5s before next turn to simulate natural reading...');
        await sleep(5000);

        // ── TURN 2: Dynamic Follow-Up on Science & Black Holes ────────────────
        console.log('--- TURN 2 / 5: Dynamic Science & Black Hole Discussion ---');
        let prompt2 = "Interstellar is amazing! The wormhole and black hole scenes were mind-blowing. Can you explain the physics behind time dilation near Gargantua?";
        if (response1.toLowerCase().includes('inception')) {
            prompt2 = "Inception is incredible! The dream levels and gravity-defying hallway fight scene were genius. How does dream time dilation work in the movie?";
        }
        const response2 = await agent.sendPromptAndWait(prompt2);
        console.log('⏳ Pausing 5s before next turn...');
        await sleep(5000);

        // ── TURN 3: Browser Action Command — Play Music in New Tab ─────────────
        console.log('--- TURN 3 / 5: Media Playback & Tab Control ---');
        const prompt3 = "That's fascinating! Let's open a new tab and play the Interstellar soundtrack by Hans Zimmer on YouTube so we can listen while we chat.";
        const response3 = await agent.sendPromptAndWait(prompt3);
        console.log('⏳ Pausing 6s for media load...');
        await sleep(6000);

        // ── TURN 4: Tab Awareness & Context Memory ────────────────────────────
        console.log('--- TURN 4 / 5: Tab Awareness & Context Check ---');
        const prompt4 = "The Hans Zimmer music is incredible! Can you check what browser tabs we have open right now and tell me?";
        const response4 = await agent.sendPromptAndWait(prompt4);
        console.log('⏳ Pausing 5s...');
        await sleep(5000);

        // ── TURN 5: Warm Wrap-Up & Cowork Note Saving ──────────────────────────
        console.log('--- TURN 5 / 5: Warm Wrap-Up & Summary ---');
        const prompt5 = "You've been such an awesome companion LOVI! Save a quick 2-bullet summary of our movie and physics discussion to notes.md for me.";
        const response5 = await agent.sendPromptAndWait(prompt5);

        console.log('==========================================================================');
        console.log('✅ 5-MINUTE MULTI-TURN WEBSOCKET CONVERSATION COMPLETED SUCCESSFULLY!');
        console.log('==========================================================================\n');

    } catch (e) {
        console.error('❌ Live Conversation Error:', e.message);
    } finally {
        agent.close();
        process.exit(0);
    }
})();

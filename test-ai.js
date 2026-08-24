const path = require('path');
const AIEngine = require('./ai/engine');
const tasks = require('./ai/tasks');

async function runActionAndConversationTests() {
    console.log("==========================================================================");
    console.log("=== LOVI AI SIMULTANEOUS CONVERSATION & ACTION CAPABILITY TEST SUITE ===");
    console.log("==========================================================================\n");

    const modelPath = path.join(__dirname, 'models');
    const engine = new AIEngine(modelPath);

    console.log("1. Initializing AI Engine (Qwen 2.5 1.5B)...");
    await engine.init();
    console.log("   -> Engine initialized successfully.\n");

    let totalActionPassed = 0;
    let totalPersonaPassed = 0;
    let totalScenarios = 3;

    // Helper to evaluate persona
    function evaluatePersona(response) {
        const hasDisclaimer = /As an AI|language model|I don't have personal preferences|I cannot browse/i.test(response);
        const opensWarmly = response.length > 30;
        const asksFollowUp = response.includes('?') || response.toLowerCase().includes('what') || response.toLowerCase().includes('how');
        return {
            cleanPersona: !hasDisclaimer,
            engaging: opensWarmly && asksFollowUp,
            hasDisclaimer
        };
    }

    // ────────────────────────────────────────────────────────────────
    // SCENARIO 1: Media Playback & Live Queueing Action Test
    // ────────────────────────────────────────────────────────────────
    console.log("--- SCENARIO 1: Media Action & Music Dialogue ---");
    let history1 = [];
    const prompt1_1 = "play some dua lipa and queue a mix";
    console.log(`[User 1.1]: "${prompt1_1}"`);

    let messages = tasks.getComposeMessages(prompt1_1);
    let res1_1 = await engine.generate(messages);
    console.log(`[AI Output 1.1]:\n${res1_1}\n`);

    const hasPlayMacro1 = res1_1.includes('[PLAY') || res1_1.includes('[QUEUE');
    const eval1_1 = evaluatePersona(res1_1);

    if (hasPlayMacro1) console.log("  ✅ Action Check 1.1: [PLAY/QUEUE] macro emitted successfully!");
    else console.error("  ❌ Action Check 1.1: Macro missing!");

    if (eval1_1.cleanPersona) console.log("  ✅ Persona Check 1.1: Zero AI disclaimers detected!");
    else console.error("  ❌ Persona Check 1.1: Corporate AI disclaimer detected!");

    history1.push({ role: 'user', content: prompt1_1 });
    history1.push({ role: 'assistant', content: res1_1 });

    const prompt1_2 = "add some pop dance tracks by lady gaga to the mix";
    console.log(`\n[User 1.2]: "${prompt1_2}"`);

    messages = [messages[0], ...history1, tasks.getComposeMessages(prompt1_2)[1]];
    let res1_2 = await engine.generate(messages);
    console.log(`[AI Output 1.2]:\n${res1_2}\n`);

    const hasQueueMacro2 = res1_2.includes('[QUEUE') || res1_2.includes('[PLAY');
    if (hasQueueMacro2) console.log("  ✅ Action Check 1.2: Follow-up Queue macro emitted!");
    
    if (hasPlayMacro1 && hasQueueMacro2) totalActionPassed++;
    if (eval1_1.cleanPersona) totalPersonaPassed++;

    // ────────────────────────────────────────────────────────────────
    // SCENARIO 2: Web Navigation Action & Deep Dialogue Test
    // ────────────────────────────────────────────────────────────────
    console.log("\n--- SCENARIO 2: Web Navigation Action & Physics Dialogue ---");
    let history2 = [];
    const prompt2_1 = "take me to wikipedia.org to read about quantum physics";
    console.log(`[User 2.1]: "${prompt2_1}"`);

    messages = tasks.getComposeMessages(prompt2_1);
    let res2_1 = await engine.generate(messages);
    console.log(`[AI Output 2.1]:\n${res2_1}\n`);

    const hasNavMacro = res2_1.includes('[NAVIGATE');
    const eval2_1 = evaluatePersona(res2_1);

    if (hasNavMacro) console.log("  ✅ Action Check 2.1: [NAVIGATE url=\"...\"] macro emitted successfully!");
    else console.error("  ❌ Action Check 2.1: Navigation macro missing!");

    if (eval2_1.cleanPersona) console.log("  ✅ Persona Check 2.1: Zero AI disclaimers detected!");

    history2.push({ role: 'user', content: prompt2_1 });
    history2.push({ role: 'assistant', content: res2_1 });

    const prompt2_2 = "can you explain what quantum entanglement means in simple terms?";
    console.log(`\n[User 2.2]: "${prompt2_2}"`);

    messages = [messages[0], ...history2, tasks.getComposeMessages(prompt2_2)[1]];
    let res2_2 = await engine.generate(messages);
    console.log(`[AI Output 2.2]:\n${res2_2}\n`);

    const retainsPhysicsContext = res2_2.toLowerCase().includes('quantum') || res2_2.toLowerCase().includes('particle') || res2_2.toLowerCase().includes('entangl');
    const eval2_2 = evaluatePersona(res2_2);

    if (retainsPhysicsContext) console.log("  ✅ Context Check 2.2: Context memory maintained across turns.");
    if (eval2_2.cleanPersona) console.log("  ✅ Persona Check 2.2: Zero AI disclaimers detected!");

    if (hasNavMacro) totalActionPassed++;
    if (eval2_1.cleanPersona && eval2_2.cleanPersona) totalPersonaPassed++;

    // ────────────────────────────────────────────────────────────────
    // SCENARIO 3: Movie Recommendation + Simultaneous Play Action
    // ────────────────────────────────────────────────────────────────
    console.log("\n--- SCENARIO 3: Movie Discussion & Simultaneous Play Action ---");
    let history3 = [];
    const prompt3_1 = "recommend 3 top action thrillers and play trailer for John Wick";
    console.log(`[User 3.1]: "${prompt3_1}"`);

    messages = tasks.getComposeMessages(prompt3_1);
    let res3_1 = await engine.generate(messages);
    console.log(`[AI Output 3.1]:\n${res3_1}\n`);

    const hasPlayMacro3 = res3_1.includes('[PLAY') || res3_1.includes('[QUEUE');
    const eval3_1 = evaluatePersona(res3_1);

    if (hasPlayMacro3) console.log("  ✅ Action Check 3.1: Simultaneous [PLAY] macro emitted!");
    else console.error("  ❌ Action Check 3.1: Macro missing!");

    if (eval3_1.cleanPersona) console.log("  ✅ Persona Check 3.1: Zero AI disclaimers detected!");

    history3.push({ role: 'user', content: prompt3_1 });
    history3.push({ role: 'assistant', content: res3_1 });

    const prompt3_2 = "which of those has the best stunt choreography?";
    console.log(`\n[User 3.2]: "${prompt3_2}"`);

    messages = [messages[0], ...history3, tasks.getComposeMessages(prompt3_2)[1]];
    let res3_2 = await engine.generate(messages);
    console.log(`[AI Output 3.2]:\n${res3_2}\n`);

    const retainsMovieContext = res3_2.toLowerCase().includes('john wick') || res3_2.toLowerCase().includes('stunt') || res3_2.toLowerCase().includes('action');
    const eval3_2 = evaluatePersona(res3_2);

    if (retainsMovieContext) console.log("  ✅ Context Check 3.2: Cinema context maintained across turns.");
    if (eval3_2.cleanPersona) console.log("  ✅ Persona Check 3.2: Zero AI disclaimers detected!");

    if (hasPlayMacro3) totalActionPassed++;
    if (eval3_1.cleanPersona && eval3_2.cleanPersona) totalPersonaPassed++;

    // ────────────────────────────────────────────────────────────────
    // SUMMARY
    // ────────────────────────────────────────────────────────────────
    console.log("\n==========================================================================");
    console.log(`=== TEST SUMMARY ===`);
    console.log(`Action Macro Capability Score: ${totalActionPassed} / ${totalScenarios} Scenarios Emitted Tool Actions Correctly`);
    console.log(`Conversational Persona Score: ${totalPersonaPassed} / ${totalScenarios} Scenarios 100% Free of Corporate Disclaimers`);
    console.log("==========================================================================");

    engine.stop();
    const passedAll = (totalActionPassed >= 2) && (totalPersonaPassed === totalScenarios);
    process.exit(passedAll ? 0 : 1);
}

runActionAndConversationTests().catch(err => {
    console.error("Test execution error:", err);
    process.exit(1);
});

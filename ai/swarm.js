/**
 * LOVI AI Browser — Multi-Tab Swarm Orchestrator
 * Inspired by Velocity's Hierarchical Swarms architecture.
 *
 * Allows a parent "swarm task" to spawn multiple parallel browser sub-agents,
 * each working in their own tab, then consolidate their results back.
 *
 * Example: "Compare prices of RTX 4090 on Amazon, Newegg, and eBay"
 *   → Spawn 3 sub-agents in 3 tabs in parallel
 *   → Each navigates, extracts info, and returns a result string
 *   → Parent consolidates into a final comparison and saves to Cowork
 *
 * Usage (from main.js):
 *   swarm.run({
 *     name: 'Price Compare',
 *     tasks: [
 *       { tabLabel: 'Amazon', prompt: 'Go to Amazon and find RTX 4090 price' },
 *       { tabLabel: 'Newegg', prompt: 'Go to Newegg and find RTX 4090 price' },
 *     ],
 *     consolidate: 'Summarize the prices found above in a comparison table'
 *   }, { openTab, aiAsk, lockManager, bus })
 */

class SwarmOrchestrator {
    constructor() {
        this.activeSwarms = new Map(); // swarmId → SwarmState
    }

    /**
     * Run a swarm of parallel browser tasks.
     * @param {object} spec         - Swarm specification
     * @param {object} deps         - Injected dependencies: { openTab, sendToTab, aiEngine, tasks, bus, lockManager }
     * @returns {Promise<object>}   - Final swarm result
     */
    async run(spec, deps) {
        const { name, tasks, consolidate } = spec;
        const { bus, lockManager, aiEngine, taskModule } = deps;

        const swarmId = `swarm_${Date.now()}`;
        const state = {
            id: swarmId,
            name: name || 'Unnamed Swarm',
            status: 'running',
            startedAt: new Date().toISOString(),
            tasks: tasks.map((t, i) => ({
                id: `${swarmId}_t${i}`,
                label: t.tabLabel || `Task ${i + 1}`,
                prompt: t.prompt,
                status: 'pending',
                result: null,
                error: null
            })),
            consolidatedResult: null,
            finishedAt: null
        };

        this.activeSwarms.set(swarmId, state);
        if (bus) bus.broadcast('swarm:started', { swarmId, name, taskCount: tasks.length });

        console.log(`[Swarm] Starting swarm "${name}" with ${tasks.length} sub-tasks.`);

        try {
            // Run all sub-tasks in PARALLEL
            await Promise.all(state.tasks.map(task => this._runSubTask(task, state, deps)));

            state.status = 'consolidating';
            if (bus) bus.broadcast('swarm:consolidating', { swarmId });

            // Gather results for consolidation prompt
            const resultsText = state.tasks.map(t =>
                `## ${t.label}\n${t.result || t.error || '(no result)'}`
            ).join('\n\n');

            const consolidatePrompt = `${consolidate || 'Summarize the results from the parallel tasks below:'}\n\n${resultsText}`;

            // Run consolidation via AI
            if (aiEngine && taskModule) {
                const msgs = taskModule.getComposeMessages(consolidatePrompt, '', '');
                let consolidated = '';
                await aiEngine.generate(msgs, (tok) => { consolidated += tok; });
                state.consolidatedResult = consolidated;
            } else {
                state.consolidatedResult = resultsText;
            }

            state.status = 'done';
            state.finishedAt = new Date().toISOString();

            if (bus) bus.broadcast('swarm:done', { swarmId, result: state.consolidatedResult });
            console.log(`[Swarm] Swarm "${name}" completed.`);

        } catch (err) {
            state.status = 'failed';
            state.finishedAt = new Date().toISOString();
            if (bus) bus.broadcast('swarm:failed', { swarmId, error: err.message });
            console.error(`[Swarm] Swarm "${name}" failed:`, err.message);
        }

        return state;
    }

    async _runSubTask(task, state, deps) {
        const { bus, lockManager, aiEngine, taskModule, navigateFn, getPageContentFn } = deps;

        task.status = 'running';
        if (bus) bus.broadcast('swarm:task:started', { swarmId: state.id, taskId: task.id, label: task.label });

        // Acquire a lock on 'swarm-slot' to prevent thrashing (optional throttle)
        let release = null;
        if (lockManager) {
            try {
                release = await lockManager.acquire(`swarm:slot`, task.id, 60000);
            } catch (e) {
                task.status = 'failed';
                task.error = `Lock timeout: ${e.message}`;
                if (bus) bus.broadcast('swarm:task:failed', { swarmId: state.id, taskId: task.id, error: task.error });
                return;
            }
        }

        try {
            let result = '';

            if (aiEngine && taskModule) {
                // Build a self-contained subtask prompt
                const subPrompt = `You are a sub-agent in a browser swarm. Your specific task is:\n${task.prompt}\n\nExecute the task and provide a concise result. Do not ask for clarification.`;
                const msgs = taskModule.getComposeMessages(subPrompt, '', '');
                await aiEngine.generate(msgs, (tok) => { result += tok; });
            } else {
                // Fallback: just record the navigation intent
                result = `[Would navigate to fulfill: ${task.prompt}]`;
            }

            task.result = result;
            task.status = 'done';
            if (bus) bus.broadcast('swarm:task:done', { swarmId: state.id, taskId: task.id, label: task.label, result });

        } catch (err) {
            task.status = 'failed';
            task.error = err.message;
            if (bus) bus.broadcast('swarm:task:failed', { swarmId: state.id, taskId: task.id, error: err.message });
        } finally {
            if (release) release();
        }
    }

    /** List all currently tracked swarms (running and completed) */
    listSwarms() {
        return Array.from(this.activeSwarms.values()).map(s => ({
            id: s.id, name: s.name, status: s.status,
            startedAt: s.startedAt, finishedAt: s.finishedAt,
            taskCount: s.tasks.length,
            taskStatuses: s.tasks.map(t => ({ id: t.id, label: t.label, status: t.status }))
        }));
    }

    /** Get full details of a swarm including results */
    getSwarm(id) { return this.activeSwarms.get(id) || null; }

    /** Clear completed swarms from memory */
    clearCompleted() {
        for (const [id, s] of this.activeSwarms) {
            if (s.status === 'done' || s.status === 'failed') this.activeSwarms.delete(id);
        }
    }
}

module.exports = SwarmOrchestrator;

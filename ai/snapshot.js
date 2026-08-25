/**
 * LOVI AI Browser — State Snapshot Engine
 * Inspired by Velocity's src/memory/snapshot.ts
 *
 * Saves and restores complete browser + agent session state:
 *   - Active tab, all open tabs with URL and title
 *   - Chat conversation history
 *   - Planner agent step queue
 *   - Loop detector history
 *   - User memory profile (reference)
 *
 * This allows agents to checkpoint before risky operations and roll back
 * if something goes wrong.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data/snapshots');
const MAX_SNAPSHOTS = 20;

class SnapshotEngine {
    constructor() {
        this._ensureDir();
    }

    _ensureDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    /**
     * Save a named snapshot of the current browser/agent state.
     * @param {string} name  - Human-readable label (e.g. 'before-checkout')
     * @param {object} state - { tabs, activeTabId, chatHistory, plannerSteps, loopHistory }
     * @returns {object} Saved snapshot metadata
     */
    save(name, state) {
        this._ensureDir();
        const id = `snap_${Date.now()}`;
        const snapshot = {
            id,
            name: name || `Snapshot ${new Date().toLocaleTimeString()}`,
            savedAt: new Date().toISOString(),
            state: {
                tabs: state.tabs || [],
                activeTabId: state.activeTabId || null,
                chatHistory: (state.chatHistory || []).slice(-30), // last 30 messages
                plannerSteps: state.plannerSteps || [],
                loopHistory: state.loopHistory || []
            }
        };

        const filePath = path.join(DATA_DIR, `${id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
        console.log(`[Snapshot] Saved: "${snapshot.name}" (${id})`);

        // Prune old snapshots
        this._prune();

        return { id, name: snapshot.name, savedAt: snapshot.savedAt };
    }

    /** Load a snapshot by ID */
    load(id) {
        const filePath = path.join(DATA_DIR, `${id}.json`);
        if (!fs.existsSync(filePath)) throw new Error(`Snapshot not found: ${id}`);
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    /** List all saved snapshots (metadata only, no state blob) */
    list() {
        this._ensureDir();
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        return files.map(f => {
            try {
                const { id, name, savedAt } = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
                return { id, name, savedAt };
            } catch { return null; }
        }).filter(Boolean).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    }

    /** Delete a specific snapshot */
    delete(id) {
        const filePath = path.join(DATA_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    /** Delete all snapshots */
    clearAll() {
        this._ensureDir();
        fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).forEach(f => {
            fs.unlinkSync(path.join(DATA_DIR, f));
        });
    }

    /** Get the latest snapshot */
    latest() {
        const all = this.list();
        if (all.length === 0) return null;
        return this.load(all[0].id);
    }

    /** Auto-prune: keep only the newest MAX_SNAPSHOTS snapshots */
    _prune() {
        const all = this.list();
        if (all.length > MAX_SNAPSHOTS) {
            const toDelete = all.slice(MAX_SNAPSHOTS);
            for (const snap of toDelete) this.delete(snap.id);
        }
    }
}

module.exports = SnapshotEngine;

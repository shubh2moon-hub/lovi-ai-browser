/**
 * LOVI AI Browser — Scheduler Agent
 * Inspired by BrowserOS Scheduled Tasks.
 * Allows users to run agent prompts on a recurring schedule (daily, hourly, by minutes).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const RESULTS_FILE = path.join(DATA_DIR, 'schedule-results.json');
const MAX_RESULTS_PER_TASK = 10;

class Scheduler {
    constructor(onExecute) {
        this.schedules = [];
        this.results = {};
        this.timers = {};
        this.onExecute = onExecute; // async fn(prompt, taskId) => string result
        this._ensureDataDir();
        this._load();
    }

    _ensureDataDir() {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    }

    _load() {
        try {
            if (fs.existsSync(SCHEDULES_FILE)) {
                this.schedules = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
            }
        } catch { this.schedules = []; }

        try {
            if (fs.existsSync(RESULTS_FILE)) {
                this.results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
            }
        } catch { this.results = {}; }
    }

    _save() {
        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(this.schedules, null, 2), 'utf8');
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(this.results, null, 2), 'utf8');
    }

    /** Add or update a scheduled task. Returns the schedule entry. */
    addSchedule({ id, name, prompt, type, interval }) {
        // type: 'daily' | 'hourly' | 'minutes'
        // interval: number (hours for hourly, minutes for minutes, unused for daily)
        const entry = {
            id: id || `sched_${Date.now()}`,
            name: name || 'Untitled Task',
            prompt,
            type,
            interval: interval || 60,
            enabled: true,
            createdAt: new Date().toISOString(),
            lastRun: null,
            nextRun: this._calcNextRun(type, interval)
        };

        const existing = this.schedules.findIndex(s => s.id === entry.id);
        if (existing >= 0) {
            this.schedules[existing] = { ...this.schedules[existing], ...entry };
        } else {
            this.schedules.push(entry);
        }

        this._save();
        this._startTimer(entry.id);
        return entry;
    }

    removeSchedule(id) {
        this._clearTimer(id);
        this.schedules = this.schedules.filter(s => s.id !== id);
        delete this.results[id];
        this._save();
    }

    listSchedules() {
        return this.schedules;
    }

    getResults(id) {
        return (this.results[id] || []);
    }

    getAllResults() {
        return this.results;
    }

    /** Start all timers (call on app startup) */
    startAll() {
        for (const schedule of this.schedules) {
            if (schedule.enabled) this._startTimer(schedule.id);
        }
        console.log(`[Scheduler] Started ${this.schedules.length} scheduled tasks.`);
    }

    stopAll() {
        for (const id of Object.keys(this.timers)) {
            this._clearTimer(id);
        }
    }

    _calcNextRun(type, interval) {
        const now = Date.now();
        if (type === 'daily') {
            // next 8 AM
            const d = new Date();
            d.setHours(8, 0, 0, 0);
            if (d.getTime() <= now) d.setDate(d.getDate() + 1);
            return d.toISOString();
        } else if (type === 'hourly') {
            return new Date(now + (interval || 1) * 60 * 60 * 1000).toISOString();
        } else {
            // minutes
            return new Date(now + (interval || 30) * 60 * 1000).toISOString();
        }
    }

    _getMsUntilNext(schedule) {
        if (schedule.nextRun) {
            const delta = new Date(schedule.nextRun).getTime() - Date.now();
            return Math.max(delta, 5000); // minimum 5 seconds
        }
        return 60000;
    }

    _startTimer(id) {
        this._clearTimer(id);
        const schedule = this.schedules.find(s => s.id === id);
        if (!schedule || !schedule.enabled) return;

        const delay = this._getMsUntilNext(schedule);
        console.log(`[Scheduler] Task "${schedule.name}" runs in ${Math.round(delay / 60000)} min(s).`);

        this.timers[id] = setTimeout(async () => {
            await this._runTask(id);
        }, delay);
    }

    _clearTimer(id) {
        if (this.timers[id]) {
            clearTimeout(this.timers[id]);
            delete this.timers[id];
        }
    }

    async _runTask(id) {
        const schedule = this.schedules.find(s => s.id === id);
        if (!schedule) return;

        console.log(`[Scheduler] Running task: "${schedule.name}"`);
        const startTime = new Date().toISOString();
        let output = '';
        let status = 'success';

        try {
            if (this.onExecute) {
                output = await this.onExecute(schedule.prompt, id);
            }
        } catch (err) {
            console.error(`[Scheduler] Task "${schedule.name}" failed:`, err.message);
            output = `Error: ${err.message}`;
            status = 'failed';
        }

        // Save result
        if (!this.results[id]) this.results[id] = [];
        this.results[id].unshift({ ranAt: startTime, status, output: output || '(no output)' });
        this.results[id] = this.results[id].slice(0, MAX_RESULTS_PER_TASK);

        // Update schedule timing
        const idx = this.schedules.findIndex(s => s.id === id);
        if (idx >= 0) {
            this.schedules[idx].lastRun = startTime;
            this.schedules[idx].nextRun = this._calcNextRun(schedule.type, schedule.interval);
        }

        this._save();
        this._startTimer(id); // schedule next run
    }

    /** Manually run a task immediately */
    async runNow(id) {
        return await this._runTask(id);
    }
}

module.exports = Scheduler;

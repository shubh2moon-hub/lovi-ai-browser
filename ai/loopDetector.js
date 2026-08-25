/**
 * Loop Detector module inspired by Agent-E's detect_llm_loops.py
 * Tracks state transitions (URL, action tags, target selectors/queries) to detect loop patterns.
 */

class LoopDetector {
    constructor(maxHistory = 10, repetitionThreshold = 3) {
        this.maxHistory = maxHistory;
        this.repetitionThreshold = repetitionThreshold;
        this.history = [];
    }

    /**
     * Record an action attempt
     * @param {Object} stepData - { action: string, url: string, target: string, time: number }
     */
    recordAction(stepData) {
        const entry = {
            action: stepData.action || 'unknown',
            url: stepData.url || '',
            target: stepData.target || '',
            timestamp: stepData.time || Date.now()
        };

        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        return this.detectLoop();
    }

    /**
     * Check if the last N actions constitute a repetitive loop
     * @returns {Object} { isLoop: boolean, reason: string, suggestedCorrection: string }
     */
    detectLoop() {
        if (this.history.length < this.repetitionThreshold) {
            return { isLoop: false, reason: null, suggestedCorrection: null };
        }

        const recent = this.history.slice(-this.repetitionThreshold);
        const first = recent[0];

        // Check 1: Identical action and target repeated N times on the same URL
        const isIdenticalAction = recent.every(item => 
            item.action === first.action && 
            item.target === first.target && 
            item.url === first.url
        );

        if (isIdenticalAction) {
            return {
                isLoop: true,
                reason: `Repeated action '${first.action}' on target '${first.target}' ${this.repetitionThreshold} times without page change.`,
                suggestedCorrection: `Try an alternative element selection, scroll down, or navigate directly via search.`
            };
        }

        // Check 2: Ping-pong / Oscillating URLs between 2 states
        if (this.history.length >= 4) {
            const h = this.history.slice(-4);
            if (h[0].url === h[2].url && h[1].url === h[3].url && h[0].url !== h[1].url) {
                return {
                    isLoop: true,
                    reason: `Oscillating loop detected between URLs: '${h[0].url}' and '${h[1].url}'.`,
                    suggestedCorrection: `Stop navigating back and forth. Open the target page directly in a new tab or refine your query.`
                };
            }
        }

        return { isLoop: false, reason: null, suggestedCorrection: null };
    }

    reset() {
        this.history = [];
    }

    getHistory() {
        return [...this.history];
    }
}

module.exports = LoopDetector;

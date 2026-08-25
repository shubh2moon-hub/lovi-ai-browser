/**
 * LOVI AI Browser — Tab / DOM Lock Manager
 * Inspired by Velocity's src/orchestrator/locks.ts
 *
 * Prevents multiple agents or background scheduled tasks from
 * concurrently controlling the same browser tab or DOM, which
 * would cause race conditions and unpredictable navigation.
 *
 * Usage:
 *   const locks = new LockManager();
 *   const release = await locks.acquire('tab:abc-123', 'scheduler-task-1');
 *   try { // do tab work } finally { release(); }
 */

class LockManager {
    constructor() {
        // Map<resource, { owner, acquiredAt, queue: [{owner, resolve}] }>
        this._locks = new Map();
        this.DEFAULT_TIMEOUT_MS = 30000; // 30s auto-release to prevent deadlocks
    }

    /**
     * Acquire a lock on a resource. Returns a release function.
     * Queues up if already locked.
     * @param {string} resource - e.g. 'tab:abc-123' or 'dom:global'
     * @param {string} owner    - Who is requesting (e.g. 'scheduler', 'swarm-1', 'user')
     * @param {number} timeoutMs - Max time to WAIT for the lock before erroring
     */
    async acquire(resource, owner = 'unknown', timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const existing = this._locks.get(resource);

            const doAcquire = () => {
                const lock = {
                    owner,
                    acquiredAt: Date.now(),
                    queue: [],
                    timeout: setTimeout(() => {
                        // Auto-release after DEFAULT_TIMEOUT_MS to prevent deadlocks
                        console.warn(`[LockManager] Auto-releasing stale lock on "${resource}" owned by "${owner}"`);
                        this._release(resource);
                    }, this.DEFAULT_TIMEOUT_MS)
                };
                this._locks.set(resource, lock);

                console.log(`[LockManager] Lock acquired: ${resource} by ${owner}`);

                // Return a release function
                return () => this._release(resource);
            };

            if (!existing) {
                // Resource is free — acquire immediately
                resolve(doAcquire());
            } else {
                // Resource is locked — queue up
                console.log(`[LockManager] Waiting for lock: ${resource} (held by ${existing.owner})`);
                const waitTimeout = setTimeout(() => {
                    // Remove this queued item
                    if (existing.queue) {
                        existing.queue = existing.queue.filter(q => q.resolve !== resolve);
                    }
                    reject(new Error(`Lock timeout: "${resource}" held by "${existing.owner}" did not release within ${timeoutMs}ms`));
                }, timeoutMs);

                existing.queue.push({
                    owner,
                    resolve: () => {
                        clearTimeout(waitTimeout);
                        resolve(doAcquire());
                    }
                });
            }
        });
    }

    _release(resource) {
        const lock = this._locks.get(resource);
        if (!lock) return;

        clearTimeout(lock.timeout);
        console.log(`[LockManager] Lock released: ${resource} (was held by ${lock.owner})`);

        const next = lock.queue.shift();
        if (next) {
            // Pass lock to next waiter
            const newLock = {
                owner: next.owner,
                acquiredAt: Date.now(),
                queue: lock.queue,
                timeout: setTimeout(() => {
                    console.warn(`[LockManager] Auto-releasing stale lock on "${resource}" owned by "${next.owner}"`);
                    this._release(resource);
                }, this.DEFAULT_TIMEOUT_MS)
            };
            this._locks.set(resource, newLock);
            next.resolve();
        } else {
            this._locks.delete(resource);
        }
    }

    /** Check if a resource is currently locked */
    isLocked(resource) { return this._locks.has(resource); }

    /** Get current lock info for a resource */
    getLockInfo(resource) {
        const lock = this._locks.get(resource);
        if (!lock) return null;
        return { resource, owner: lock.owner, acquiredAt: lock.acquiredAt, queueLength: lock.queue.length };
    }

    /** Get all currently held locks */
    getAllLocks() {
        const result = [];
        for (const [resource, lock] of this._locks) {
            result.push({ resource, owner: lock.owner, acquiredAt: lock.acquiredAt, queueLength: lock.queue.length });
        }
        return result;
    }

    /** Force-release all locks (emergency use only) */
    releaseAll() {
        for (const [resource, lock] of this._locks) {
            clearTimeout(lock.timeout);
            for (const q of lock.queue) q.resolve(); // Unblock waiting acquirers
        }
        this._locks.clear();
    }
}

module.exports = LockManager;

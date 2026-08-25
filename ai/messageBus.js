/**
 * LOVI AI Browser — Whiteboard Message Bus
 * Inspired by Velocity's src/orchestrator/messagebus.ts
 *
 * Upgrades the :9223 automation server to support WebSocket connections.
 * External agents (Antigravity, automation scripts) can receive real-time
 * browser events: navigation, AI chunk/done, DOM changes, tab events, etc.
 *
 * Usage:
 *   const MessageBus = require('./ai/messageBus');
 *   const bus = new MessageBus();
 *   bus.attach(httpServer);            // upgrade HTTP server to also serve WS
 *   bus.broadcast('tab:changed', ...) // emit an event to all subscribers
 */

const { WebSocketServer, WebSocket } = require('ws');

class MessageBus {
    constructor() {
        this.wss = null;
        this.clients = new Set();
        this.eventLog = []; // last 100 events for catch-up on reconnect
        this.MAX_LOG = 100;
    }

    /** Attach to an existing http.Server (no extra port needed) */
    attach(httpServer) {
        this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

        this.wss.on('connection', (ws, req) => {
            console.log('[MessageBus] WS client connected:', req.socket.remoteAddress);
            this.clients.add(ws);

            // Send the last N events so new clients catch up immediately
            ws.send(JSON.stringify({
                type: 'bus:catchup',
                payload: this.eventLog,
                ts: Date.now()
            }));

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('[MessageBus] WS client disconnected. Total:', this.clients.size);
            });

            ws.on('error', (err) => {
                console.error('[MessageBus] WS error:', err.message);
                this.clients.delete(ws);
            });

            // Handle inbound WS messages from external agents/tools
            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'ping') {
                        return ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
                    }

                    // Bi-directional WS command interface
                    if (msg.type === 'command' || msg.type === 'prompt' || msg.type === 'navigate') {
                        const cmdId = msg.id || `cmd_${Date.now()}`;
                        console.log(`[MessageBus] Inbound WS Command (${cmdId}):`, msg.prompt || msg.url || msg);

                        // Acknowledge command receipt immediately
                        ws.send(JSON.stringify({
                            type: 'command:ack',
                            cmdId,
                            status: 'received',
                            prompt: msg.prompt || msg.url,
                            ts: Date.now()
                        }));

                        if (this.commandHandler) {
                            try {
                                const result = await this.commandHandler(msg, ws);
                                ws.send(JSON.stringify({
                                    type: 'command:result',
                                    cmdId,
                                    status: 'success',
                                    result,
                                    ts: Date.now()
                                }));
                            } catch (err) {
                                ws.send(JSON.stringify({
                                    type: 'command:result',
                                    cmdId,
                                    status: 'error',
                                    error: err.message,
                                    ts: Date.now()
                                }));
                            }
                        } else {
                            ws.send(JSON.stringify({
                                type: 'command:result',
                                cmdId,
                                status: 'error',
                                error: 'No command handler registered on MessageBus',
                                ts: Date.now()
                            }));
                        }
                    }
                } catch (e) {
                    console.error('[MessageBus] Error parsing WS message:', e.message);
                }
            });
        });

        console.log('[MessageBus] Bi-directional WebSocket whiteboard active on ws://127.0.0.1:9223/ws');
    }

    /** Register a handler for inbound WS commands */
    onCommand(handler) {
        this.commandHandler = handler;
    }

    /**
     * Broadcast an event to all connected WebSocket clients.
     * @param {string} type  - Event type, e.g. 'tab:changed', 'ai:chunk', 'navigate'
     * @param {any}    payload - JSON-serializable data
     */
    broadcast(type, payload = {}) {
        const envelope = JSON.stringify({ type, payload, ts: Date.now() });

        // Append to in-memory log (ring buffer)
        this.eventLog.push({ type, payload, ts: Date.now() });
        if (this.eventLog.length > this.MAX_LOG) this.eventLog.shift();

        for (const ws of this.clients) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(envelope);
            }
        }
    }

    /** Returns the number of connected clients */
    get connectionCount() { return this.clients.size; }

    /** Returns recent event log (for /api/ws-log endpoint) */
    getLog() { return [...this.eventLog]; }
}

module.exports = MessageBus;

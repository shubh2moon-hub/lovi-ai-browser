/**
 * LOVI AI Browser — API Engine (Bring Your Own LLM)
 * Inspired by BrowserOS BYOLLM feature.
 * Drop-in replacement for ai/engine.js that uses any OpenAI-compatible endpoint.
 * Supports: Ollama, LM Studio, OpenRouter, Gemini, OpenAI, custom API.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const CONFIG_FILE = path.join(__dirname, '../data/llm-config.json');
const DEFAULT_CONFIG = {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:4b',
    apiKey: '',
    contextWindow: 20000,
    temperature: 0.7,
    maxTokens: 2048
};

class APIEngine {
    constructor() {
        this.config = this._loadConfig();
        this.isReady = false;
    }

    _loadConfig() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
            }
        } catch {}
        return { ...DEFAULT_CONFIG };
    }

    saveConfig(newConfig) {
        const config = { ...this.config, ...newConfig };
        this.config = config;
        const dataDir = path.dirname(CONFIG_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return config;
    }

    getConfig() {
        return { ...this.config, apiKey: this.config.apiKey ? '***' : '' };
    }

    async initialize(onProgress) {
        // Test the connection to the configured endpoint
        try {
            if (onProgress) onProgress({ status: 'checking', message: `Connecting to ${this.config.provider}...` });
            await this._listModels();
            this.isReady = true;
            if (onProgress) onProgress({ status: 'ready', message: `Connected to ${this.config.provider} (${this.config.model})` });
            return true;
        } catch (err) {
            this.isReady = false;
            if (onProgress) onProgress({ status: 'error', message: `Cannot connect to ${this.config.provider}: ${err.message}` });
            return false;
        }
    }

    async _listModels() {
        const url = `${this.config.baseUrl}/models`;
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const transport = parsed.protocol === 'https:' ? https : http;
            const req = transport.get({
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname,
                headers: this._headers(),
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(JSON.parse(data)));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        });
    }

    _headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.config.apiKey) h['Authorization'] = `Bearer ${this.config.apiKey}`;
        return h;
    }

    /**
     * Generate a response from the LLM.
     * @param {Array} messages - Array of { role, content } objects
     * @param {Function} onToken - callback(token) for streaming
     * @returns {Promise<string>} - full response text
     */
    async generate(messages, onToken) {
        if (!this.isReady) {
            // Try lazy initialization
            const ok = await this.initialize();
            if (!ok) throw new Error(`APIEngine: Cannot connect to ${this.config.provider}`);
        }

        const body = JSON.stringify({
            model: this.config.model,
            messages,
            stream: !!onToken,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens
        });

        return new Promise((resolve, reject) => {
            const url = new URL(`${this.config.baseUrl}/chat/completions`);
            const transport = url.protocol === 'https:' ? https : http;
            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    ...this._headers(),
                    'Content-Length': Buffer.byteLength(body)
                },
                timeout: 120000
            };

            const req = transport.request(options, (res) => {
                let fullText = '';

                if (onToken) {
                    // Streaming SSE
                    res.on('data', (chunk) => {
                        const lines = chunk.toString().split('\n');
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const raw = line.slice(6).trim();
                            if (raw === '[DONE]') continue;
                            try {
                                const parsed = JSON.parse(raw);
                                const delta = parsed.choices?.[0]?.delta?.content || '';
                                if (delta) {
                                    fullText += delta;
                                    onToken(delta);
                                }
                            } catch {}
                        }
                    });
                    res.on('end', () => resolve(fullText));
                } else {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed.choices?.[0]?.message?.content || '');
                        } catch (e) { reject(e); }
                    });
                }
            });

            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
            req.write(body);
            req.end();
        });
    }
}

module.exports = APIEngine;

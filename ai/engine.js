const path = require('path');
const fs = require('fs');

class AIEngine {
    constructor(modelsDir, config = {}) {
        this.modelsDir = modelsDir || path.join(__dirname, '..', 'models');
        this.modelRepo = config.repo || 'bartowski/Qwen2.5-1.5B-Instruct-GGUF';
        this.modelFile = config.file || 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf';
        this.modelUrl = `https://huggingface.co/${this.modelRepo}/resolve/main/${this.modelFile}`;
        this.modelPath = path.join(this.modelsDir, this.modelFile);

        this.llama = null;
        this.model = null;
        this.context = null;
        this.session = null;

        this.status = 'idle'; // idle | downloading | loading | ready | generating | error
        this.downloadProgress = 0; // 0..100
        this.statusListeners = [];
        this.abortController = null;
    }

    onStatusChange(listener) {
        this.statusListeners.push(listener);
    }

    _setStatus(status, extra = {}) {
        this.status = status;
        const data = { status, progress: this.downloadProgress, ...extra };
        this.statusListeners.forEach((fn) => fn(data));
    }

    async isDownloaded() {
        return fs.existsSync(this.modelPath) && fs.statSync(this.modelPath).size > 100 * 1024 * 1024;
    }

    /**
     * Download Qwen 2.5 1.5B GGUF if not already present
     */
    async downloadModel() {
        if (await this.isDownloaded()) {
            this.downloadProgress = 100;
            return;
        }

        if (!fs.existsSync(this.modelsDir)) {
            fs.mkdirSync(this.modelsDir, { recursive: true });
        }

        this._setStatus('downloading', { progress: 0 });

        try {
            const { createModelDownloader } = await import('node-llama-cpp');
            const downloader = await createModelDownloader({
                modelUri: this.modelUrl,
                dirPath: this.modelsDir,
                fileName: this.modelFile,
                showCliProgress: false,
                onProgress: (status) => {
                    const percent = status.totalSize > 0 
                        ? Math.round((status.downloadedSize / status.totalSize) * 100) 
                        : 0;
                    this.downloadProgress = percent;
                    this._setStatus('downloading', { 
                        progress: percent, 
                        downloaded: status.downloadedSize, 
                        total: status.totalSize 
                    });
                }
            });

            await downloader.download();
            this.downloadProgress = 100;
        } catch (err) {
            console.error('[AIEngine] Download error:', err);
            this._setStatus('error', { error: `Download failed: ${err.message}` });
            throw err;
        }
    }

    /**
     * Load model into memory (lazy initialization)
     */
    async init() {
        if (this.status === 'ready' || this.model) return;

        try {
            await this.downloadModel();

            this._setStatus('loading');
            const { getLlama } = await import('node-llama-cpp');

            this.llama = await getLlama();
            this.model = await this.llama.loadModel({
                modelPath: this.modelPath,
            });

            this.context = await this.model.createContext({
                contextSize: 4096, // 4k context window
            });

            this.sequence = this.context.getSequence();

            this._setStatus('ready');
            console.log('[AIEngine] Qwen 2.5 1.5B loaded successfully');
        } catch (err) {
            console.error('[AIEngine] Initialization error:', err);
            this._setStatus('error', { error: `Model loading failed: ${err.message}` });
            throw err;
        }
    }

    /**
     * Generate response with streamed tokens
     * @param {Array<{role: string, content: string}>} messages
     * @param {Function} onChunk - (chunkText) => void
     * @param {Object} options - Additional generation options { schema: Object }
     */
    async generate(messages, onChunk, options = {}) {
        if (!this.model || !this.context || !this.sequence) {
            await this.init();
        }

        this._setStatus('generating');
        this.abortController = new AbortController();

        try {
            const { LlamaChatSession } = await import('node-llama-cpp');
            
            // Extract the system prompt if available
            const systemMsg = messages.find(m => m.role === 'system');
            
            // Clear context sequence for a fresh start 
            this.sequence.clearHistory();

            const session = new LlamaChatSession({
                contextSequence: this.sequence,
                systemPrompt: systemMsg ? systemMsg.content : undefined
            });

            // Replay standard chat messages if they exist (skipping the system prompt)
            const chatHistory = messages.filter(m => m.role !== 'system');
            const lastUserMsg = chatHistory.pop();
            const promptText = lastUserMsg ? lastUserMsg.content : '';

            // If there's prior history, feed it directly (if we need to support past messages)
            if (chatHistory.length > 0) {
                session.setChatHistory(chatHistory.map(m => {
                    if (m.role === 'assistant') {
                        return { type: 'model', response: [m.content] };
                    }
                    return { type: m.role, text: m.content };
                }));
            }

            let fullText = '';
            
            const promptOptions = {
                signal: this.abortController.signal,
                onTextChunk: (chunk) => {
                    fullText += chunk;
                    if (onChunk) onChunk(chunk);
                },
            };

            // Force JSON output if a schema is provided
            if (options.schema) {
                const { LlamaJsonSchemaGrammar } = await import('node-llama-cpp');
                const grammar = new LlamaJsonSchemaGrammar(this.llama, options.schema);
                promptOptions.responseFormat = grammar;
            }

            await session.prompt(promptText, promptOptions);

            // Clean up corporate AI disclaimers if generated by LLM
            let cleanedText = fullText
                .replace(/(?:I'm sorry,?\s*)?As an AI(?: language model)?,?\s*(?:I (?:don't|do not) have (?:personal )?(?:preferences|emotions|feelings)[^\.\n]*[\.\n]?)?/gi, '')
                .replace(/(?:I'm sorry,?\s*)?(?:as an AI language model,?\s*|as an AI,?\s*)?I (?:don't|do not) (?:have the capability to|cannot|am not able to) (?:browse|access|take you to)[^\.\n]*[\.\n]?/gi, '')
                .replace(/As an AI language model,?\s*/gi, '')
                .replace(/As an AI,?\s*/gi, '')
                .replace(/^However,?\s*/i, '')
                .replace(/^,\s*/, '')
                .trim();

            this._setStatus('ready');
            return cleanedText;
        } catch (err) {
            if (err.name === 'AbortError' || this.abortController?.signal?.aborted) {
                console.log('[AIEngine] Generation aborted by user');
                this._setStatus('ready');
                return '';
            }
            console.error('[AIEngine] Generation error:', err);
            this._setStatus('error', { error: err.message });
            throw err;
        } finally {
            this.abortController = null;
        }
    }

    stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    async dispose() {
        this.stop();
        if (this.context) {
            await this.context.dispose();
            this.context = null;
        }
        if (this.model) {
            await this.model.dispose();
            this.model = null;
        }
        this._setStatus('idle');
    }
}

module.exports = AIEngine;

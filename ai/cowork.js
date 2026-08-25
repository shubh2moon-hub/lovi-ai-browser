/**
 * LOVI AI Browser — Cowork Module (Sandboxed Filesystem Access)
 * Inspired by BrowserOS Cowork feature.
 * Grants agent read/write access to a user-selected folder, sandboxed to that root.
 */

const fs = require('fs');
const path = require('path');

class Cowork {
    constructor() {
        this.rootFolder = null;
    }

    setFolder(folderPath) {
        if (!fs.existsSync(folderPath)) {
            throw new Error(`Folder does not exist: ${folderPath}`);
        }
        this.rootFolder = path.resolve(folderPath);
        return this.rootFolder;
    }

    clearFolder() {
        this.rootFolder = null;
    }

    getFolder() {
        return this.rootFolder;
    }

    isActive() {
        return !!this.rootFolder;
    }

    /** Resolve and validate a path is within the sandbox root */
    _resolve(filePath) {
        if (!this.rootFolder) throw new Error('No Cowork folder selected. Please pick a folder first.');
        const resolved = path.resolve(this.rootFolder, filePath);
        if (!resolved.startsWith(this.rootFolder)) {
            throw new Error('Access denied: path is outside the Cowork folder.');
        }
        return resolved;
    }

    /** Read a file (text) */
    readFile(filePath) {
        const abs = this._resolve(filePath);
        if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);
        return fs.readFileSync(abs, 'utf8');
    }

    /** Write or overwrite a text file */
    writeFile(filePath, content) {
        const abs = this._resolve(filePath);
        const dir = path.dirname(abs);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return abs;
    }

    /** Append text to a file */
    appendFile(filePath, content) {
        const abs = this._resolve(filePath);
        fs.appendFileSync(abs, content, 'utf8');
        return abs;
    }

    /** List directory contents */
    listDir(dirPath = '.') {
        const abs = this._resolve(dirPath);
        if (!fs.existsSync(abs)) throw new Error(`Directory not found: ${dirPath}`);
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size: e.isFile() ? fs.statSync(path.join(abs, e.name)).size : null
        }));
    }

    /** Check if a path exists */
    exists(filePath) {
        try {
            const abs = this._resolve(filePath);
            return fs.existsSync(abs);
        } catch { return false; }
    }

    /** Delete a file */
    deleteFile(filePath) {
        const abs = this._resolve(filePath);
        if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);
        fs.unlinkSync(abs);
        return true;
    }

    /** Get a human-readable summary of the active Cowork folder */
    getSummary() {
        if (!this.rootFolder) return 'No Cowork folder selected.';
        let fileCount = 0;
        try {
            const entries = fs.readdirSync(this.rootFolder);
            fileCount = entries.length;
        } catch {}
        return `Cowork folder: ${this.rootFolder} (${fileCount} items at root). You can READ_FILE, WRITE_FILE, APPEND_FILE, LIST_DIR, and DELETE_FILE within this folder.`;
    }
}

module.exports = Cowork;

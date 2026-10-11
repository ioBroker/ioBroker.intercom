"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogTail = exports.TlsFailureMonitor = void 0;
exports.mapLevel = mapLevel;
exports.classifyMessage = classifyMessage;
exports.parseLogLines = parseLogLines;
/**
 * Follows the log file of Asterisk and hands every message over with its ioBroker log level.
 *
 * The file lives in a bind mount of the container, where change events are not reliable on all
 * hosts, so it is polled. Asterisk does not rotate it in the container: the reader truncates it
 * when it grows too big (Asterisk writes with O_APPEND and continues at the new end).
 */
const node_fs_1 = require("node:fs");
/** `[2026-10-09 10:12:13.123] WARNING[1234][C-00000001] res_pjsip.c: text` */
const LINE = /^\[[^\]]*\]\s+([A-Z_]+)\[\d+\](?:\[[^\]]*\])?:?\s?(.*)$/;
function mapLevel(asteriskLevel) {
    switch (asteriskLevel) {
        case 'ERROR':
            return 'error';
        case 'WARNING':
        case 'SECURITY':
            return 'warn';
        case 'NOTICE':
            return 'info';
        default:
            // VERBOSE, DEBUG, DTMF, ...
            return 'debug';
    }
}
/** `tcptls.c: Unable to set up ssl connection with peer '192.168.1.6:59161'` */
const TLS_PEER = /^tcptls\.c: Unable to set up ssl connection with peer '\[?([^'\]]+?)\]?:\d+'/;
/**
 * Messages of connections that a client closed early: follow-ups of an aborted TLS handshake, and a
 * WebSocket that was closed without a close frame (tab closed or reloaded). Also the DTLS packets that a
 * browser sends at the start of every call before ICE is through - Asterisk drops them, the browser repeats
 * them. They carry no information.
 */
const CONNECTION_NOISE = /^(?:iostream\.c: (?:SSL_shutdown\(\) failed|Problem setting up ssl connection)|res_http_websocket\.c: Error reading from web socket|res_rtp_asterisk\.c: [^ ]+ DTLS packet from \S+ dropped\. ICE not completed yet)/;
/**
 * Adjust messages whose level of Asterisk is misleading.
 * Browsers open spare TLS connections and close them during the handshake - Chrome especially for a
 * self-signed certificate accepted by an exception - and Asterisk reports each of them with three
 * errors, although everything works. They are debug messages; whether a client really cannot connect
 * is decided by `TlsFailureMonitor`.
 *
 * @param message parsed message
 * @returns the message with an adjusted level, and the address of the client if a TLS handshake failed
 */
function classifyMessage(message) {
    const peer = TLS_PEER.exec(message.text);
    if (peer) {
        return { message: { ...message, level: 'debug' }, tlsPeer: peer[1] };
    }
    if (CONNECTION_NOISE.test(message.text)) {
        return { message: { ...message, level: 'debug' } };
    }
    return { message };
}
/**
 * Decides whether the aborted TLS handshakes of a client are worth a warning: a client that does not
 * accept the certificate retries endlessly, the spare connections of a browser come only now and then.
 */
class TlsFailureMonitor {
    #failures = new Map();
    #warned = new Map();
    #threshold;
    #window;
    /**
     * @param threshold failures of one client within the window that are worth a warning
     * @param window length of the window in ms, also the minimal time between two warnings per client
     */
    constructor(threshold = 20, window = 10 * 60_000) {
        this.#threshold = threshold;
        this.#window = window;
    }
    /**
     * Count a failure
     *
     * @param peer address of the client
     * @param now current time in ms
     * @returns true if a warning should be written now
     */
    record(peer, now = Date.now()) {
        const recent = (this.#failures.get(peer) || []).filter(ts => now - ts < this.#window);
        recent.push(now);
        this.#failures.set(peer, recent);
        const lastWarning = this.#warned.get(peer);
        if (recent.length < this.#threshold || (lastWarning !== undefined && now - lastWarning < this.#window)) {
            return false;
        }
        this.#warned.set(peer, now);
        return true;
    }
}
exports.TlsFailureMonitor = TlsFailureMonitor;
/**
 * Parse complete lines of the log. Lines without a prefix (e.g. SIP messages of `pjsip set logger`)
 * belong to the message before them.
 *
 * @param lines complete lines
 * @param pending a message that may still get continuation lines; it is extended in place
 * @returns the finished messages and the message that is still open
 */
function parseLogLines(lines, pending = null) {
    const messages = [];
    let current = pending;
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const m = LINE.exec(line);
        if (m) {
            if (current) {
                messages.push(current);
            }
            current = { level: mapLevel(m[1]), asteriskLevel: m[1], text: m[2].trimEnd() };
        }
        else if (current) {
            if (line.trim()) {
                current.text += `\n${line.trimEnd()}`;
            }
        }
        else if (line.trim()) {
            messages.push({ level: 'debug', asteriskLevel: '', text: line.trimEnd() });
        }
    }
    return { messages, pending: current };
}
class LogTail {
    #options;
    #position = -1;
    #rest = '';
    #pending = null;
    #timer = null;
    #reading = false;
    #windowStart = 0;
    #windowCount = 0;
    #skipped = 0;
    constructor(options) {
        this.#options = { interval: 1000, maxSize: 2 * 1024 * 1024, maxPerSecond: 50, ...options };
    }
    /** Start at the current end of the file: old messages are not repeated after a restart */
    start() {
        this.stop();
        this.#position = -1;
        this.#timer = setInterval(() => void this.#poll(), this.#options.interval);
        void this.#poll();
    }
    stop() {
        if (this.#timer) {
            clearInterval(this.#timer);
            this.#timer = null;
        }
        if (this.#pending) {
            this.#emit(this.#pending);
            this.#pending = null;
        }
        this.#reportSkipped(true);
    }
    async #poll() {
        if (this.#reading) {
            return;
        }
        this.#reading = true;
        try {
            await this.#read();
        }
        catch {
            // the file does not exist (yet) - Asterisk creates it with the first message
        }
        finally {
            this.#reading = false;
        }
        this.#reportSkipped(false);
    }
    /** Report the skipped messages once the window of one second is over (or always on stop) */
    #reportSkipped(force) {
        if (this.#skipped && (force || Date.now() - this.#windowStart >= 1000)) {
            this.#options.onSkipped?.(this.#skipped);
            this.#skipped = 0;
        }
    }
    async #read() {
        const { size } = await node_fs_1.promises.stat(this.#options.file);
        if (this.#position < 0 || size < this.#position) {
            // first poll: skip the history; smaller file: it was truncated or replaced
            this.#position = this.#position < 0 ? size : 0;
            this.#rest = '';
        }
        if (size > this.#position) {
            const handle = await node_fs_1.promises.open(this.#options.file, 'r');
            try {
                // never more than 1 MB at once
                const length = Math.min(size - this.#position, 1024 * 1024);
                const buffer = Buffer.alloc(length);
                const { bytesRead } = await handle.read(buffer, 0, length, this.#position);
                this.#position += bytesRead;
                const text = this.#rest + buffer.subarray(0, bytesRead).toString('utf8');
                const lines = text.split('\n');
                this.#rest = lines.pop() || '';
                const { messages, pending } = parseLogLines(lines, this.#pending);
                this.#pending = pending;
                messages.forEach(m => this.#emit(m));
            }
            finally {
                await handle.close();
            }
        }
        else if (this.#pending) {
            // nothing new: the last message is complete
            this.#emit(this.#pending);
            this.#pending = null;
        }
        if (this.#position >= this.#options.maxSize) {
            await node_fs_1.promises.truncate(this.#options.file, 0);
            this.#position = 0;
            this.#rest = '';
        }
    }
    #emit(message) {
        const now = Date.now();
        if (now - this.#windowStart >= 1000) {
            this.#reportSkipped(true);
            this.#windowStart = now;
            this.#windowCount = 0;
        }
        // errors are never dropped
        if (++this.#windowCount > this.#options.maxPerSecond && message.level !== 'error') {
            this.#skipped++;
            return;
        }
        this.#options.onMessage(message);
    }
}
exports.LogTail = LogTail;
//# sourceMappingURL=logTail.js.map
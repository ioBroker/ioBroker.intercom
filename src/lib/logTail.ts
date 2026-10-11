/**
 * Follows the log file of Asterisk and hands every message over with its ioBroker log level.
 *
 * The file lives in a bind mount of the container, where change events are not reliable on all
 * hosts, so it is polled. Asterisk does not rotate it in the container: the reader truncates it
 * when it grows too big (Asterisk writes with O_APPEND and continues at the new end).
 */
import { promises as fs } from 'node:fs';

export type IobLogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface AsteriskLogMessage {
    level: IobLogLevel;
    /** Level as written by Asterisk, e.g. `WARNING` */
    asteriskLevel: string;
    /** Source and message, without the date, e.g. `chan_pjsip.c: ...` */
    text: string;
}

/** `[2026-10-09 10:12:13.123] WARNING[1234][C-00000001] res_pjsip.c: text` */
const LINE = /^\[[^\]]*\]\s+([A-Z_]+)\[\d+\](?:\[[^\]]*\])?:?\s?(.*)$/;

export function mapLevel(asteriskLevel: string): IobLogLevel {
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
const CONNECTION_NOISE =
    /^(?:iostream\.c: (?:SSL_shutdown\(\) failed|Problem setting up ssl connection)|res_http_websocket\.c: Error reading from web socket|res_rtp_asterisk\.c: [^ ]+ DTLS packet from \S+ dropped\. ICE not completed yet)/;

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
export function classifyMessage(message: AsteriskLogMessage): { message: AsteriskLogMessage; tlsPeer?: string } {
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
export class TlsFailureMonitor {
    readonly #failures = new Map<string, number[]>();
    readonly #warned = new Map<string, number>();
    readonly #threshold: number;
    readonly #window: number;

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
    record(peer: string, now = Date.now()): boolean {
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

/**
 * Parse complete lines of the log. Lines without a prefix (e.g. SIP messages of `pjsip set logger`)
 * belong to the message before them.
 *
 * @param lines complete lines
 * @param pending a message that may still get continuation lines; it is extended in place
 * @returns the finished messages and the message that is still open
 */
export function parseLogLines(
    lines: string[],
    pending: AsteriskLogMessage | null = null,
): { messages: AsteriskLogMessage[]; pending: AsteriskLogMessage | null } {
    const messages: AsteriskLogMessage[] = [];
    let current = pending;
    for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const m = LINE.exec(line);
        if (m) {
            if (current) {
                messages.push(current);
            }
            current = { level: mapLevel(m[1]), asteriskLevel: m[1], text: m[2].trimEnd() };
        } else if (current) {
            if (line.trim()) {
                current.text += `\n${line.trimEnd()}`;
            }
        } else if (line.trim()) {
            messages.push({ level: 'debug', asteriskLevel: '', text: line.trimEnd() });
        }
    }
    return { messages, pending: current };
}

export interface LogTailOptions {
    file: string;
    onMessage: (message: AsteriskLogMessage) => void;
    /** Poll interval in ms */
    interval?: number;
    /** Truncate the file when it is bigger (bytes) */
    maxSize?: number;
    /** Maximal number of messages per second, the rest is counted and reported */
    maxPerSecond?: number;
    onSkipped?: (count: number) => void;
}

export class LogTail {
    readonly #options: Required<Omit<LogTailOptions, 'onSkipped'>> & Pick<LogTailOptions, 'onSkipped'>;
    #position = -1;
    #rest = '';
    #pending: AsteriskLogMessage | null = null;
    #timer: NodeJS.Timeout | null = null;
    #reading = false;
    #windowStart = 0;
    #windowCount = 0;
    #skipped = 0;

    constructor(options: LogTailOptions) {
        this.#options = { interval: 1000, maxSize: 2 * 1024 * 1024, maxPerSecond: 50, ...options };
    }

    /** Start at the current end of the file: old messages are not repeated after a restart */
    start(): void {
        this.stop();
        this.#position = -1;
        this.#timer = setInterval(() => void this.#poll(), this.#options.interval);
        void this.#poll();
    }

    stop(): void {
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

    async #poll(): Promise<void> {
        if (this.#reading) {
            return;
        }
        this.#reading = true;
        try {
            await this.#read();
        } catch {
            // the file does not exist (yet) - Asterisk creates it with the first message
        } finally {
            this.#reading = false;
        }
        this.#reportSkipped(false);
    }

    /** Report the skipped messages once the window of one second is over (or always on stop) */
    #reportSkipped(force: boolean): void {
        if (this.#skipped && (force || Date.now() - this.#windowStart >= 1000)) {
            this.#options.onSkipped?.(this.#skipped);
            this.#skipped = 0;
        }
    }

    async #read(): Promise<void> {
        const { size } = await fs.stat(this.#options.file);
        if (this.#position < 0 || size < this.#position) {
            // first poll: skip the history; smaller file: it was truncated or replaced
            this.#position = this.#position < 0 ? size : 0;
            this.#rest = '';
        }
        if (size > this.#position) {
            const handle = await fs.open(this.#options.file, 'r');
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
            } finally {
                await handle.close();
            }
        } else if (this.#pending) {
            // nothing new: the last message is complete
            this.#emit(this.#pending);
            this.#pending = null;
        }

        if (this.#position >= this.#options.maxSize) {
            await fs.truncate(this.#options.file, 0);
            this.#position = 0;
            this.#rest = '';
        }
    }

    #emit(message: AsteriskLogMessage): void {
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

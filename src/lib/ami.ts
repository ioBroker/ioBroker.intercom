/**
 * Minimal Asterisk Manager Interface client.
 *
 * The protocol is line based: after a one-line banner (`Asterisk Call Manager/x.y.z`) every message
 * is a block of `Key: Value` lines terminated by an empty line (`\r\n\r\n`). Responses carry the
 * `ActionID` of their action; list actions answer with `EventList: start`, followed by events with
 * the same `ActionID` and a final event with `EventList: Complete`.
 */
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';

export type AmiMessage = Record<string, string>;

export interface AmiLogger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

export interface AmiOptions {
    host: string;
    port: number;
    username: string;
    secret: string;
    log: AmiLogger;
    /** Timeout of one action in ms */
    actionTimeout?: number;
}

export interface AmiResponse {
    response: AmiMessage;
    /** Events of a list action */
    events: AmiMessage[];
}

/** Splits the TCP stream into AMI messages. Handles messages that are fragmented over several packets */
export class AmiParser {
    #buffer = '';
    #bannerDone = false;

    /**
     * Feed a chunk of data
     *
     * @param chunk data received from the socket
     * @returns the banner (once) and all complete messages
     */
    feed(chunk: string): { banner?: string; messages: AmiMessage[] } {
        this.#buffer += chunk;
        const result: { banner?: string; messages: AmiMessage[] } = { messages: [] };

        if (!this.#bannerDone) {
            const pos = this.#buffer.indexOf('\r\n');
            if (pos === -1) {
                return result;
            }
            result.banner = this.#buffer.substring(0, pos);
            this.#buffer = this.#buffer.substring(pos + 2);
            this.#bannerDone = true;
        }

        let end: number;
        while ((end = this.#buffer.indexOf('\r\n\r\n')) !== -1) {
            const block = this.#buffer.substring(0, end);
            this.#buffer = this.#buffer.substring(end + 4);
            const message = AmiParser.parseBlock(block);
            if (Object.keys(message).length) {
                result.messages.push(message);
            }
        }
        return result;
    }

    reset(): void {
        this.#buffer = '';
        this.#bannerDone = false;
    }

    /** Parse one block. Repeated keys (like `Output` of a `Command`) are joined with `\n` */
    static parseBlock(block: string): AmiMessage {
        const message: AmiMessage = {};
        for (const line of block.split('\r\n')) {
            const pos = line.indexOf(':');
            if (pos <= 0) {
                continue;
            }
            const key = line.substring(0, pos).trim();
            const value = line.substring(pos + 1).replace(/^ /, '');
            message[key] = message[key] !== undefined ? `${message[key]}\n${value}` : value;
        }
        return message;
    }

    /** Serialize an action. Line breaks in values are removed, so no header can be injected */
    static serialize(fields: Record<string, string | number>): string {
        let text = '';
        for (const [key, value] of Object.entries(fields)) {
            text += `${key.replace(/[\r\n:]/g, '')}: ${String(value).replace(/[\r\n]/g, ' ')}\r\n`;
        }
        return `${text}\r\n`;
    }
}

interface PendingAction {
    resolve: (res: AmiResponse) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    response?: AmiMessage;
    events: AmiMessage[];
}

/**
 * Events:
 * - `connected` (banner: string) after a successful login
 * - `disconnected`
 * - `event` (message: AmiMessage) for every unsolicited event
 */
export class AmiClient extends EventEmitter {
    readonly #options: AmiOptions;
    #socket: Socket | null = null;
    readonly #parser = new AmiParser();
    readonly #pending = new Map<string, PendingAction>();
    #actionCounter = 0;
    #reconnectTimer: NodeJS.Timeout | null = null;
    #backoff = 2000;
    #stopped = true;
    #connected = false;
    #lastError = '';

    constructor(options: AmiOptions) {
        super();
        this.#options = options;
    }

    get connected(): boolean {
        return this.#connected;
    }

    start(): void {
        this.#stopped = false;
        this.#connect();
    }

    async stop(): Promise<void> {
        this.#stopped = true;
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        if (this.#socket && this.#connected) {
            try {
                await Promise.race([this.action({ Action: 'Logoff' }), new Promise(r => setTimeout(r, 500))]);
            } catch {
                // ignore
            }
        }
        this.#socket?.destroy();
        this.#socket = null;
        this.#cleanup('Client stopped');
    }

    /** Force a new connection, e.g. after `manager reload` */
    reconnect(): void {
        this.#socket?.destroy();
    }

    /**
     * Send an action and wait for its response (and for all events of a list action)
     *
     * @param fields action fields, at least `Action`
     */
    action(fields: Record<string, string | number>): Promise<AmiResponse> {
        return new Promise((resolve, reject) => {
            if (!this.#socket || this.#socket.destroyed) {
                reject(new Error('Not connected to AMI'));
                return;
            }
            const actionId = `iob-${++this.#actionCounter}`;
            const timer = setTimeout(() => {
                this.#pending.delete(actionId);
                reject(new Error(`AMI action ${fields.Action} timed out`));
            }, this.#options.actionTimeout || 10000);
            this.#pending.set(actionId, { resolve, reject, timer, events: [] });
            this.#socket.write(AmiParser.serialize({ ...fields, ActionID: actionId }));
        });
    }

    /** Send `Command` and return its output */
    async command(command: string): Promise<string> {
        const { response } = await this.action({ Action: 'Command', Command: command });
        if (response.Response === 'Error') {
            throw new Error(response.Message || `Command "${command}" failed`);
        }
        return response.Output || '';
    }

    #connect(): void {
        if (this.#stopped) {
            return;
        }
        this.#parser.reset();
        const socket = new Socket();
        this.#socket = socket;
        socket.setEncoding('utf8');
        socket.setKeepAlive(true, 30000);
        socket.setTimeout(15000);

        socket.on('timeout', () => {
            if (!this.#connected) {
                socket.destroy(new Error('Connection timeout'));
            }
        });
        socket.on('data', (data: string) => this.#onData(data));
        socket.on('error', err => {
            const text = err.message;
            if (text !== this.#lastError) {
                this.#options.log.debug(`AMI connection error: ${text}`);
                this.#lastError = text;
            }
        });
        socket.on('close', () => {
            if (this.#socket === socket) {
                this.#socket = null;
            }
            const wasConnected = this.#connected;
            this.#cleanup('Connection closed');
            if (wasConnected) {
                this.#options.log.warn('Connection to Asterisk AMI lost');
                this.emit('disconnected');
            }
            this.#scheduleReconnect();
        });
        socket.connect(this.#options.port, this.#options.host);
    }

    #scheduleReconnect(): void {
        if (this.#stopped || this.#reconnectTimer) {
            return;
        }
        const delay = this.#backoff;
        this.#backoff = Math.min(this.#backoff * 2, 60000);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = null;
            this.#connect();
        }, delay);
    }

    #cleanup(reason: string): void {
        this.#connected = false;
        for (const [id, pending] of this.#pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
            this.#pending.delete(id);
        }
    }

    #onData(data: string): void {
        const { banner, messages } = this.#parser.feed(data);
        if (banner !== undefined) {
            void this.#login(banner);
        }
        for (const message of messages) {
            this.#onMessage(message);
        }
    }

    async #login(banner: string): Promise<void> {
        if (!banner.startsWith('Asterisk Call Manager')) {
            this.#options.log.warn(`Unexpected AMI banner: ${banner}`);
        }
        try {
            const { response } = await this.action({
                Action: 'Login',
                Username: this.#options.username,
                Secret: this.#options.secret,
                Events: 'on',
            });
            if (response.Response !== 'Success') {
                // Do not log the secret, only the answer of Asterisk
                this.#options.log.error(`AMI login failed: ${response.Message || 'unknown reason'}`);
                this.#socket?.destroy();
                return;
            }
            this.#connected = true;
            this.#backoff = 2000;
            this.#lastError = '';
            this.#socket?.setTimeout(0);
            this.emit('connected', banner);
        } catch (e) {
            this.#options.log.warn(`AMI login error: ${(e as Error).message}`);
            this.#socket?.destroy();
        }
    }

    #onMessage(message: AmiMessage): void {
        const actionId = message.ActionID;
        const pending = actionId ? this.#pending.get(actionId) : undefined;

        if (!pending) {
            if (message.Event) {
                this.emit('event', message);
            }
            return;
        }

        if (message.Response !== undefined && !pending.response) {
            pending.response = message;
            // A list action continues with events, anything else is done now
            if ((message.EventList || '').toLowerCase() !== 'start') {
                this.#finish(actionId, pending);
            }
            return;
        }

        if (message.Event) {
            if ((message.EventList || '').toLowerCase() === 'complete') {
                this.#finish(actionId, pending);
            } else {
                pending.events.push(message);
            }
        }
    }

    #finish(actionId: string, pending: PendingAction): void {
        clearTimeout(pending.timer);
        this.#pending.delete(actionId);
        pending.resolve({ response: pending.response || {}, events: pending.events });
    }
}

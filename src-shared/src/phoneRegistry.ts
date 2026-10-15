/**
 * The running phones of one page, shared by the widgets and by the background service of the host.
 *
 * A widget of vis-2 or a tile of the devices app exists only while its view or category is shown. A phone owned
 * by it would be offline - and could not ring - as soon as another one is open. So the phones live here: whoever
 * needs one (a widget, a tile, the background service) acquires it and releases it when done. The first one
 * creates the phone, the last one destroys it, so a phone held by the service stays registered while the widgets
 * come and go. The same extension in several widgets is one phone and one registration.
 *
 * The registry also decides who shows the dialog of a call: exactly one holder, so a call does not open two
 * dialogs. The service wins, it is always there; without a service the holder that came first.
 *
 * No React and no SipPhone in here (only their types), so the logic runs in the unit tests as it is.
 */
import type { CallState } from '../../src-www/src/SipPhone';

/** What the registry needs of a phone; SipPhone in the browser, a fake in the tests */
export interface RegistryPhone {
    subscribe(listener: () => void): () => void;
    getSnapshot(): { call: CallState };
    unlockAudio(): void;
    destroy(): void;
}

/** Everything that makes a phone different from another one */
export interface PhoneConfig {
    wssUrl: string;
    extension: string;
    password: string;
    video: boolean;
    camera: boolean;
}

export interface HolderOptions {
    /** Held by the background service of the host, not by a widget */
    service: boolean;
    /** Open the dialog by itself when a call comes in or goes out */
    popup: boolean;
}

export interface DialogState {
    /** Id of the holder that shows the dialog, 0: nobody */
    owner: number;
    open: boolean;
}

export interface PhoneHandle<P extends RegistryPhone = RegistryPhone> {
    /** Compare with `getDialog().owner`: this holder shows the dialog */
    readonly id: number;
    readonly phone: P;
    /** For `useSyncExternalStore`, like the phone itself */
    subscribeDialog(listener: () => void): () => void;
    getDialog(): DialogState;
    /** Open the dialog, also without a call (e.g. a click on a small tile) */
    showDialog(): void;
    /** Close the dialog; a running call stays minimized until the next one */
    closeDialog(): void;
    release(): void;
}

export interface RegistryOptions {
    /**
     * The phone is destroyed only so long after the last release. A tile of the devices app is mounted again when
     * it is dragged to another place, a widget when its settings change - neither should end a running call.
     */
    graceMs?: number;
}

/** Holders of one phone */
class Entry<P extends RegistryPhone> {
    readonly phone: P;
    /** In the order of acquisition */
    readonly holders = new Map<number, HolderOptions>();
    /** Pending destruction after the last release */
    destroyTimer: ReturnType<typeof setTimeout> | null = null;

    readonly #listeners = new Set<() => void>();
    readonly #unsubscribe: () => void;
    #dialog: DialogState = { owner: 0, open: false };
    #call: CallState;
    /** Counts the calls, so that a call minimized in the dialog does not keep the next one minimized */
    #callId = 0;
    #minimizedCall = 0;
    /** Opened by hand */
    #shown = false;

    constructor(phone: P) {
        this.phone = phone;
        this.#call = phone.getSnapshot().call;
        this.#unsubscribe = phone.subscribe(this.#onPhone);
    }

    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    getDialog = (): DialogState => this.#dialog;

    show(): void {
        this.#shown = true;
        this.update();
    }

    close(): void {
        this.#shown = false;
        this.#minimizedCall = this.#callId;
        this.update();
    }

    /** Find the owner of the dialog and whether it is open */
    update(): void {
        let owner = 0;
        let popup = false;
        for (const [id, holder] of this.holders) {
            if (holder.service && !this.holders.get(owner)?.service) {
                owner = id;
            } else if (!owner) {
                owner = id;
            }
            popup ||= holder.popup;
        }
        const open =
            !!owner && (this.#shown || (popup && this.#call !== 'none' && this.#minimizedCall !== this.#callId));
        if (owner !== this.#dialog.owner || open !== this.#dialog.open) {
            this.#dialog = { owner, open };
            this.#listeners.forEach(listener => listener());
        }
    }

    destroy(): void {
        this.#unsubscribe();
        this.#listeners.clear();
        this.phone.destroy();
    }

    #onPhone = (): void => {
        const call = this.phone.getSnapshot().call;
        if (call !== this.#call) {
            if (this.#call === 'none') {
                this.#callId++;
            }
            this.#call = call;
            this.update();
        }
    };
}

/** The key of a phone: holders with the same settings get the same phone */
export function phoneKey(config: PhoneConfig): string {
    return JSON.stringify([config.wssUrl, config.extension, config.password, config.video, config.camera]);
}

export class PhoneRegistry<P extends RegistryPhone> {
    readonly #create: (config: PhoneConfig) => P;
    readonly #graceMs: number;
    readonly #entries = new Map<string, Entry<P>>();
    #lastId = 0;

    /**
     * @param create creates and logs in a phone
     * @param options see RegistryOptions
     */
    constructor(create: (config: PhoneConfig) => P, options?: RegistryOptions) {
        this.#create = create;
        this.#graceMs = options?.graceMs ?? 2000;
    }

    /** Number of phones, also the ones waiting for their destruction */
    get size(): number {
        return this.#entries.size;
    }

    acquire(config: PhoneConfig, options: HolderOptions): PhoneHandle<P> {
        const key = phoneKey(config);
        let entry = this.#entries.get(key);
        if (!entry) {
            entry = new Entry(this.#create(config));
            this.#entries.set(key, entry);
        } else if (entry.destroyTimer) {
            clearTimeout(entry.destroyTimer);
            entry.destroyTimer = null;
        }
        const id = ++this.#lastId;
        entry.holders.set(id, { ...options });
        entry.update();

        const own = entry;
        let released = false;
        return {
            id,
            phone: own.phone,
            subscribeDialog: own.subscribe,
            getDialog: own.getDialog,
            showDialog: () => own.show(),
            closeDialog: () => own.close(),
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                own.holders.delete(id);
                own.update();
                if (!own.holders.size) {
                    own.destroyTimer = setTimeout(() => {
                        own.destroyTimer = null;
                        if (!own.holders.size && this.#entries.get(key) === own) {
                            this.#entries.delete(key);
                            own.destroy();
                        }
                    }, this.#graceMs);
                }
            },
        };
    }

    /** The browser plays sound only after a click or a key into the page */
    unlockAudio(): void {
        this.#entries.forEach(entry => entry.phone.unlockAudio());
    }
}

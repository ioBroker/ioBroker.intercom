/**
 * Snapshot proxy: fetches the pictures of the configured cameras and hands them over as data URLs.
 * During a call (a subscriber is ringing or talking) fast, otherwise slowly or not at all.
 */
import { createHash } from 'node:crypto';
import type { Snapshot, SnapshotAuth } from './snapshot';

export interface CameraSettings {
    /** Part of the object ID: `cameras.<id>.image` */
    id: string;
    url: string;
    auth: SnapshotAuth;
    user: string;
    password: string;
    insecure: boolean;
    /** Seconds between two pictures during a call */
    interval: number;
    /** Seconds between two pictures without a call, 0 = none */
    idleInterval: number;
}

export interface CameraRow {
    enabled?: boolean;
    name?: string;
    url?: string;
    auth?: string;
    user?: string;
    /** Already decrypted */
    password?: string;
    insecure?: boolean;
    interval?: number | string;
    idleInterval?: number | string;
}

const AUTHS: SnapshotAuth[] = ['none', 'basic', 'apikey', 'bearer'];

/** Object ID part of a camera name: `Haustür 1` → `haust_r_1` */
export function cameraId(name: string): string {
    return String(name ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .substring(0, 32);
}

function seconds(value: unknown, def: number, min: number): number {
    const n = Number(value);
    if (value === '' || value === undefined || value === null || !Number.isFinite(n)) {
        return def;
    }
    return n <= 0 ? 0 : Math.max(min, Math.min(3600, n));
}

/** Validate the rows of the settings table: invalid, duplicate and disabled entries are dropped */
export function validateCameras(rows: (CameraRow | null | undefined)[]): {
    cameras: CameraSettings[];
    warnings: string[];
} {
    const cameras: CameraSettings[] = [];
    const warnings: string[] = [];
    for (const row of rows || []) {
        if (!row || !row.enabled) {
            continue;
        }
        const id = cameraId(row.name || '');
        if (!id || /^_+$/.test(id)) {
            warnings.push('Camera without name skipped');
            continue;
        }
        if (cameras.some(c => c.id === id)) {
            warnings.push(`Camera "${id}" skipped: duplicate name`);
            continue;
        }
        let url: URL;
        try {
            url = new URL(String(row.url || '').trim());
        } catch {
            warnings.push(`Camera "${id}" skipped: invalid URL`);
            continue;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            warnings.push(`Camera "${id}" skipped: only http and https URLs are supported`);
            continue;
        }
        cameras.push({
            id,
            url: url.toString(),
            auth: AUTHS.includes(row.auth as SnapshotAuth) ? (row.auth as SnapshotAuth) : 'none',
            user: String(row.user || ''),
            password: String(row.password || ''),
            insecure: row.insecure !== false,
            // at least 0.5 s: faster only loads the camera and the states database
            interval: seconds(row.interval, 1, 0.5) || 1,
            idleInterval: seconds(row.idleInterval, 10, 1),
        });
    }
    return { cameras, warnings };
}

export interface CameraPollerOptions {
    cameras: CameraSettings[];
    fetch: (camera: CameraSettings) => Promise<Snapshot>;
    /** A new picture (only called when it changed) */
    onImage: (camera: CameraSettings, dataUrl: string) => void;
    /** Error text, or '' when the camera works again. Only called on a change */
    onError: (camera: CameraSettings, error: string) => void;
}

interface CameraState {
    timer: ReturnType<typeof setTimeout> | null;
    busy: boolean;
    hash: string;
    error: string | null;
}

export class CameraPoller {
    readonly #options: CameraPollerOptions;
    readonly #state = new Map<string, CameraState>();
    #active = false;
    #running = false;

    constructor(options: CameraPollerOptions) {
        this.#options = options;
        for (const camera of options.cameras) {
            this.#state.set(camera.id, { timer: null, busy: false, hash: '', error: null });
        }
    }

    get active(): boolean {
        return this.#active;
    }

    start(): void {
        this.#running = true;
        // one picture at the start, so the state is not empty
        this.#options.cameras.forEach(camera => this.#schedule(camera, 0));
    }

    stop(): void {
        this.#running = false;
        for (const state of this.#state.values()) {
            if (state.timer) {
                clearTimeout(state.timer);
                state.timer = null;
            }
        }
    }

    /**
     * A call starts or ends. At the start of a call a picture is fetched at once.
     *
     * @param active a subscriber is ringing or talking
     */
    setActive(active: boolean): void {
        if (active === this.#active) {
            return;
        }
        this.#active = active;
        if (!this.#running) {
            return;
        }
        for (const camera of this.#options.cameras) {
            this.#schedule(camera, active ? 0 : this.#delay(camera));
        }
    }

    /** Delay until the next picture in ms, -1 = none */
    #delay(camera: CameraSettings): number {
        const s = this.#active ? camera.interval : camera.idleInterval;
        return s > 0 ? s * 1000 : -1;
    }

    #schedule(camera: CameraSettings, delay: number): void {
        const state = this.#state.get(camera.id)!;
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        if (!this.#running || delay < 0) {
            return;
        }
        state.timer = setTimeout(() => {
            state.timer = null;
            void this.#poll(camera);
        }, delay);
    }

    async #poll(camera: CameraSettings): Promise<void> {
        const state = this.#state.get(camera.id)!;
        if (state.busy) {
            return;
        }
        state.busy = true;
        const started = Date.now();
        try {
            const snapshot = await this.#options.fetch(camera);
            const hash = createHash('sha1').update(snapshot.data).digest('hex');
            if (state.error !== '') {
                state.error = '';
                this.#options.onError(camera, '');
            }
            if (hash !== state.hash) {
                state.hash = hash;
                this.#options.onImage(
                    camera,
                    `data:${snapshot.contentType};base64,${snapshot.data.toString('base64')}`,
                );
            }
        } catch (e) {
            const error = (e as Error).message || String(e);
            if (state.error !== error) {
                state.error = error;
                this.#options.onError(camera, error);
            }
        } finally {
            state.busy = false;
        }
        if (!state.timer) {
            const delay = this.#delay(camera);
            // the time of the request counts into the interval
            this.#schedule(camera, delay < 0 ? -1 : Math.max(0, delay - (Date.now() - started)));
        }
    }
}

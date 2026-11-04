/**
 * Tells the snapshot proxy of the adapter which camera pictures are shown, so that it fetches them only then.
 *
 * Every page has its own viewer ID and writes it into `<instance>.cameras.<camera>.watch` every 10 s while it shows
 * the picture, and `-<viewer ID>` when it stops. The adapter counts the IDs, so any number of browsers can show the
 * same picture, and a browser that is closed without a word drops out after 30 s. Several widgets of one page that
 * show the same camera share one lease.
 *
 * Plain TypeScript without imports at runtime, so that the unit tests can load it.
 */
import type { PhoneHost } from './phoneSettings';

/** The adapter forgets a viewer after 30 s: renew in time even if one write gets lost */
export const WATCH_RENEW = 10_000;

/** `intercom.0.cameras.door.image` → `intercom.0.cameras.door.watch`; '' for a state of another adapter */
export function watchStateOf(imageId: string): string {
    const match = /^(intercom\.\d+\.cameras\.[^.]+)\.image$/.exec(String(imageId || '').trim());
    return match ? `${match[1]}.watch` : '';
}

interface Watch {
    host: PhoneHost;
    count: number;
}

export interface CameraWatcher {
    /** Start showing the picture: returns the function that stops it */
    acquire(host: PhoneHost, watchId: string): () => void;
}

interface Environment {
    viewer: string;
    /** false: the page is hidden, the browser throttles its timers anyway */
    isVisible(): boolean;
    onVisibilityChange(handler: () => void): void;
    setInterval(handler: () => void, ms: number): unknown;
    clearInterval(timer: unknown): void;
}

/** For the tests; the pages use `acquireCameraWatch` */
export function createCameraWatcher(env: Environment): CameraWatcher {
    const watches = new Map<string, Watch>();
    let timer: unknown = null;

    const write = (id: string, watch: Watch, watching: boolean): void => {
        try {
            void Promise.resolve(watch.host.setState(id, watching ? env.viewer : `-${env.viewer}`)).catch(() => {
                // no write access or adapter too old: the picture is fetched as before
            });
        } catch {
            // the socket is not connected yet; the next renewal will do it
        }
    };

    const renewAll = (): void => {
        if (env.isVisible()) {
            watches.forEach((watch, id) => write(id, watch, true));
        }
    };

    env.onVisibilityChange(() => watches.forEach((watch, id) => write(id, watch, env.isVisible())));

    return {
        acquire(host: PhoneHost, watchId: string): () => void {
            let watch = watches.get(watchId);
            if (watch) {
                watch.count++;
            } else {
                watch = { host, count: 1 };
                watches.set(watchId, watch);
                if (env.isVisible()) {
                    write(watchId, watch, true);
                }
                timer ??= env.setInterval(renewAll, WATCH_RENEW);
            }
            let released = false;
            return () => {
                const current = watches.get(watchId);
                if (released || !current) {
                    return;
                }
                released = true;
                if (--current.count <= 0) {
                    watches.delete(watchId);
                    write(watchId, current, false);
                    if (!watches.size && timer !== null) {
                        env.clearInterval(timer);
                        timer = null;
                    }
                }
            };
        },
    };
}

let pageWatcher: CameraWatcher | null = null;

/**
 * The picture of `watchId` is shown on this page from now on. Returns the function to call when it is not shown
 * any more.
 *
 * @param host - the states of ioBroker
 * @param watchId - `<instance>.cameras.<camera>.watch`, see `watchStateOf`
 */
export function acquireCameraWatch(host: PhoneHost, watchId: string): () => void {
    pageWatcher ??= createCameraWatcher({
        viewer: `${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
        isVisible: () => document.visibilityState !== 'hidden',
        onVisibilityChange: handler => document.addEventListener('visibilitychange', handler),
        setInterval: (handler, ms) => window.setInterval(handler, ms),
        clearInterval: timer => window.clearInterval(timer as number),
    });
    return pageWatcher.acquire(host, watchId);
}

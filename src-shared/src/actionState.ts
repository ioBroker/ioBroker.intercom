/**
 * The state of the action button, e.g. of a door opener: set to `true`, and after a while back to `false` if wanted -
 * no script needed for it.
 *
 * The time runs in the page that pressed the button: a page closed before it is up leaves the state `true`. A second
 * press before that starts the time anew, so the state does not drop back in the middle of the second pulse.
 *
 * Plain TypeScript without imports at runtime, so that the unit tests can load it.
 */
import type { PhoneHost } from './phoneSettings';

/** Seconds after which the state goes back to `false`, 0: it stays `true`. vis-2 delivers numbers as strings */
export function resetSeconds(value: unknown): number {
    const seconds = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

interface Timers {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
}

export interface ActionStates {
    /**
     * Set the state to `true`, and after `seconds` back to `false`
     *
     * @param host - the states of ioBroker
     * @param id - the state
     * @param seconds - 0: it stays `true`
     */
    press(host: Pick<PhoneHost, 'setState'>, id: string, seconds: number): void;
}

/** For the tests; the pages use `pressActionState` */
export function createActionStates(timers: Timers): ActionStates {
    /** Resets to come, by state */
    const pending = new Map<string, unknown>();

    const write = (host: Pick<PhoneHost, 'setState'>, id: string, value: boolean): void => {
        try {
            void Promise.resolve(host.setState(id, value)).catch(() => {
                // no write access: the host reports it
            });
        } catch {
            // not connected
        }
    };

    return {
        press(host, id, seconds): void {
            const timer = pending.get(id);
            if (timer !== undefined) {
                timers.clearTimeout(timer);
                pending.delete(id);
            }
            write(host, id, true);
            if (seconds > 0) {
                const own = timers.setTimeout(() => {
                    if (pending.get(id) === own) {
                        pending.delete(id);
                        write(host, id, false);
                    }
                }, seconds * 1000);
                pending.set(id, own);
            }
        },
    };
}

let pageStates: ActionStates | null = null;

/**
 * The action button was pressed: its state becomes `true`, and after `seconds` `false` again
 *
 * @param host - the states of ioBroker
 * @param id - the state of the action
 * @param seconds - 0: it stays `true`
 */
export function pressActionState(host: Pick<PhoneHost, 'setState'>, id: string, seconds: number): void {
    pageStates ??= createActionStates({
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: timer => window.clearTimeout(timer as number),
    });
    pageStates.press(host, id, seconds);
}

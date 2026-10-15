import { useEffect, useState, useSyncExternalStore } from 'react';

import type { PhoneSnapshot, SipPhone } from '../../src-www/src/SipPhone';
import type { DialogState, PhoneHandle } from './phoneRegistry';
import { phones } from './phones';
import { flag, resolvePhone, type PhoneHost, type PhoneProblem, type PhoneSettings } from './phoneSettings';

export type SipPhoneHandle = PhoneHandle<SipPhone>;

export interface UsePhoneResult {
    /** `null` while starting, in the editor and if a problem prevents the start */
    handle: SipPhoneHandle | null;
    problem: PhoneProblem;
    certUrl: string;
}

const NONE: UsePhoneResult = { handle: null, problem: '', certUrl: '' };

/**
 * The phone of these settings, from the registry: started by the first one who needs it, kept by the others.
 *
 * @param host - states of ioBroker
 * @param settings - of the widget
 * @param service - the background service asks, not a widget
 * @param enabled - false in the editor: no connection there
 */
export function usePhone(host: PhoneHost, settings: PhoneSettings, service: boolean, enabled = true): UsePhoneResult {
    const popup = flag(settings.popup, true);
    // the settings that make another phone or another holder
    const key = JSON.stringify([
        settings.instance || '',
        settings.extension || '',
        settings.password || '',
        settings.wssUrl || '',
        settings.video ?? '',
        settings.useCamera ?? '',
        popup,
        enabled,
    ]);
    const [result, setResult] = useState<UsePhoneResult & { key: string }>({ ...NONE, key: '' });

    useEffect(() => {
        if (!enabled) {
            return;
        }
        let cancelled = false;
        let handle: SipPhoneHandle | null = null;
        void resolvePhone(host, settings).then(resolved => {
            if (cancelled) {
                return;
            }
            if (resolved.config) {
                handle = phones.acquire(resolved.config, { service, popup });
            }
            setResult({ handle, problem: resolved.problem, certUrl: resolved.certUrl, key });
        });
        return () => {
            cancelled = true;
            handle?.release();
        };
        // `key` stands for the settings
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [host, key, service]);

    // a result of other settings belongs to a released phone
    return enabled && result.key === key ? result : NONE;
}

/** Snapshot in the editor and before the start: the phone does not connect there, so it must not look online */
const OFFLINE: PhoneSnapshot = {
    registration: 'offline',
    error: '',
    extension: '',
    call: 'none',
    peer: '',
    callStart: 0,
    lastCallEnd: '',
    muted: false,
    stats: null,
    audioLocked: false,
    micActive: false,
    micLabel: '',
    cameraOn: false,
    cameraLabel: '',
    incomingVideo: false,
    localStream: null,
    remoteStream: null,
    remoteVideo: false,
    mediaError: '',
    log: [],
};

const noSubscribe = (): (() => void) => () => {};
const getOffline = (): PhoneSnapshot => OFFLINE;

export function usePhoneSnapshot(phone: SipPhone | null | undefined): PhoneSnapshot {
    return useSyncExternalStore(phone ? phone.subscribe : noSubscribe, phone ? phone.getSnapshot : getOffline);
}

const NO_DIALOG: DialogState = { owner: 0, open: false };
const getNoDialog = (): DialogState => NO_DIALOG;

/** Whether this holder shows the dialog of the phone, and whether it is open */
export function usePhoneDialog(handle: SipPhoneHandle | null): { owner: boolean; open: boolean } {
    const state = useSyncExternalStore(
        handle ? handle.subscribeDialog : noSubscribe,
        handle ? handle.getDialog : getNoDialog,
    );
    return { owner: !!handle && state.owner === handle.id, open: state.open };
}

/** Value of a state, e.g. the picture of a camera */
export function useStateValue(host: PhoneHost, id: string): unknown {
    const [value, setValue] = useState<{ id: string; val: unknown }>({ id: '', val: undefined });
    useEffect(() => {
        if (!id) {
            return;
        }
        return host.subscribeState(id, state => setValue({ id, val: state?.val }));
    }, [host, id]);
    return id && value.id === id ? value.val : undefined;
}

/**
 * Settings of a phone, the same for a widget of vis-2, a tile of the devices app and the background service.
 */
import type { PhoneConfig } from './phoneRegistry';

export const ADAPTER = 'intercom';

/** vis-2 delivers checkboxes and numbers as strings, the devices app as they are */
export interface PhoneSettings {
    title?: string;
    instance?: string;
    extension?: string;
    password?: string;
    /** Overrides `<instance>.info.wssUrl` */
    wssUrl?: string;
    number?: string;
    numberLabel?: string;
    showKeypad?: boolean | string;
    video?: boolean | string;
    /** The own camera may be used at all */
    useCamera?: boolean | string;
    sendCamera?: boolean | string;
    popup?: boolean | string;
    cameraOid?: string;
    cameraUrl?: string;
    cameraRefresh?: number | string;
    cameraAlways?: boolean | string;
    actionLabel?: string;
    actionDtmf?: string;
    actionOid?: string;
}

/** The states of ioBroker, as the page around the phone offers them */
export interface PhoneHost {
    getState(id: string): Promise<ioBroker.State | null | undefined>;
    setState(id: string, value: ioBroker.StateValue): Promise<void> | void;
    /** Calls the handler with the current value and with every change; returns the function to unsubscribe */
    subscribeState(id: string, handler: (state: ioBroker.State | null | undefined) => void): () => void;
}

/** The settings shown by the phone, not the ones that make another phone */
export interface PhoneViewOptions {
    /** Title in the header, empty: "Phone" */
    title: string;
    /** Number called by the call button, e.g. the door */
    number: string;
    /** Text of the call button instead of the number */
    numberLabel: string;
    showKeypad: boolean;
    /** Video calls are allowed: the picture of the other party is shown */
    video: boolean;
    /** The own camera may be used (only with video) */
    useCamera: boolean;
    /** Switch the own camera on with every call (only with useCamera) */
    sendCamera: boolean;
    /** Open a dialog for calls */
    popup: boolean;
    /** Picture of a camera (URL or data URL) */
    cameraSrc: string;
    cameraRefresh: number;
    /** Show the camera also without a call */
    cameraAlways: boolean;
    /** Extra button during a call, e.g. to open the door */
    actionLabel: string;
}

/** A problem that prevents the phone from starting, as a key of the translations */
export type PhoneProblem = '' | 'insecure' | 'no_config' | 'no_wss';

export interface ResolvedPhone {
    config: PhoneConfig | null;
    problem: PhoneProblem;
    /** Page to accept the self-signed certificate of Asterisk */
    certUrl: string;
}

/**
 * A checkbox. A setting that was never saved has its default: the devices app saves only what was changed in its
 * dialog, vis-2 saves the defaults when the widget is created.
 */
export function flag(value: unknown, def: boolean): boolean {
    if (value === undefined || value === null) {
        return def;
    }
    return value === true || value === 'true';
}

/** A state selected in the settings; vis-2 writes "nothing_selected" into an emptied field */
export function stateId(id: unknown): string {
    const value = typeof id === 'string' ? id.trim() : '';
    return value === 'nothing_selected' ? '' : value;
}

/**
 * @param settings - of the widget
 * @param cameraValue - value of the state `cameraOid`, a picture URL or a data URL
 */
export function getViewOptions(settings: PhoneSettings, cameraValue?: unknown): PhoneViewOptions {
    const video = flag(settings.video, true);
    const useCamera = video && flag(settings.useCamera, false);
    let cameraSrc = String(settings.cameraUrl || '').trim();
    if (stateId(settings.cameraOid) && typeof cameraValue === 'string' && cameraValue) {
        cameraSrc = cameraValue;
    }
    const refresh = settings.cameraRefresh;
    return {
        title: String(settings.title || ''),
        number: String(settings.number || '').trim(),
        numberLabel: String(settings.numberLabel || ''),
        showKeypad: flag(settings.showKeypad, true),
        video,
        useCamera,
        sendCamera: useCamera && flag(settings.sendCamera, false),
        popup: flag(settings.popup, true),
        cameraSrc,
        cameraRefresh: refresh === undefined || refresh === null || refresh === '' ? 1 : Number(refresh) || 0,
        cameraAlways: flag(settings.cameraAlways, false),
        actionLabel: String(settings.actionLabel || ''),
    };
}

/** Find out what the phone of these settings needs, and what prevents it from starting */
export async function resolvePhone(host: PhoneHost, settings: PhoneSettings): Promise<ResolvedPhone> {
    if (!window.isSecureContext || !navigator.mediaDevices) {
        return { config: null, problem: 'insecure', certUrl: '' };
    }
    const extension = String(settings.extension || '').trim();
    const password = String(settings.password || '');
    if (!extension || !password) {
        return { config: null, problem: 'no_config', certUrl: '' };
    }

    let wssUrl = String(settings.wssUrl || '').trim();
    if (!wssUrl) {
        try {
            const state = await host.getState(`${settings.instance || `${ADAPTER}.0`}.info.wssUrl`);
            wssUrl = typeof state?.val === 'string' ? state.val : '';
        } catch {
            // no access or no such instance
        }
    }
    let url: URL;
    try {
        url = new URL(wssUrl.replace(/^ws/, 'http'));
    } catch {
        return { config: null, problem: 'no_wss', certUrl: '' };
    }

    const video = flag(settings.video, true);
    return {
        config: { wssUrl, extension, password, video, camera: video && flag(settings.useCamera, false) },
        problem: '',
        certUrl: `https://${url.host}/static/cert.html`,
    };
}

/** The action button during a call, e.g. "Open door" */
export function runAction(
    host: PhoneHost,
    phone: { sendDtmf(tones: string): void } | null,
    settings: PhoneSettings,
): void {
    if (settings.actionDtmf) {
        phone?.sendDtmf(String(settings.actionDtmf));
    }
    const id = stateId(settings.actionOid);
    if (id) {
        void host.setState(id, true);
    }
}

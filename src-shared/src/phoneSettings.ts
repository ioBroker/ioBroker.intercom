/**
 * Settings of a phone, the same for a widget of vis-2, a tile of the devices app and the background service.
 */
import { watchStateOf } from './cameraWatch';
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
    /** Where the picture comes from: `url` (URL or state, the default) or `frigate` */
    cameraSource?: CameraSourceKind;
    cameraOid?: string;
    cameraUrl?: string;
    /** Instance of the frigate adapter, e.g. `frigate.0` */
    cameraFrigateInstance?: string;
    /** Name of the camera in Frigate */
    cameraFrigateCamera?: string;
    cameraFrigateMode?: FrigateMode;
    cameraRefresh?: number | string;
    cameraAlways?: boolean | string;
    /** A second picture, e.g. of the driveway: during a call the picture can be switched */
    camera2Source?: CameraSourceKind;
    camera2Oid?: string;
    camera2Url?: string;
    camera2FrigateInstance?: string;
    camera2FrigateCamera?: string;
    camera2FrigateMode?: FrigateMode;
    camera2Refresh?: number | string;
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
    /** A message to an adapter instance, e.g. the pictures of the frigate adapter */
    sendTo(instance: string, command: string, data: unknown): Promise<unknown>;
}

export type CameraSourceKind = 'url' | 'frigate';

/** `snapshot`: single pictures over the socket; `stream`: the MJPEG stream of the web extension of frigate */
export type FrigateMode = 'snapshot' | 'stream';

/** Where the picture of a camera comes from */
export type CameraSource =
    | {
          kind: 'url';
          /** URL of a snapshot or of an MJPEG stream, or a data URL; '' while the adapter has no picture yet */
          src: string;
          /** Seconds between two snapshots, 0: load once */
          refresh: number;
          /** A picture of the snapshot proxy of the adapter: tell it while the picture is shown */
          watch?: string;
      }
    | {
          kind: 'frigate';
          /** Instance of the frigate adapter, e.g. `frigate.0` */
          instance: string;
          /** Name of the camera in Frigate */
          camera: string;
          mode: FrigateMode;
          /** Seconds between two snapshots */
          refresh: number;
      };

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
    /** The configured cameras, the first and the second one; switchable during a call */
    cameras: CameraSource[];
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

/** Seconds between two snapshots; never saved: 1 */
function refreshSeconds(refresh: number | string | undefined): number {
    return refresh === undefined || refresh === null || refresh === '' ? 1 : Number(refresh) || 0;
}

/** The settings of one camera, without the prefix `camera` or `camera2` */
interface CameraSettings {
    source?: CameraSourceKind;
    url?: string;
    oid?: string;
    frigateInstance?: string;
    frigateCamera?: string;
    frigateMode?: FrigateMode;
    refresh?: number | string;
}

/**
 * One camera of the settings, `null` if it is not configured
 *
 * @param camera - the settings of this camera
 * @param value - value of the state `oid`, a picture URL or a data URL
 */
function getCameraSource(camera: CameraSettings, value: unknown): CameraSource | null {
    const refresh = refreshSeconds(camera.refresh);
    if (camera.source === 'frigate') {
        const name = String(camera.frigateCamera || '').trim();
        if (!name) {
            return null;
        }
        return {
            kind: 'frigate',
            instance: String(camera.frigateInstance || '').trim() || 'frigate.0',
            camera: name,
            mode: camera.frigateMode === 'stream' ? 'stream' : 'snapshot',
            refresh,
        };
    }
    // the value of the state wins over the URL
    const oid = stateId(camera.oid);
    const src = oid && typeof value === 'string' && value ? value : String(camera.url || '').trim();
    // the snapshot proxy fetches the picture only while it is shown, so its state may still be empty
    const watch = watchStateOf(oid);
    if (watch) {
        return { kind: 'url', src, refresh, watch };
    }
    return src ? { kind: 'url', src, refresh } : null;
}

/**
 * @param settings - of the widget
 * @param cameraValue - value of the state `cameraOid`, a picture URL or a data URL
 * @param camera2Value - value of the state `camera2Oid`
 */
export function getViewOptions(
    settings: PhoneSettings,
    cameraValue?: unknown,
    camera2Value?: unknown,
): PhoneViewOptions {
    const video = flag(settings.video, true);
    const useCamera = video && flag(settings.useCamera, false);
    return {
        title: String(settings.title || ''),
        number: String(settings.number || '').trim(),
        numberLabel: String(settings.numberLabel || ''),
        showKeypad: flag(settings.showKeypad, true),
        video,
        useCamera,
        sendCamera: useCamera && flag(settings.sendCamera, false),
        popup: flag(settings.popup, true),
        cameras: [
            getCameraSource(
                {
                    source: settings.cameraSource,
                    url: settings.cameraUrl,
                    oid: settings.cameraOid,
                    frigateInstance: settings.cameraFrigateInstance,
                    frigateCamera: settings.cameraFrigateCamera,
                    frigateMode: settings.cameraFrigateMode,
                    refresh: settings.cameraRefresh,
                },
                cameraValue,
            ),
            getCameraSource(
                {
                    source: settings.camera2Source,
                    url: settings.camera2Url,
                    oid: settings.camera2Oid,
                    frigateInstance: settings.camera2FrigateInstance,
                    frigateCamera: settings.camera2FrigateCamera,
                    frigateMode: settings.camera2FrigateMode,
                    refresh: settings.camera2Refresh,
                },
                camera2Value,
            ),
        ].filter((camera): camera is CameraSource => !!camera),
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

/**
 * "Decline" ends the ringing on all devices of the subscriber, e.g. in the other browsers, not only here
 *
 * @param host - the adapters of ioBroker
 * @param settings - of the widget
 */
export function declineEverywhere(host: PhoneHost, settings: PhoneSettings): void {
    const extension = String(settings.extension || '').trim();
    if (extension) {
        host.sendTo(String(settings.instance || `${ADAPTER}.0`), 'decline', { extension }).catch(() => {
            // an adapter too old to know the command: only this device stops ringing
        });
    }
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

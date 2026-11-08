/**
 * The phone of the intercom adapter as a web component: `<iob-intercom-phone>`.
 *
 * One module for every host - Aura, admin, and vis-2 and devices where no native widget is (`@iobroker/web-components`).
 * Its manifest is a file of its own (`intercom-phone.json`, written by the build from `manifest.ts`), so a host loads
 * this module only when it shows the element. The host sets `socket` and `settings`, and if it has them `theme`,
 * `editMode` and `dialogs`.
 *
 * It is the phone of the vis-2 widget and the devices tile: audio and video calls over WebRTC with JsSIP
 * (`src-www/src/SipPhone.ts`), the picture of a door camera, and a dialog that opens for calls. Extension and password
 * are settings, as in the native widgets; the address of Asterisk comes from the state `<instance>.info.wssUrl`, the
 * certificate page from that address. All elements of a page with the same extension share one phone and one
 * registration (`src-shared/src/phoneRegistry.ts`), and only one of them opens the dialog of a call.
 *
 * The phone lives while the element is in the document: a host without a background service (as vis-2 and devices
 * have for their native widgets) rings only while the element is shown.
 *
 * React is not in the module: it comes from `lib/esm/react-19.js` beside `adapter/`, see `vite.config.ts`.
 */
import { createRoot, type Root } from 'react-dom/client';

import { DIALOG_CLOSE_EVENT } from '@iobroker/web-components';
import { defineWebComponent, getThemeCssVariables, IobWebComponent } from '@iobroker/web-components/element';

import { phones } from '../../src-shared/src/phones';
import {
    ADAPTER,
    declineEverywhere,
    flag,
    getViewOptions,
    resolvePhone,
    runAction,
    stateId,
    type PhoneHost,
    type PhoneProblem,
} from '../../src-shared/src/phoneSettings';
import type { SipPhoneHandle } from '../../src-shared/src/usePhone';
import { LAYOUTS, TAG, type PhoneElementSettings, type PhoneLayout, type WordKey } from './constants';
import { PhoneView, type PhoneViewProps } from './PhoneView';
import { DIALOG_STYLES, STYLES } from './styles';
import { word } from './words';

/** The size of the dialog of a call, as the dialog of the vis-2 widget; the host gives less on a small screen */
const DIALOG_SIZE = { width: 420, height: 720 };

/** The phone in a dialog of the host */
interface OpenDialog {
    element: HTMLElement;
    root: Root;
    /** Closed by the element (the call ended), not by the user */
    closedHere: boolean;
}

function instanceOf(settings: PhoneElementSettings): string {
    return String(settings.instance || '').trim() || `${ADAPTER}.0`;
}

/** The state with the address of Asterisk, if the settings do not name one */
function wssStateOf(settings: PhoneElementSettings): string {
    return String(settings.wssUrl || '').trim() ? '' : `${instanceOf(settings)}.info.wssUrl`;
}

/**
 * The problem of the settings that the editor can show without a connection
 *
 * @param settings of the element
 */
function previewProblem(settings: PhoneElementSettings): PhoneProblem {
    if (!String(settings.extension || '').trim() || !settings.password) {
        return 'no_config';
    }
    return '';
}

class IntercomPhoneElement extends IobWebComponent<PhoneElementSettings> {
    readonly #root: Root;

    /** The states and adapters of ioBroker for the phone, through the socket of the host */
    readonly #host: PhoneHost;

    /** The phone of the registry; `null` in edit mode, without settings and while it starts */
    #handle: SipPhoneHandle | null = null;

    /** The settings the phone was asked for; '' while none is wanted */
    #phoneKey = '';

    /** What prevents the phone from starting, and where to accept the certificate of Asterisk */
    #resolved: { problem: PhoneProblem; certUrl: string } = { problem: '', certUrl: '' };

    #unsubscribeDialog: (() => void) | null = null;

    #dialog: OpenDialog | null = null;

    constructor() {
        super();
        const shadow = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLES;
        const mount = document.createElement('div');
        mount.className = 'mount';
        shadow.append(style, mount);
        this.#root = createRoot(mount);

        this.#host = {
            getState: id => this.socket?.getState(id) ?? Promise.resolve(null),
            // not in edit mode: the base class refuses it there
            setState: (id, value) => this.setState(id, value),
            subscribeState: (id, handler) => {
                const socket = this.socket;
                if (!socket) {
                    return () => {};
                }
                const onChange: ioBroker.StateChangeHandler = (_id, state) => handler(state);
                socket.subscribeState(id, onChange).catch(() => {});
                return () => socket.unsubscribeState(id, onChange);
            },
            sendTo: (instance, command, data) =>
                this.socket ? this.socket.sendTo(instance, command, data) : Promise.reject(new Error('No connection')),
        };
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        // the registry keeps the phone for a moment: a host that moves the element does not end a call
        this.#releasePhone();
        this.#phoneKey = '';
    }

    /** The pictures of the cameras from states, and the address of Asterisk */
    protected override getStateIds(settings: PhoneElementSettings): string[] {
        const ids = [wssStateOf(settings)];
        if (settings.cameraSource !== 'frigate') {
            ids.push(stateId(settings.cameraOid));
        }
        if (settings.camera2Source !== 'frigate') {
            ids.push(stateId(settings.camera2Oid));
        }
        return ids;
    }

    protected override render(): void {
        this.#syncPhone();
        this.#draw();
    }

    /** Asks the registry for the phone of the settings - again whenever they or the address of Asterisk change */
    #syncPhone(): void {
        const settings = this.settings;
        let key = '';
        const wssState = wssStateOf(settings);
        // in edit mode there is no connection; the address of Asterisk is awaited, else the phone would start twice
        if (this.socket && this.isConnected && !this.editMode && (!wssState || this.states[wssState] !== undefined)) {
            key = JSON.stringify([
                instanceOf(settings),
                settings.extension || '',
                settings.password || '',
                settings.wssUrl || '',
                settings.video ?? '',
                settings.useCamera ?? '',
                flag(settings.popup, true),
                wssState ? (this.states[wssState]?.val ?? null) : null,
            ]);
        }
        if (key === this.#phoneKey) {
            return;
        }
        this.#releasePhone();
        this.#phoneKey = key;
        if (!key) {
            return;
        }
        void resolvePhone(this.#host, settings).then(resolved => {
            if (this.#phoneKey !== key) {
                return;
            }
            this.#resolved = { problem: resolved.problem, certUrl: resolved.certUrl };
            if (resolved.config) {
                const handle = phones.acquire(resolved.config, { service: false, popup: flag(settings.popup, true) });
                this.#handle = handle;
                this.#unsubscribeDialog = handle.subscribeDialog(this.#syncDialog);
            }
            this.#draw();
            this.#syncDialog();
        });
    }

    #releasePhone(): void {
        this.#unsubscribeDialog?.();
        this.#unsubscribeDialog = null;
        this.#closeDialog();
        this.#handle?.release();
        this.#handle = null;
        this.#resolved = { problem: '', certUrl: '' };
    }

    /** Opens or closes the dialog of the phone, as the registry decides: one holder of the phone shows it */
    #syncDialog = (): void => {
        const handle = this.#handle;
        const state = handle?.getDialog();
        const show = !!handle && state?.owner === handle.id && state.open && this.isConnected && !this.editMode;
        if (show && !this.#dialog) {
            void this.#openPhoneDialog(handle);
        } else if (!show && this.#dialog) {
            this.#closeDialog();
        }
    };

    /** The large phone in an element dialog of the host; closing it minimizes the call, as in the vis-2 widget */
    async #openPhoneDialog(handle: SipPhoneHandle): Promise<void> {
        const element = document.createElement('div');
        // the host moves the content into its dialog, out of this element: it takes the theme along
        this.#applyTheme(element);
        const shadow = element.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = DIALOG_STYLES;
        const mount = document.createElement('div');
        mount.className = 'mount';
        shadow.append(style, mount);
        const dialog: OpenDialog = { element, root: createRoot(mount), closedHere: false };
        this.#dialog = dialog;
        this.#drawDialog();
        try {
            await this.openDialog({ title: this.#viewProps('dialog').options.title, element, ...DIALOG_SIZE });
        } finally {
            dialog.root.unmount();
            if (this.#dialog === dialog) {
                this.#dialog = null;
            }
            if (!dialog.closedHere) {
                handle.closeDialog();
            }
        }
    }

    #closeDialog(): void {
        const dialog = this.#dialog;
        if (dialog) {
            dialog.closedHere = true;
            this.#dialog = null;
            dialog.element.dispatchEvent(
                new CustomEvent(DIALOG_CLOSE_EVENT, { detail: null, bubbles: true, composed: true }),
            );
        }
    }

    #applyTheme(element: HTMLElement): void {
        for (const [name, value] of Object.entries(getThemeCssVariables(this.theme))) {
            element.style.setProperty(name, value);
        }
    }

    #viewProps(layout: PhoneViewProps['layout']): PhoneViewProps {
        const settings = this.settings;
        const lang = this.systemLang;
        const preview = this.editMode;
        const problem = preview ? previewProblem(settings) : this.#resolved.problem;
        const cameraValue = this.states[stateId(settings.cameraOid)]?.val;
        const camera2Value = this.states[stateId(settings.camera2Oid)]?.val;
        const title = String(settings.title || '') || word('phone_widget', lang);
        return {
            handle: preview ? null : this.#handle,
            layout,
            preview,
            extension: String(settings.extension || ''),
            options: getViewOptions({ ...settings, title }, cameraValue, camera2Value),
            host: this.#host,
            word: (key: WordKey) => word(key, lang),
            problem: problem ? word(problem, lang) : '',
            certUrl: preview ? '' : this.#resolved.certUrl,
            onAction: () => {
                if (!this.editMode) {
                    runAction(this.#host, this.#handle?.phone || null, settings);
                }
            },
            onDecline: () => {
                if (!this.editMode) {
                    declineEverywhere(this.#host, settings);
                }
            },
            onOpen: () => {
                if (!this.editMode) {
                    this.#handle?.showDialog();
                }
            },
        };
    }

    #drawDialog(): void {
        if (this.#dialog) {
            this.#applyTheme(this.#dialog.element);
            this.#dialog.root.render(<PhoneView {...this.#viewProps('dialog')} />);
        }
    }

    #draw(): void {
        const layout: PhoneLayout = LAYOUTS.includes(this.settings.layout as PhoneLayout)
            ? (this.settings.layout as PhoneLayout)
            : 'auto';
        this.#root.render(<PhoneView {...this.#viewProps(layout)} />);
        this.#drawDialog();
    }
}

defineWebComponent(TAG, IntercomPhoneElement);

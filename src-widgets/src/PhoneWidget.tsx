import React from 'react';

import type { RxRenderWidgetProps, RxWidgetInfo, VisRxWidgetProps, VisRxWidgetState } from '@iobroker/types-vis-2';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import { SipPhone } from '../../src-www/src/SipPhone';
import { PhoneView, type PhoneViewOptions } from './PhoneView';

const ADAPTER = 'intercom';

interface PhoneRxData {
    title: string;
    instance: string;
    extension: string;
    password: string;
    /** Overrides `<instance>.info.wssUrl` */
    wssUrl: string;
    number: string;
    numberLabel: string;
    showKeypad: boolean;
    video: boolean;
    /** The own camera may be used at all */
    useCamera: boolean;
    sendCamera: boolean;
    popup: boolean;
    cameraOid: string;
    cameraUrl: string;
    cameraRefresh: number | string;
    cameraAlways: boolean;
    actionLabel: string;
    actionDtmf: string;
    actionOid: string;
}

interface PhoneWidgetState extends VisRxWidgetState {
    phone: SipPhone | null;
    /** Problem that prevents the phone from starting */
    problem: string;
    certUrl: string;
}

function bool(value: unknown): boolean {
    return value === true || value === 'true';
}

/**
 * Has the view open in the editor the option "Render always"? A `hidden` predicate gets only the data of the
 * widget, but vis-2 keeps the project and the view open in the editor (that is the view of the selected widget)
 * in `window.vis`.
 */
function viewAlwaysRendered(): boolean {
    const vis = window.vis as typeof window.vis | undefined;
    return !!vis?.views?.[vis.activeView]?.settings?.alwaysRender;
}

/**
 * Phone of the Asterisk adapter: audio and video calls over WebRTC, picture of a door camera,
 * and a dialog that pops up for incoming calls.
 */
export default class PhoneWidget extends (window.visRxWidget as typeof VisRxWidget)<PhoneRxData, PhoneWidgetState> {
    /**
     * The running phone. this.state.phone is only for rendering: it is updated asynchronously, and a phone
     * started in between would be overwritten without being stopped - and stay registered in the background.
     */
    private phone: SipPhone | null = null;
    /** Settings the running phone was created with */
    private phoneKey = '';
    private starting: Promise<void> | null = null;
    private unmounted = false;

    constructor(props: VisRxWidgetProps) {
        super(props);
        this.state = { ...this.state, phone: null, problem: '', certUrl: '' };
    }

    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: 'tplAsteriskPhone',
            visSet: ADAPTER,
            visSetIcon: `widgets/${ADAPTER}/img/intercom.svg`,
            visSetLabel: 'set_label',
            visSetColor: '#f57c00',
            visName: 'Phone',
            visWidgetLabel: 'phone_widget',
            visAttrs: [
                {
                    name: 'common',
                    fields: [
                        // vis-2 renders only the active view: the phone rings on other views only with this option
                        {
                            name: 'alwaysRenderHelp',
                            type: 'help',
                            text: 'always_render_hint',
                            hidden: viewAlwaysRendered,
                        },
                        { name: 'title', label: 'title', tooltip: 'title_tooltip' },
                        {
                            name: 'instance',
                            label: 'instance',
                            type: 'instance',
                            adapter: ADAPTER,
                            default: `${ADAPTER}.0`,
                        },
                        { name: 'extension', label: 'extension', default: '100' },
                        { name: 'password', label: 'password', type: 'password', tooltip: 'password_tooltip' },
                        { name: 'wssUrl', label: 'wss_url', tooltip: 'wss_url_tooltip' },
                    ],
                },
                {
                    name: 'call',
                    label: 'group_call',
                    fields: [
                        { name: 'number', label: 'number', tooltip: 'number_tooltip' },
                        { name: 'numberLabel', label: 'number_label' },
                        { name: 'showKeypad', label: 'show_keypad', type: 'checkbox', default: true },
                        { name: 'popup', label: 'popup', type: 'checkbox', default: true },
                        { name: 'video', label: 'video_calls', type: 'checkbox', default: true },
                        {
                            name: 'useCamera',
                            label: 'use_camera',
                            type: 'checkbox',
                            default: false,
                            tooltip: 'use_camera_tooltip',
                            hidden: '!data.video',
                        },
                        {
                            name: 'sendCamera',
                            label: 'send_camera',
                            type: 'checkbox',
                            default: false,
                            hidden: '!data.video || !data.useCamera',
                        },
                    ],
                },
                {
                    name: 'camera',
                    label: 'group_camera',
                    fields: [
                        { name: 'cameraUrl', label: 'camera_url', tooltip: 'camera_url_tooltip' },
                        { name: 'cameraOid', label: 'camera_oid', type: 'id', tooltip: 'camera_oid_tooltip' },
                        {
                            name: 'cameraRefresh',
                            label: 'camera_refresh',
                            type: 'number',
                            min: 0,
                            max: 60,
                            default: 1,
                            tooltip: 'camera_refresh_tooltip',
                        },
                        { name: 'cameraAlways', label: 'camera_always', type: 'checkbox', default: false },
                    ],
                },
                {
                    name: 'action',
                    label: 'group_action',
                    fields: [
                        { name: 'actionLabel', label: 'action_label', tooltip: 'action_label_tooltip' },
                        { name: 'actionDtmf', label: 'action_dtmf', hidden: '!data.actionLabel' },
                        { name: 'actionOid', label: 'action_oid', type: 'id', hidden: '!data.actionLabel' },
                    ],
                },
            ],
            visDefaultStyle: {
                width: 320,
                height: 420,
            },
            visPrev: `widgets/${ADAPTER}/img/intercom.svg`,
        };
    }

    // eslint-disable-next-line class-methods-use-this
    getWidgetInfo(): RxWidgetInfo {
        return PhoneWidget.getWidgetInfo();
    }

    static getI18nPrefix(): string {
        return `${ADAPTER}_`;
    }

    componentDidMount(): void {
        super.componentDidMount();
        this.unmounted = false;
        // the browser plays the ring tone only after the first click or key into the page
        document.addEventListener('pointerdown', this.unlockAudio, true);
        document.addEventListener('keydown', this.unlockAudio, true);
        void this.startPhone();
    }

    componentWillUnmount(): void {
        super.componentWillUnmount();
        this.unmounted = true;
        document.removeEventListener('pointerdown', this.unlockAudio, true);
        document.removeEventListener('keydown', this.unlockAudio, true);
        this.stopPhone();
    }

    onRxDataChanged(): void {
        void this.startPhone();
    }

    private unlockAudio = (): void => {
        this.phone?.unlockAudio();
    };

    private stopPhone(): void {
        this.phone?.destroy();
        this.phone = null;
        this.phoneKey = '';
    }

    /** Create, replace or remove the phone according to the settings */
    private async startPhone(): Promise<void> {
        // one start at a time; the last change wins
        while (this.starting) {
            await this.starting;
        }
        this.starting = this.doStartPhone();
        try {
            await this.starting;
        } finally {
            this.starting = null;
        }
        // unmounted while the start was waiting for the server
        if (this.unmounted) {
            this.stopPhone();
        }
    }

    private async doStartPhone(): Promise<void> {
        const data = this.state.rxData;
        if (this.props.editMode || this.unmounted) {
            this.stopPhone();
            this.setState({ phone: null, problem: '' });
            return;
        }
        if (!window.isSecureContext || !navigator.mediaDevices) {
            this.stopPhone();
            this.setState({ phone: null, problem: PhoneWidget.t('insecure') });
            return;
        }
        const extension = String(data.extension || '').trim();
        const password = String(data.password || '');
        if (!extension || !password) {
            this.stopPhone();
            this.setState({ phone: null, problem: PhoneWidget.t('no_config') });
            return;
        }

        let wssUrl = String(data.wssUrl || '').trim();
        if (!wssUrl) {
            const instance = data.instance || `${ADAPTER}.0`;
            try {
                const state = await this.props.context.socket.getState(`${instance}.info.wssUrl`);
                wssUrl = typeof state?.val === 'string' ? state.val : '';
            } catch {
                // no access or no such instance
            }
        }
        if (this.unmounted) {
            return;
        }
        let url: URL;
        try {
            url = new URL(wssUrl.replace(/^ws/, 'http'));
        } catch {
            this.stopPhone();
            this.setState({ phone: null, problem: PhoneWidget.t('no_wss') });
            return;
        }

        const video = bool(data.video);
        const camera = video && bool(data.useCamera);
        const key = JSON.stringify([wssUrl, extension, password, video, camera]);
        if (key === this.phoneKey && this.phone) {
            return;
        }
        this.stopPhone();
        const phone = new SipPhone({ wssUrl, domain: url.hostname, video, camera });
        this.phone = phone;
        this.phoneKey = key;
        this.setState({ phone, problem: '', certUrl: `https://${url.host}/static/cert.html` });
        phone.login(extension, password);
    }

    private onAction = (): void => {
        const data = this.state.rxData;
        if (data.actionDtmf) {
            this.phone?.sendDtmf(String(data.actionDtmf));
        }
        if (data.actionOid && data.actionOid !== 'nothing_selected') {
            void this.props.context.socket.setState(data.actionOid, true);
        }
    };

    private getOptions(): PhoneViewOptions {
        const data = this.state.rxData;
        let cameraSrc = String(data.cameraUrl || '').trim();
        if (data.cameraOid && data.cameraOid !== 'nothing_selected') {
            const value = this.state.values[`${data.cameraOid}.val`];
            if (typeof value === 'string' && value) {
                cameraSrc = value;
            }
        }
        return {
            title: String(data.title || ''),
            number: String(data.number || '').trim(),
            numberLabel: String(data.numberLabel || ''),
            showKeypad: bool(data.showKeypad),
            video: bool(data.video),
            useCamera: bool(data.video) && bool(data.useCamera),
            sendCamera: bool(data.video) && bool(data.useCamera) && bool(data.sendCamera),
            popup: bool(data.popup),
            cameraSrc,
            cameraRefresh: Number(data.cameraRefresh) || 0,
            cameraAlways: bool(data.cameraAlways),
            actionLabel: String(data.actionLabel || ''),
        };
    }

    /** In the editor: the view is not rendered while another one is open, so the phone would be offline there */
    private getHint(): string {
        if (!this.props.editMode) {
            return '';
        }
        const view = this.props.context.views?.[this.props.view];
        return view?.settings?.alwaysRender ? '' : PhoneWidget.t('always_render_hint');
    }

    renderWidgetBody(props: RxRenderWidgetProps): React.JSX.Element {
        super.renderWidgetBody(props);
        return (
            <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                <PhoneView
                    phone={this.state.phone}
                    extension={String(this.state.rxData.extension || '')}
                    options={this.getOptions()}
                    t={(key: string) => PhoneWidget.t(key)}
                    problem={this.state.problem}
                    hint={this.getHint()}
                    certUrl={this.state.certUrl}
                    onAction={this.onAction}
                />
            </div>
        );
    }
}

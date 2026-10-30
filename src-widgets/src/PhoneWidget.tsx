import React from 'react';

import type {
    RxRenderWidgetProps,
    RxWidgetInfo,
    RxWidgetInfoAttributesField,
    VisRxWidgetProps,
} from '@iobroker/types-vis-2';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import { PhoneView } from '../../src-shared/src/PhoneView';
import {
    ADAPTER,
    getViewOptions,
    declineEverywhere,
    runAction,
    stateId,
    type CameraSourceKind,
    type FrigateMode,
    type PhoneHost,
} from '../../src-shared/src/phoneSettings';
import { usePhone, useStateValue } from '../../src-shared/src/usePhone';
import { FrigateCameraSelect } from './FrigateCameraSelect';
import { createHost, PHONE_TPL } from './visHost';

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
    cameraSource: CameraSourceKind;
    cameraOid: string;
    cameraUrl: string;
    cameraFrigateInstance: string;
    cameraFrigateCamera: string;
    cameraFrigateMode: FrigateMode;
    cameraRefresh: number | string;
    cameraAlways: boolean;
    camera2Source: CameraSourceKind;
    camera2Oid: string;
    camera2Url: string;
    camera2FrigateInstance: string;
    camera2FrigateCamera: string;
    camera2FrigateMode: FrigateMode;
    camera2Refresh: number | string;
    actionLabel: string;
    actionDtmf: string;
    actionOid: string;
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
 * The fields of a camera: a URL or a state, or a camera of the frigate adapter
 *
 * @param prefix - `camera` or `camera2`
 * @param urlTooltip - tooltip of the URL
 */
function cameraFields(prefix: 'camera' | 'camera2', urlTooltip: string): RxWidgetInfoAttributesField[] {
    const notUrl = `data.${prefix}Source === 'frigate'`;
    const notFrigate = `data.${prefix}Source !== 'frigate'`;
    return [
        {
            name: `${prefix}Source`,
            label: 'camera_source',
            type: 'select',
            options: [
                { value: 'url', label: 'camera_source_url' },
                { value: 'frigate', label: 'camera_source_frigate' },
            ],
            default: 'url',
            noBinding: true,
        },
        { name: `${prefix}Url`, label: 'camera_url', tooltip: urlTooltip, hidden: notUrl },
        { name: `${prefix}Oid`, label: 'camera_oid', type: 'id', tooltip: 'camera_oid_tooltip', hidden: notUrl },
        {
            name: `${prefix}FrigateInstance`,
            label: 'frigate_instance',
            type: 'instance',
            adapter: 'frigate',
            default: 'frigate.0',
            hidden: notFrigate,
        },
        {
            name: `${prefix}FrigateCamera`,
            label: 'frigate_camera',
            type: 'custom',
            hidden: notFrigate,
            component: (_field, data, onDataChange, props) => (
                <FrigateCameraSelect
                    socket={props.context.socket}
                    instance={String(data[`${prefix}FrigateInstance`] || 'frigate.0')}
                    value={String(data[`${prefix}FrigateCamera`] || '')}
                    onChange={value => onDataChange({ [`${prefix}FrigateCamera`]: value })}
                />
            ),
        },
        {
            name: `${prefix}FrigateMode`,
            label: 'frigate_mode',
            type: 'select',
            options: [
                { value: 'snapshot', label: 'frigate_snapshot' },
                { value: 'stream', label: 'frigate_stream' },
            ],
            default: 'snapshot',
            tooltip: 'frigate_mode_tooltip',
            noBinding: true,
            hidden: notFrigate,
        },
        {
            name: `${prefix}Refresh`,
            label: 'camera_refresh',
            type: 'number',
            min: 0,
            max: 60,
            default: 1,
            tooltip: 'camera_refresh_tooltip',
            // the stream moves by itself
            hidden: `${notUrl} && data.${prefix}FrigateMode === 'stream'`,
        },
    ];
}

interface PhoneWidgetBodyProps {
    host: PhoneHost;
    settings: PhoneRxData;
    editMode: boolean;
    hint: string;
    t: (key: string) => string;
}

/** The phone comes from the registry: the background service of vis-2 may hold it already */
function PhoneWidgetBody({ host, settings, editMode, hint, t }: PhoneWidgetBodyProps): React.JSX.Element {
    const { handle, problem, certUrl } = usePhone(host, settings, false, !editMode);
    const cameraValue = useStateValue(host, stateId(settings.cameraOid));
    const camera2Value = useStateValue(host, stateId(settings.camera2Oid));

    return (
        <PhoneView
            handle={handle}
            preview={editMode}
            extension={String(settings.extension || '')}
            options={getViewOptions(settings, cameraValue, camera2Value)}
            host={host}
            t={t}
            problem={problem ? t(problem) : ''}
            hint={hint}
            certUrl={certUrl}
            onAction={() => runAction(host, handle?.phone || null, settings)}
            onDecline={() => declineEverywhere(host, settings)}
        />
    );
}

/**
 * Phone of the Asterisk adapter: audio and video calls over WebRTC, picture of a door camera,
 * and a dialog that pops up for incoming calls.
 */
export default class PhoneWidget extends (window.visRxWidget as typeof VisRxWidget)<PhoneRxData> {
    /** For the phone: the states of ioBroker through the socket of vis-2 */
    private readonly host: PhoneHost;

    constructor(props: VisRxWidgetProps) {
        super(props);
        this.host = createHost(props.context.socket);
    }

    static getWidgetInfo(): RxWidgetInfo {
        return {
            id: PHONE_TPL,
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
                        ...cameraFields('camera', 'camera_url_tooltip'),
                        { name: 'cameraAlways', label: 'camera_always', type: 'checkbox', default: false },
                    ],
                },
                {
                    name: 'camera2',
                    label: 'group_camera2',
                    fields: cameraFields('camera2', 'camera2_url_tooltip'),
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
                <PhoneWidgetBody
                    host={this.host}
                    settings={this.state.rxData}
                    editMode={!!this.props.editMode}
                    hint={this.getHint()}
                    t={(key: string) => PhoneWidget.t(key)}
                />
            </div>
        );
    }
}

/**
 * The phone as a tile of the devices app.
 *
 * A 1x1, 2x½ or 2x1 tile has room for the state of the phone: whether it is ready or who is calling, on 2x1 also
 * the picture of the door. A click opens the whole phone in a dialog. A 2x2 tile carries the phone itself.
 *
 * The phone comes from the registry (src-shared/src/phoneRegistry.ts). If the devices app runs the background
 * service (IntercomService.tsx), the service holds it: it stays registered in every category, and the service
 * shows the dialog of a call. Without the service the tile holds it, online while its category is shown.
 *
 * Split in two, like the tile of the alarm adapter: the class is what the devices app requires, the content is a
 * function component, because the phone is built on hooks.
 */
import type React from 'react';
import { useEffect } from 'react';
import { Box } from '@mui/material';
import type { Theme } from '@mui/material';
import WidgetGeneric, {
    getTileStyles,
    type CustomWidgetPlugin,
    type WidgetGenericProps,
    type WidgetGenericState,
} from '@iobroker/dm-widgets';
import type { ConfigItemPanel } from '@iobroker/dm-utils';

import { PhoneDialog, PhoneView } from '../../src-shared/src/PhoneView';
import {
    ADAPTER,
    getViewOptions,
    runAction,
    stateId,
    type PhoneHost,
    type PhoneSettings,
} from '../../src-shared/src/phoneSettings';
import { usePhone, usePhoneSnapshot, useStateValue } from '../../src-shared/src/usePhone';
import { createHost, t } from './devicesHost';
import { PhoneTile, type TileSize } from './PhoneTile';

export interface IntercomTileSettings extends CustomWidgetPlugin, PhoneSettings {}

interface IntercomComponentState extends WidgetGenericState {
    /** A call is ringing or running: the tile is lit */
    active: boolean;
}

/** Width to height of each tile size, so the frame keeps the proportions of the grid */
const ASPECT: Record<TileSize, string> = {
    '1x1': '1',
    '2x0.5': '4',
    '2x1': '2',
    '2x2': '1',
};

/** The 2x2 frame style. Present on the real base class of the app, absent from the compile-time stub */
type HugeStyle = (theme: Theme) => React.CSSProperties;

/** Key of the translations, as the devices app gets them (see translations.ts) */
const label = (key: string): string => `${ADAPTER}_${key}`;

/** The frame of the app for this size */
function frameStyle(size: TileSize, theme: Theme): React.CSSProperties {
    if (size === '2x2') {
        const huge = (WidgetGeneric as unknown as { getStyleHuge?: HugeStyle }).getStyleHuge;
        return huge ? huge(theme) : WidgetGeneric.getStyleWideTall(theme);
    }
    if (size === '2x1') {
        return WidgetGeneric.getStyleWideTall(theme);
    }
    if (size === '2x0.5') {
        return WidgetGeneric.getStyleWide(theme);
    }
    return WidgetGeneric.getStyleCompact(theme);
}

export class IntercomPhoneComponent extends WidgetGeneric<IntercomComponentState, IntercomTileSettings> {
    /** For the phone: the states of ioBroker through the devices app */
    private readonly host: PhoneHost;

    public constructor(props: WidgetGenericProps<IntercomTileSettings>) {
        super(props);
        this.host = createHost(props.stateContext);
        this.state = { ...this.state, active: false };
    }

    public static override getConfigSchema(): { name: string; schema: ConfigItemPanel } {
        return {
            name: 'Intercom',
            schema: {
                type: 'panel',
                items: {
                    // replaces the size field of the app, which offers no 2x2 - the size of the whole phone
                    size: {
                        type: 'select',
                        label: label('size'),
                        options: [
                            { value: '1x1', label: '1×1' },
                            { value: '2x0.5', label: '2×½' },
                            { value: '2x1', label: '2×1' },
                            { value: '2x2', label: '2×2' },
                        ],
                        default: '1x1',
                        format: 'radio',
                        horizontal: true,
                        noTranslation: true,
                    },
                    title: { type: 'text', label: label('title'), help: label('title_tooltip'), sm: 12 },
                    instance: { type: 'instance', label: label('instance'), adapter: ADAPTER, sm: 12 },
                    extension: { type: 'text', label: label('extension'), default: '100', sm: 6 },
                    password: {
                        type: 'password',
                        label: label('password'),
                        help: label('password_tooltip_devices'),
                        sm: 6,
                    },
                    wssUrl: { type: 'text', label: label('wss_url'), help: label('wss_url_tooltip'), sm: 12 },

                    _call: { type: 'header', text: label('group_call'), size: 5, sm: 12 },
                    number: { type: 'text', label: label('number'), help: label('number_tooltip'), sm: 6 },
                    numberLabel: { type: 'text', label: label('number_label'), sm: 6 },
                    showKeypad: { type: 'checkbox', label: label('show_keypad'), default: true, sm: 12 },
                    popup: { type: 'checkbox', label: label('popup'), default: true, sm: 12 },
                    video: { type: 'checkbox', label: label('video_calls'), default: true, sm: 12 },
                    // a setting that was never saved has its default, so `video` may be missing: on
                    useCamera: {
                        type: 'checkbox',
                        label: label('use_camera'),
                        help: label('use_camera_tooltip'),
                        default: false,
                        hidden: 'data.video === false',
                        sm: 12,
                    },
                    sendCamera: {
                        type: 'checkbox',
                        label: label('send_camera'),
                        default: false,
                        hidden: 'data.video === false || !data.useCamera',
                        sm: 12,
                    },

                    _camera: { type: 'header', text: label('group_camera'), size: 5, sm: 12 },
                    cameraUrl: {
                        type: 'text',
                        label: label('camera_url'),
                        help: label('camera_url_tooltip'),
                        sm: 12,
                    },
                    cameraOid: {
                        type: 'objectId',
                        label: label('camera_oid'),
                        help: label('camera_oid_tooltip'),
                        sm: 12,
                    },
                    cameraRefresh: {
                        type: 'number',
                        label: label('camera_refresh'),
                        help: label('camera_refresh_tooltip'),
                        min: 0,
                        max: 60,
                        default: 1,
                        sm: 6,
                    },
                    cameraAlways: { type: 'checkbox', label: label('camera_always'), default: false, sm: 6 },

                    _action: { type: 'header', text: label('group_action'), size: 5, sm: 12 },
                    actionLabel: {
                        type: 'text',
                        label: label('action_label'),
                        help: label('action_label_tooltip'),
                        sm: 12,
                    },
                    actionDtmf: { type: 'text', label: label('action_dtmf'), hidden: '!data.actionLabel', sm: 6 },
                    actionOid: {
                        type: 'objectId',
                        label: label('action_oid'),
                        hidden: '!data.actionLabel',
                        sm: 6,
                    },
                },
            },
        };
    }

    protected override isTileActive(): boolean {
        return this.state.active;
    }

    private readonly onActiveChange = (active: boolean): void => {
        if (active !== this.state.active) {
            this.setState({ active });
        }
    };

    private renderTile(size: TileSize): React.JSX.Element {
        const indicators = this.renderIndicators(this.renderSettingsButton());

        return (
            <Box
                id={String(this.props.widget.id)}
                className={this.getWidgetClass()}
                sx={theme => frameStyle(size, theme)}
            >
                <Box
                    sx={theme => ({
                        position: 'relative',
                        width: '100%',
                        aspectRatio: ASPECT[size],
                        overflow: 'hidden',
                        ...(getTileStyles(theme, this.state.active, this.getAccentColor()) as object),
                        padding: 0,
                    })}
                >
                    {/* the indicators and the settings button must not open the dialog underneath */}
                    <div
                        onClick={event => event.stopPropagation()}
                        style={{ display: 'contents' }}
                    >
                        {indicators}
                    </div>
                    <TileBody
                        host={this.host}
                        settings={this.props.settings}
                        size={size}
                        onActiveChange={this.onActiveChange}
                    />
                </Box>
            </Box>
        );
    }

    public override renderCompact(): React.JSX.Element {
        return this.renderTile('1x1');
    }

    public override renderWide(): React.JSX.Element {
        return this.renderTile('2x0.5');
    }

    public override renderWideTall(): React.JSX.Element {
        return this.renderTile('2x1');
    }

    /**
     * The 2x2 tile. Not declared on the compile-time stub of the base class, so no `override` - but the devices
     * app calls it on its real base class for this size.
     */
    public renderHuge(): React.JSX.Element {
        return this.renderTile('2x2');
    }
}

interface TileBodyProps {
    host: PhoneHost;
    settings: IntercomTileSettings;
    size: TileSize;
    onActiveChange: (active: boolean) => void;
}

function TileBody({ host, settings, size, onActiveChange }: TileBodyProps): React.JSX.Element {
    const { handle, problem, certUrl } = usePhone(host, settings, false);
    const snap = usePhoneSnapshot(handle?.phone);
    const cameraValue = useStateValue(host, stateId(settings.cameraOid));

    const active = snap.call !== 'none';
    useEffect(() => onActiveChange(active), [active, onActiveChange]);

    const title = settings.title || settings.name || t('phone_widget');
    const viewProps = {
        handle,
        extension: String(settings.extension || ''),
        options: getViewOptions({ ...settings, title }, cameraValue),
        t,
        problem: problem ? t(problem) : '',
        certUrl,
        onAction: () => runAction(host, handle?.phone || null, settings),
    };

    if (size === '2x2') {
        return (
            <Box sx={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                <PhoneView
                    {...viewProps}
                    embedded
                />
            </Box>
        );
    }

    return (
        <>
            <PhoneTile
                snap={snap}
                options={viewProps.options}
                title={title}
                problem={viewProps.problem}
                size={size}
                t={t}
                onClick={() => handle?.showDialog()}
            />
            {/* shown only if this tile shows the dialog of the phone, i.e. if the devices app runs no service */}
            <PhoneDialog {...viewProps} />
        </>
    );
}

export default IntercomPhoneComponent;

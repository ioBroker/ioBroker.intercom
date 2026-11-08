/**
 * The look of the phone: the same parts as `src-shared/src/PhoneView.tsx` (vis-2 widget, call dialog) and
 * `src-devices/src/PhoneTile.tsx` (devices tile), drawn with plain React and the CSS of `styles.ts` instead of MUI.
 *
 * One tree for every layout: the CSS decides by the class `layout-*` and by container queries what is shown - the
 * whole phone, or a tile with the state of the phone (and, if wide enough, the picture) whose click opens the phone
 * in a dialog. The picture is one element in both, so a camera is never loaded twice by the same element.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { CameraPicture } from '../../src-shared/src/CameraPicture';
import type { PhoneHost, PhoneViewOptions } from '../../src-shared/src/phoneSettings';
import { StreamVideo } from '../../src-shared/src/StreamVideo';
import { usePhoneSnapshot, type SipPhoneHandle } from '../../src-shared/src/usePhone';
import type { PhoneLayout, WordKey } from './constants';
import { Icon, type IconName } from './icons';

export interface PhoneViewProps {
    /** From the registry; `null` in edit mode, while starting and if a problem prevents the start */
    handle: SipPhoneHandle | null;
    /** `dialog`: the large phone in the dialog of the host */
    layout: PhoneLayout | 'dialog';
    /** In the editor of the host: a preview without any connection */
    preview: boolean;
    /** Extension of the settings, shown in the preview */
    extension: string;
    options: PhoneViewOptions;
    /** The states and adapters of ioBroker, for the cameras */
    host: PhoneHost | null;
    word: (key: WordKey) => string;
    /** Translated problem that prevents the phone from starting */
    problem: string;
    /** Page to accept the self-signed certificate of Asterisk */
    certUrl: string;
    onAction: () => void;
    /** After "Decline": the other devices of the subscriber stop ringing, too */
    onDecline: () => void;
    /** A click on the tile: the phone in a dialog */
    onOpen: () => void;
}

/** Keys with the letters of a phone keypad, as on the test page */
const KEYS: [string, string][] = [
    ['1', ''],
    ['2', 'ABC'],
    ['3', 'DEF'],
    ['4', 'GHI'],
    ['5', 'JKL'],
    ['6', 'MNO'],
    ['7', 'PQRS'],
    ['8', 'TUV'],
    ['9', 'WXYZ'],
    ['*', ''],
    ['0', '+'],
    ['#', ''],
];

/** What the picture area shows: the video of the other party or one of the cameras (`camera0`, `camera1`) */
type PictureSource = 'remote' | `camera${number}`;

type FabColor = 'default' | 'primary' | 'success' | 'error';

function formatDuration(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function CallTimer({ start }: { start: number }): JSX.Element {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return <>{formatDuration(now - start)}</>;
}

/** Round button of the test page, the main ones larger and with a glow */
function Fab(props: {
    title: string;
    color: FabColor;
    big?: boolean;
    glow?: boolean;
    disabled?: boolean;
    icon: IconName;
    onClick: () => void;
}): JSX.Element {
    const classes = ['fab', props.color, props.big ? 'big' : '', props.glow ? 'glow' : ''].filter(Boolean);
    return (
        <button
            type="button"
            className={classes.join(' ')}
            title={props.title}
            aria-label={props.title}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            <Icon name={props.icon} />
        </button>
    );
}

function Alert({ severity, children }: { severity: 'warning' | 'info' | 'error'; children: ReactNode }): JSX.Element {
    return <div className={`alert ${severity}`}>{children}</div>;
}

export function PhoneView(props: PhoneViewProps): JSX.Element {
    const { handle, options, word, preview } = props;
    const phone = handle?.phone || null;
    const snap = usePhoneSnapshot(phone);
    const [number, setNumber] = useState('');
    const [keypadInCall, setKeypadInCall] = useState(false);
    /** Chosen by hand, `null`: the first one available */
    const [chosenSource, setChosenSource] = useState<PictureSource | null>(null);
    const [lastCall, setLastCall] = useState(snap.call);

    // every call starts with the first picture again
    if (snap.call !== lastCall) {
        setLastCall(snap.call);
        if (snap.call === 'incoming' || snap.call === 'calling') {
            setChosenSource(null);
        }
    }

    const target = (options.showKeypad ? number : '') || options.number;
    const inCall = snap.call === 'incall';
    const registered = snap.registration === 'registered';
    const showCameras = snap.call !== 'none' || options.cameraAlways;
    const sources: PictureSource[] = [];
    if (snap.remoteVideo && snap.call !== 'none') {
        sources.push('remote');
    }
    if (showCameras) {
        options.cameras.forEach((_camera, i) => sources.push(`camera${i}`));
    }
    const source = chosenSource && sources.includes(chosenSource) ? chosenSource : sources[0] || null;

    const press = (key: string): void => {
        phone?.pressKey(key);
        if (!inCall) {
            setNumber(n => n + key);
        }
    };

    // ------------------------------------------------------------------ the whole phone
    const chipColor = preview
        ? 'default'
        : ({ registered: 'success', connecting: 'warning', error: 'error', offline: 'default' } as const)[
              snap.registration
          ];
    const chipLabel = preview ? word('preview') : word(snap.registration);

    let callText: ReactNode = '';
    if (snap.call === 'incoming') {
        callText = snap.incomingVideo ? word('incoming_video') : word('incoming');
    } else if (snap.call === 'calling') {
        callText = word('calling');
    } else if (inCall) {
        callText = (
            <>
                {word('connected')} · <CallTimer start={snap.callStart} />
            </>
        );
    }

    let subtitle: string;
    if (preview && !props.problem) {
        subtitle = `${props.extension || '-'} · ${word('editor_preview')}`;
    } else if (snap.registration === 'error') {
        subtitle = `${word('error')}${snap.error ? `: ${snap.error}` : ''}`;
    } else {
        subtitle = `${word('signed_in_as')} ${snap.extension || props.extension || '-'}`;
    }

    let picture: ReactNode = null;
    if (source === 'remote') {
        picture = (
            <StreamVideo
                stream={snap.remoteStream}
                version={snap.remoteVideo}
                style={{ objectFit: 'contain' }}
            />
        );
    } else if (source) {
        picture = (
            <CameraPicture
                key={source}
                source={options.cameras[Number(source.substring('camera'.length))]}
                host={props.host}
                large={props.layout === 'dialog'}
                alt={word('camera')}
            />
        );
    } else if (snap.call === 'incoming') {
        // the ringing avatar of the test page
        picture = (
            <div className="ring">
                <span className="wave" />
                <span className="wave late" />
                <span className="ring-avatar">
                    <Icon name="call" />
                </span>
            </div>
        );
    }

    // ------------------------------------------------------------------ the tile
    let status: ReactNode;
    let tileIcon: IconName = registered ? 'call' : 'offline';
    if (props.problem) {
        status = props.problem;
    } else if (preview) {
        status = `${props.extension || '-'} · ${word('preview')}`;
    } else if (snap.call === 'incoming') {
        status = snap.peer ? `${word('incoming')}: ${snap.peer}` : word('incoming');
        tileIcon = 'ringing';
    } else if (snap.call === 'calling') {
        status = snap.peer ? `${word('calling')} ${snap.peer}` : word('calling');
        tileIcon = 'inCall';
    } else if (inCall) {
        status = (
            <>
                {snap.peer || word('connected')} · <CallTimer start={snap.callStart} />
            </>
        );
        tileIcon = 'inCall';
    } else if (snap.registration === 'error') {
        status = snap.error ? `${word('error')}: ${snap.error}` : word('error');
    } else {
        status = word(snap.registration);
    }
    let tileColor = 'idle';
    if (snap.call !== 'none') {
        tileColor = 'active';
    } else if (props.problem || snap.registration === 'error') {
        tileColor = 'bad';
    } else if (registered) {
        tileColor = 'ready';
    }

    const classes = ['phone', `layout-${props.layout === 'dialog' ? 'phone' : props.layout}`];
    if (props.layout === 'dialog') {
        classes.push('large', 'dialog');
    }
    if (preview) {
        classes.push('edit');
    }

    return (
        <div className={classes.join(' ')}>
            <div className="head">
                <span className="brand">
                    <Icon name="call" />
                </span>
                <span className="title">{options.title}</span>
                <span
                    className={`chip ${chipColor}`}
                    title={snap.error || undefined}
                >
                    <span className="dot" />
                    {chipLabel}
                </span>
            </div>

            <div className="tile-status">
                <span className={`avatar ${tileColor}${snap.call === 'incoming' ? ' ringing' : ''}`}>
                    <Icon name={tileIcon} />
                </span>
                <span className="tile-text">
                    <span className="tile-title">{options.title}</span>
                    <span className={`tile-state${props.problem ? ' bad' : ''}`}>{status}</span>
                </span>
            </div>

            {registered && snap.audioLocked ? (
                <button
                    type="button"
                    className="alert warning sound"
                    onClick={() => phone?.unlockAudio()}
                >
                    {word('click_sound')}
                </button>
            ) : null}

            <div className="content">
                <div className="subtitle">{subtitle}</div>

                {props.problem ? <Alert severity="warning">{props.problem}</Alert> : null}
                {snap.mediaError ? (
                    <Alert severity="error">{word(snap.mediaError === 'denied' ? 'mic_denied' : 'mic_missing')}</Alert>
                ) : null}
                {!props.problem &&
                props.certUrl &&
                (snap.registration === 'connecting' || snap.registration === 'error') ? (
                    <Alert severity="info">
                        {word('cert_hint')}{' '}
                        <a
                            href={props.certUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {word('accept_cert')}
                        </a>
                    </Alert>
                ) : null}

                {/* number or other party */}
                {snap.call !== 'none' ? (
                    <div className="panel peer">
                        <div className="peer-name">{snap.peer || '-'}</div>
                        <div className={`peer-state${inCall ? ' connected' : ''}`}>{callText}</div>
                    </div>
                ) : options.showKeypad ? (
                    <div className="panel number">
                        <input
                            type="text"
                            inputMode="numeric"
                            value={number}
                            placeholder={options.number || word('number')}
                            aria-label={word('number')}
                            onChange={e => setNumber(e.target.value.replace(/[^0-9*#+]/g, ''))}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && target) {
                                    void phone?.call(target, options.sendCamera);
                                }
                            }}
                        />
                        <button
                            type="button"
                            className={`icon-button${number ? '' : ' hidden'}`}
                            title={word('backspace')}
                            aria-label={word('backspace')}
                            onClick={() => setNumber(n => n.slice(0, -1))}
                        >
                            <Icon name="backspace" />
                        </button>
                    </div>
                ) : null}

                {/* picture: video of the other party, camera or ringing */}
                {picture ? (
                    <div className={`picture${source ? ' source' : ' ringing'}`}>
                        {picture}
                        {source && sources.length > 1 ? (
                            <button
                                type="button"
                                className="switch"
                                title={word('switch_picture')}
                                aria-label={word('switch_picture')}
                                onClick={() => setChosenSource(sources[(sources.indexOf(source) + 1) % sources.length])}
                            >
                                <Icon name="switchPicture" />
                            </button>
                        ) : null}
                        {snap.cameraOn && snap.call !== 'none' ? (
                            <div className="pip">
                                <StreamVideo
                                    stream={snap.localStream}
                                    version={snap.cameraLabel}
                                    mirrored
                                />
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {(snap.call === 'none' && options.showKeypad) || (inCall && keypadInCall) ? (
                    <div className="keypad">
                        {KEYS.map(([key, letters]) => (
                            <button
                                type="button"
                                key={key}
                                className="key"
                                onClick={() => press(key)}
                            >
                                <span className="digit">{key}</span>
                                <span className="letters">{letters}</span>
                            </button>
                        ))}
                    </div>
                ) : null}
                {!picture ? <div className="spacer" /> : null}

                {/* buttons */}
                <div className="buttons">
                    {snap.call === 'none' ? (
                        <>
                            <Fab
                                title={!options.showKeypad && options.numberLabel ? options.numberLabel : word('call')}
                                color="success"
                                big
                                glow
                                icon="call"
                                disabled={!registered || !target}
                                onClick={() => void phone?.call(target, options.sendCamera)}
                            />
                            {options.useCamera && !options.sendCamera ? (
                                <Fab
                                    title={word('video_call')}
                                    color="primary"
                                    icon="videocam"
                                    disabled={!registered || !target}
                                    onClick={() => void phone?.call(target, true)}
                                />
                            ) : null}
                        </>
                    ) : null}

                    {snap.call === 'incoming' ? (
                        <>
                            <Fab
                                title={word('decline')}
                                color="error"
                                big
                                icon="callEnd"
                                onClick={() => {
                                    phone?.decline();
                                    props.onDecline();
                                }}
                            />
                            <Fab
                                title={word('answer')}
                                color="success"
                                big
                                glow
                                icon="call"
                                onClick={() => void phone?.answer(options.sendCamera)}
                            />
                            {options.useCamera && snap.incomingVideo && !options.sendCamera ? (
                                <Fab
                                    title={word('answer_video')}
                                    color="primary"
                                    big
                                    glow
                                    icon="videocam"
                                    onClick={() => void phone?.answer(true)}
                                />
                            ) : null}
                        </>
                    ) : null}

                    {inCall ? (
                        <>
                            <Fab
                                title={snap.muted ? word('unmute') : word('mute')}
                                color={snap.muted ? 'error' : 'default'}
                                icon={snap.muted ? 'micOff' : 'mic'}
                                onClick={() => phone?.toggleMute()}
                            />
                            {options.useCamera ? (
                                <Fab
                                    title={snap.cameraOn ? word('camera_off') : word('camera_on')}
                                    color={snap.cameraOn ? 'primary' : 'default'}
                                    icon={snap.cameraOn ? 'videocam' : 'videocamOff'}
                                    onClick={() => void phone?.toggleCamera()}
                                />
                            ) : null}
                            <Fab
                                title={word('keypad')}
                                color={keypadInCall ? 'primary' : 'default'}
                                icon="dialpad"
                                onClick={() => setKeypadInCall(v => !v)}
                            />
                            {options.actionLabel ? (
                                <Fab
                                    title={options.actionLabel}
                                    color="primary"
                                    glow
                                    icon="action"
                                    onClick={props.onAction}
                                />
                            ) : null}
                        </>
                    ) : null}

                    {inCall || snap.call === 'calling' ? (
                        <Fab
                            title={word('hangup')}
                            color="error"
                            big
                            glow
                            icon="callEnd"
                            onClick={() => phone?.hangup()}
                        />
                    ) : null}
                </div>
            </div>

            {/* the tile opens the whole phone; hidden while the whole phone is shown */}
            <button
                type="button"
                className="tile-open"
                title={options.title}
                aria-label={options.title}
                disabled={!handle}
                onClick={props.onOpen}
            />
        </div>
    );
}

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
    Alert,
    Avatar,
    Box,
    ButtonBase,
    Card,
    Chip,
    Dialog,
    Divider,
    Fab,
    IconButton,
    InputAdornment,
    Link,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import {
    BackspaceOutlined as BackspaceIcon,
    Call as CallIcon,
    CallEnd as CallEndIcon,
    CloseFullscreen as MinimizeIcon,
    Dialpad as DialpadIcon,
    MeetingRoom as ActionIcon,
    Mic as MicIcon,
    MicOff as MicOffIcon,
    Videocam as VideocamIcon,
    VideocamOff as VideocamOffIcon,
} from '@mui/icons-material';

import type { PhoneSnapshot, SipPhone } from '../../src-www/src/SipPhone';
import { CameraImage } from './CameraImage';
import { StreamVideo } from './StreamVideo';

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

export interface PhoneViewProps {
    /** `null` in the editor: only a preview without any connection */
    phone: SipPhone | null;
    /** Extension of the settings, shown in the preview of the editor */
    extension: string;
    options: PhoneViewOptions;
    t: (key: string) => string;
    /** Problem that prevents the phone from starting */
    problem: string;
    /** Page to accept the self-signed certificate of Asterisk */
    certUrl: string;
    onAction: () => void;
}

/** Snapshot in the editor: the widget does not connect there, so it must not look online */
const PREVIEW: PhoneSnapshot = {
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
    log: [],
};

const noSubscribe = (): (() => void) => () => {};
const getPreview = (): PhoneSnapshot => PREVIEW;

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

/** Gradient of the app icon, the same as the primary buttons of admin 8 and the test page */
const BRAND_GRADIENT = 'linear-gradient(135deg, #48A1FA 0%, #0B76F5 100%)';

const pulse = keyframes`
    from { transform: scale(1); opacity: 0.7; }
    to { transform: scale(1.8); opacity: 0; }
`;
const shake = keyframes`
    0%, 50%, 100% { transform: rotate(0); }
    5%, 15%, 25%, 35%, 45% { transform: rotate(-14deg); }
    10%, 20%, 30%, 40% { transform: rotate(14deg); }
`;

function formatDuration(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function CallTimer({ start }: { start: number }): React.JSX.Element {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return <>{formatDuration(now - start)}</>;
}

/** Framed area inside the card, like the panels of the test page */
function Panel({ children, sx }: { children: React.ReactNode; sx?: object }): React.JSX.Element {
    return (
        <Box
            sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: '16px',
                bgcolor: theme => alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.025 : 0.015),
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}

type FabColor = 'default' | 'primary' | 'success' | 'error';

/** Round button of the test page, the main ones with a glow */
function RoundFab(props: {
    title: string;
    color: FabColor;
    size: number;
    glow?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}): React.JSX.Element {
    const { title, color, size, glow, disabled, onClick, children } = props;
    return (
        <Tooltip title={title}>
            <span>
                <Fab
                    color={color}
                    disabled={disabled}
                    onClick={onClick}
                    aria-label={title}
                    sx={{
                        width: size,
                        height: size,
                        minHeight: size,
                        '& svg': { fontSize: size * 0.44 },
                        boxShadow:
                            glow && !disabled && color !== 'default'
                                ? theme => `0 0 28px ${alpha(theme.palette[color].main, 0.55)}`
                                : undefined,
                    }}
                >
                    {children}
                </Fab>
            </span>
        </Tooltip>
    );
}

/** Content of the phone: header, picture, number, keypad and buttons. In the widget and in the call dialog */
function PhoneBody(
    props: PhoneViewProps & { snap: PhoneSnapshot; large: boolean; onMinimize?: () => void },
): React.JSX.Element {
    const { phone, snap, options, t, large } = props;
    const [number, setNumber] = useState('');
    const [keypadInCall, setKeypadInCall] = useState(false);

    const preview = !phone;
    const target = (options.showKeypad ? number : '') || options.number;
    const inCall = snap.call === 'incall';
    const registered = snap.registration === 'registered';
    const showRemoteVideo = snap.remoteVideo && snap.call !== 'none';
    const showCamera = !showRemoteVideo && !!options.cameraSrc && (snap.call !== 'none' || options.cameraAlways);
    const fabBig = large ? 72 : 56;
    const fabSmall = large ? 60 : 46;
    const keyHeight = large ? 60 : 46;

    const chipColor = preview
        ? 'default'
        : ({ registered: 'success', connecting: 'warning', error: 'error', offline: 'default' } as const)[
              snap.registration
          ];
    const chipLabel = preview ? t('preview') : t(snap.registration);

    const press = (key: string): void => {
        phone?.pressKey(key);
        if (!inCall) {
            setNumber(n => n + key);
        }
    };

    let callText: React.ReactNode = '';
    if (snap.call === 'incoming') {
        callText = snap.incomingVideo ? t('incoming_video') : t('incoming');
    } else if (snap.call === 'calling') {
        callText = t('calling');
    } else if (inCall) {
        callText = (
            <>
                {t('connected')} · <CallTimer start={snap.callStart} />
            </>
        );
    }

    let subtitle: string;
    if (preview && !props.problem) {
        subtitle = `${props.extension || '-'} · ${t('editor_preview')}`;
    } else if (snap.registration === 'error') {
        subtitle = `${t('error')}${snap.error ? `: ${snap.error}` : ''}`;
    } else {
        subtitle = `${t('signed_in_as')} ${snap.extension || props.extension || '-'}`;
    }

    let picture: React.ReactNode = null;
    if (showRemoteVideo) {
        picture = (
            <StreamVideo
                stream={snap.remoteStream}
                version={snap.remoteVideo}
                style={{ objectFit: 'contain' }}
            />
        );
    } else if (showCamera) {
        picture = (
            <CameraImage
                src={options.cameraSrc}
                refresh={options.cameraRefresh}
                alt={t('camera')}
            />
        );
    } else if (snap.call === 'incoming') {
        // the ringing avatar of the test page
        picture = (
            <Box sx={{ position: 'relative', width: 96, height: 96 }}>
                {[0, 0.8].map(delay => (
                    <Box
                        key={delay}
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            border: 3,
                            borderColor: 'success.main',
                            animation: `${pulse} 1.6s ease-out ${delay}s infinite`,
                        }}
                    />
                ))}
                <Avatar sx={{ width: 96, height: 96, bgcolor: 'success.main' }}>
                    <CallIcon sx={{ fontSize: 44, animation: `${shake} 1.2s infinite`, color: '#fff' }} />
                </Avatar>
            </Box>
        );
    }
    const dark = showRemoteVideo || showCamera;

    const keypad = (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: large ? 1.25 : 0.75,
                width: '100%',
                maxWidth: 360,
                mx: 'auto',
            }}
        >
            {KEYS.map(([key, letters]) => (
                <ButtonBase
                    key={key}
                    onClick={() => press(key)}
                    sx={theme => ({
                        height: keyHeight,
                        borderRadius: large ? '16px' : '12px',
                        border: 1,
                        borderColor: 'divider',
                        flexDirection: 'column',
                        background:
                            theme.palette.mode === 'dark'
                                ? 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)'
                                : 'linear-gradient(180deg, #FFFFFF 0%, #F1F4F9 100%)',
                        boxShadow:
                            theme.palette.mode === 'dark'
                                ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 6px rgba(0,0,0,0.25)'
                                : '0 1px 3px rgba(15,23,42,0.08)',
                        transition: 'border-color 0.15s, transform 0.05s',
                        '&:hover': { borderColor: 'primary.main' },
                        '&:active': { transform: 'scale(0.97)' },
                    })}
                >
                    <Typography sx={{ fontSize: large ? 26 : 20, fontWeight: 500, lineHeight: 1 }}>{key}</Typography>
                    <Typography
                        sx={{ fontSize: 10, letterSpacing: 2, color: 'text.secondary', minHeight: 12, mt: 0.25 }}
                    >
                        {letters}
                    </Typography>
                </ButtonBase>
            ))}
        </Box>
    );

    return (
        <Card
            variant="outlined"
            sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: large ? '24px' : '20px',
                boxSizing: 'border-box',
                boxShadow: theme =>
                    large
                        ? 'none'
                        : theme.palette.mode === 'dark'
                          ? '0 24px 60px rgba(0, 0, 0, 0.45)'
                          : '0 24px 60px rgba(15, 23, 42, 0.12)',
            }}
        >
            {/* header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: large ? 2.5 : 2, py: large ? 2 : 1.25 }}>
                <Box
                    sx={{
                        width: large ? 40 : 34,
                        height: large ? 40 : 34,
                        flexShrink: 0,
                        borderRadius: '11px',
                        background: BRAND_GRADIENT,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 14px rgba(19, 123, 248, 0.35)',
                    }}
                >
                    <CallIcon fontSize={large ? 'medium' : 'small'} />
                </Box>
                <Typography
                    variant={large ? 'h6' : 'subtitle1'}
                    noWrap
                    sx={{ flex: 1, fontWeight: 700 }}
                >
                    {options.title || t('phone_widget')}
                </Typography>
                <Tooltip title={snap.error || ''}>
                    <Chip
                        variant="outlined"
                        size={large ? 'medium' : 'small'}
                        color={chipColor}
                        label={chipLabel}
                        icon={
                            <Box
                                component="span"
                                sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    bgcolor: 'currentColor',
                                    ml: '10px !important',
                                }}
                            />
                        }
                        sx={{ borderRadius: '16px', fontWeight: 500 }}
                    />
                </Tooltip>
                {props.onMinimize ? (
                    <Tooltip title={t('minimize')}>
                        <IconButton onClick={props.onMinimize}>
                            <MinimizeIcon />
                        </IconButton>
                    </Tooltip>
                ) : null}
            </Box>
            <Divider />

            {registered && snap.audioLocked ? (
                <Alert
                    severity="warning"
                    sx={{ borderRadius: 0, cursor: 'pointer', py: 0 }}
                    onClick={() => phone?.unlockAudio()}
                >
                    {t('click_sound')}
                </Alert>
            ) : null}

            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: large ? 2 : 1.25,
                    p: large ? 2.5 : 1.5,
                }}
            >
                <Typography
                    variant="body2"
                    color="text.secondary"
                    align="center"
                    noWrap
                >
                    {subtitle}
                </Typography>

                {props.problem ? (
                    <Alert
                        severity="warning"
                        sx={{ py: 0 }}
                    >
                        {props.problem}
                    </Alert>
                ) : null}
                {!props.problem &&
                props.certUrl &&
                (snap.registration === 'connecting' || snap.registration === 'error') ? (
                    <Alert
                        severity="info"
                        sx={{ py: 0 }}
                    >
                        {t('cert_hint')}{' '}
                        <Link
                            href={props.certUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {t('accept_cert')}
                        </Link>
                    </Alert>
                ) : null}

                {/* number or other party */}
                {snap.call !== 'none' ? (
                    <Panel sx={{ px: 2, py: 1, textAlign: 'center' }}>
                        <Typography
                            variant={large ? 'h5' : 'h6'}
                            noWrap
                            sx={{ fontWeight: 600 }}
                        >
                            {snap.peer || '-'}
                        </Typography>
                        <Typography
                            variant="body2"
                            color={inCall ? 'success.main' : 'text.secondary'}
                        >
                            {callText}
                        </Typography>
                    </Panel>
                ) : options.showKeypad ? (
                    <Panel sx={{ px: 2, minHeight: large ? 76 : 60, display: 'flex', alignItems: 'center' }}>
                        <TextField
                            variant="standard"
                            value={number}
                            placeholder={options.number || t('number')}
                            onChange={e => setNumber(e.target.value.replace(/[^0-9*#+]/g, ''))}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && target) {
                                    void phone?.call(target, options.sendCamera);
                                }
                            }}
                            fullWidth
                            slotProps={{
                                htmlInput: {
                                    inputMode: 'numeric',
                                    'aria-label': t('number'),
                                    style: {
                                        textAlign: 'center',
                                        fontSize: large ? 36 : 28,
                                        fontWeight: 600,
                                        letterSpacing: 1,
                                        paddingLeft: 40,
                                    },
                                },
                                input: {
                                    disableUnderline: true,
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label={t('backspace')}
                                                onClick={() => setNumber(n => n.slice(0, -1))}
                                                sx={{ visibility: number ? 'visible' : 'hidden' }}
                                            >
                                                <BackspaceIcon />
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                },
                            }}
                        />
                    </Panel>
                ) : null}

                {/* picture: video of the other party, camera or ringing */}
                {picture ? (
                    <Box
                        sx={{
                            position: 'relative',
                            flex: 1,
                            minHeight: large ? 200 : 120,
                            borderRadius: '16px',
                            overflow: 'hidden',
                            border: dark ? 0 : 1,
                            borderColor: 'divider',
                            bgcolor: dark ? '#000' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {picture}
                        {snap.cameraOn && snap.call !== 'none' ? (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    right: 10,
                                    bottom: 10,
                                    width: '30%',
                                    aspectRatio: '4 / 3',
                                    borderRadius: '10px',
                                    overflow: 'hidden',
                                    border: '2px solid rgba(255, 255, 255, 0.75)',
                                    boxShadow: 4,
                                    bgcolor: '#000',
                                }}
                            >
                                <StreamVideo
                                    stream={snap.localStream}
                                    version={snap.cameraLabel}
                                    mirrored
                                />
                            </Box>
                        ) : null}
                    </Box>
                ) : null}

                {(snap.call === 'none' && options.showKeypad) || (inCall && keypadInCall) ? keypad : null}
                {!picture ? <Box sx={{ flex: 1 }} /> : null}

                {/* buttons */}
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: large ? 3 : 2,
                        pb: 0.5,
                    }}
                >
                    {snap.call === 'none' ? (
                        <>
                            <RoundFab
                                title={!options.showKeypad && options.numberLabel ? options.numberLabel : t('call')}
                                color="success"
                                size={fabBig}
                                glow
                                disabled={!registered || !target}
                                onClick={() => void phone?.call(target, options.sendCamera)}
                            >
                                <CallIcon />
                            </RoundFab>
                            {options.useCamera && !options.sendCamera ? (
                                <RoundFab
                                    title={t('video_call')}
                                    color="primary"
                                    size={fabSmall}
                                    disabled={!registered || !target}
                                    onClick={() => void phone?.call(target, true)}
                                >
                                    <VideocamIcon />
                                </RoundFab>
                            ) : null}
                        </>
                    ) : null}

                    {snap.call === 'incoming' ? (
                        <>
                            <RoundFab
                                title={t('decline')}
                                color="error"
                                size={fabBig}
                                onClick={() => phone?.decline()}
                            >
                                <CallEndIcon />
                            </RoundFab>
                            <RoundFab
                                title={t('answer')}
                                color="success"
                                size={fabBig}
                                glow
                                onClick={() => void phone?.answer(options.sendCamera)}
                            >
                                <CallIcon />
                            </RoundFab>
                            {options.useCamera && snap.incomingVideo && !options.sendCamera ? (
                                <RoundFab
                                    title={t('answer_video')}
                                    color="primary"
                                    size={fabBig}
                                    glow
                                    onClick={() => void phone?.answer(true)}
                                >
                                    <VideocamIcon />
                                </RoundFab>
                            ) : null}
                        </>
                    ) : null}

                    {inCall ? (
                        <>
                            <RoundFab
                                title={snap.muted ? t('unmute') : t('mute')}
                                color={snap.muted ? 'error' : 'default'}
                                size={fabSmall}
                                onClick={() => phone?.toggleMute()}
                            >
                                {snap.muted ? <MicOffIcon /> : <MicIcon />}
                            </RoundFab>
                            {options.useCamera ? (
                                <RoundFab
                                    title={snap.cameraOn ? t('camera_off') : t('camera_on')}
                                    color={snap.cameraOn ? 'primary' : 'default'}
                                    size={fabSmall}
                                    onClick={() => void phone?.toggleCamera()}
                                >
                                    {snap.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />}
                                </RoundFab>
                            ) : null}
                            <RoundFab
                                title={t('keypad')}
                                color={keypadInCall ? 'primary' : 'default'}
                                size={fabSmall}
                                onClick={() => setKeypadInCall(v => !v)}
                            >
                                <DialpadIcon />
                            </RoundFab>
                            {options.actionLabel ? (
                                <RoundFab
                                    title={options.actionLabel}
                                    color="primary"
                                    size={fabSmall}
                                    glow
                                    onClick={props.onAction}
                                >
                                    <ActionIcon />
                                </RoundFab>
                            ) : null}
                        </>
                    ) : null}

                    {inCall || snap.call === 'calling' ? (
                        <RoundFab
                            title={t('hangup')}
                            color="error"
                            size={fabBig}
                            glow
                            onClick={() => phone?.hangup()}
                        >
                            <CallEndIcon />
                        </RoundFab>
                    ) : null}
                </Box>
            </Box>
        </Card>
    );
}

/** The phone in the widget. Calls open a dialog if wanted, so a small widget is enough */
export function PhoneView(props: PhoneViewProps): React.JSX.Element {
    const { phone, options } = props;
    const snap = useSyncExternalStore(phone ? phone.subscribe : noSubscribe, phone ? phone.getSnapshot : getPreview);
    // the dialog was minimized for this call
    const [minimizedCall, setMinimizedCall] = useState(0);
    const [callId, setCallId] = useState(0);
    const [lastCall, setLastCall] = useState(snap.call);
    if (lastCall !== snap.call) {
        // a new call starts: count it, so a minimized dialog opens again for the next call
        setLastCall(snap.call);
        if (lastCall === 'none') {
            setCallId(id => id + 1);
        }
    }

    const dialogOpen = options.popup && snap.call !== 'none' && minimizedCall !== callId;

    return (
        <>
            <PhoneBody
                {...props}
                snap={snap}
                large={false}
            />
            {dialogOpen ? (
                <Dialog
                    open
                    fullWidth
                    maxWidth="xs"
                    onClose={() => setMinimizedCall(callId)}
                    slotProps={{
                        paper: { sx: { height: 'min(760px, 92vh)', borderRadius: '24px', overflow: 'hidden' } },
                    }}
                >
                    <PhoneBody
                        {...props}
                        snap={snap}
                        large
                        onMinimize={() => setMinimizedCall(callId)}
                    />
                </Dialog>
            ) : null}
        </>
    );
}

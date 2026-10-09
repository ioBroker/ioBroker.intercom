import React, { useEffect, useState, useSyncExternalStore } from 'react';
import {
    Alert,
    Box,
    Button,
    Dialog,
    IconButton,
    InputAdornment,
    Link,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import {
    Backspace as BackspaceIcon,
    Call as CallIcon,
    CallEnd as CallEndIcon,
    CloseFullscreen as MinimizeIcon,
    Dialpad as DialpadIcon,
    MeetingRoom as ActionIcon,
    Mic as MicIcon,
    MicOff as MicOffIcon,
    Person as PersonIcon,
    Videocam as VideocamIcon,
    VideocamOff as VideocamOffIcon,
    VolumeUp as VolumeUpIcon,
} from '@mui/icons-material';

import type { PhoneSnapshot, SipPhone } from '../../src-www/src/SipPhone';
import { CameraImage } from './CameraImage';
import { StreamVideo } from './StreamVideo';

export interface PhoneViewOptions {
    /** Number called by the call button, e.g. the door */
    number: string;
    /** Text of the call button instead of the number */
    numberLabel: string;
    showKeypad: boolean;
    /** Video calls are allowed */
    video: boolean;
    /** Switch the own camera on with every call */
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
    options: PhoneViewOptions;
    t: (key: string) => string;
    /** Problem that prevents the phone from starting */
    problem: string;
    /** Page to accept the self-signed certificate of Asterisk */
    certUrl: string;
    onAction: () => void;
}

const PREVIEW: PhoneSnapshot = {
    registration: 'registered',
    error: '',
    extension: '100',
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

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

function formatDuration(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

function CallTimer({ start }: { start: number }): React.JSX.Element {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return <span>{formatDuration(now - start)}</span>;
}

/** Round action button with a caption */
function RoundButton(props: {
    color: string;
    title: string;
    onClick: () => void;
    children: React.ReactNode;
    active?: boolean;
    size: number;
}): React.JSX.Element {
    return (
        <Tooltip title={props.title}>
            <IconButton
                onClick={props.onClick}
                aria-label={props.title}
                sx={{
                    width: props.size,
                    height: props.size,
                    color: '#fff',
                    bgcolor: props.color,
                    boxShadow: props.active ? `0 0 0 3px ${props.color}55` : 2,
                    '&:hover': { bgcolor: props.color, filter: 'brightness(1.12)' },
                    '& svg': { fontSize: props.size * 0.5 },
                }}
            >
                {props.children}
            </IconButton>
        </Tooltip>
    );
}

const GREEN = '#2e7d32';
const RED = '#d32f2f';
const GREY = '#607d8b';
const BLUE = '#1976d2';

/** Content of the phone: picture, status and buttons. Used in the widget and in the call dialog */
function PhoneBody(
    props: PhoneViewProps & { snap: PhoneSnapshot; large: boolean; onMinimize?: () => void },
): React.JSX.Element {
    const { phone, snap, options, t, large } = props;
    const [number, setNumber] = useState('');
    const [keypadInCall, setKeypadInCall] = useState(false);

    const buttonSize = large ? 64 : 48;
    const target = (options.showKeypad ? number : '') || options.number;
    const inCall = snap.call === 'incall';
    const showRemoteVideo = snap.remoteVideo && snap.call !== 'none';
    const showCamera = !showRemoteVideo && !!options.cameraSrc && (snap.call !== 'none' || options.cameraAlways);
    const registered = snap.registration === 'registered';

    const statusColor =
        snap.call !== 'none'
            ? GREEN
            : registered
              ? GREEN
              : snap.registration === 'error'
                ? RED
                : snap.registration === 'connecting'
                  ? '#ed6c02'
                  : GREY;
    let status: React.ReactNode;
    if (snap.call === 'incoming') {
        status = snap.incomingVideo ? t('incoming_video') : t('incoming');
    } else if (snap.call === 'calling') {
        status = t('calling');
    } else if (inCall) {
        status = <CallTimer start={snap.callStart} />;
    } else if (snap.registration === 'error') {
        status = `${t('error')}${snap.error ? `: ${snap.error}` : ''}`;
    } else {
        status = `${snap.extension || '-'} · ${t(snap.registration)}`;
    }

    const press = (key: string): void => {
        phone?.pressKey(key);
        if (!inCall) {
            setNumber(n => n + key);
        }
    };

    const keypad = (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: large ? 1 : 0.5,
                width: '100%',
                maxWidth: 280,
                mx: 'auto',
            }}
        >
            {KEYS.map(key => (
                <Button
                    key={key}
                    variant="outlined"
                    onClick={() => press(key)}
                    sx={{ minWidth: 0, py: large ? 1 : 0.25, fontSize: large ? 20 : 16 }}
                >
                    {key}
                </Button>
            ))}
        </Box>
    );

    let picture: React.ReactNode;
    if (showRemoteVideo) {
        picture = (
            <StreamVideo
                stream={snap.remoteStream}
                version={snap.remoteVideo}
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
    } else if (snap.call !== 'none') {
        picture = (
            <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                <PersonIcon sx={{ fontSize: large ? 96 : 56, opacity: 0.6 }} />
            </Box>
        );
    }

    return (
        <Box
            sx={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                height: '100%',
                gap: 1,
                p: large ? 2 : 1,
                boxSizing: 'border-box',
                overflow: 'hidden',
            }}
        >
            {/* status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 24 }}>
                <Box
                    sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        bgcolor: statusColor,
                        boxShadow: `0 0 6px ${statusColor}`,
                    }}
                />
                <Typography
                    variant="body2"
                    noWrap
                    sx={{ flex: 1, fontWeight: snap.call !== 'none' ? 600 : 400 }}
                >
                    {snap.peer ? `${snap.peer} · ` : ''}
                    {status}
                </Typography>
                {snap.audioLocked && registered ? (
                    <Tooltip title={t('click_sound')}>
                        <IconButton
                            size="small"
                            onClick={() => phone?.unlockAudio()}
                            sx={{ color: 'warning.main' }}
                        >
                            <VolumeUpIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                ) : null}
                {props.onMinimize ? (
                    <IconButton
                        size="small"
                        onClick={props.onMinimize}
                        title={t('minimize')}
                    >
                        <MinimizeIcon fontSize="small" />
                    </IconButton>
                ) : null}
            </Box>

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
            snap.registration !== 'registered' &&
            snap.registration !== 'offline' ? (
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

            {/* picture */}
            {picture ? (
                <Box
                    sx={{
                        position: 'relative',
                        flex: 1,
                        minHeight: 60,
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: showRemoteVideo || showCamera ? '#000' : 'action.hover',
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
                                right: 8,
                                bottom: 8,
                                width: '28%',
                                aspectRatio: '4 / 3',
                                borderRadius: 1,
                                overflow: 'hidden',
                                boxShadow: 4,
                                border: '2px solid rgba(255,255,255,0.7)',
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
            ) : (
                <Box sx={{ flex: 1 }} />
            )}

            {/* number and keypad */}
            {snap.call === 'none' && options.showKeypad ? (
                <>
                    <TextField
                        size="small"
                        value={number}
                        placeholder={options.number || t('number')}
                        onChange={e => setNumber(e.target.value.replace(/[^0-9*#+]/g, ''))}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && target) {
                                void phone?.call(target, options.video && options.sendCamera);
                            }
                        }}
                        slotProps={{
                            input: {
                                endAdornment: number ? (
                                    <InputAdornment position="end">
                                        <IconButton
                                            size="small"
                                            onClick={() => setNumber(n => n.slice(0, -1))}
                                            title={t('backspace')}
                                        >
                                            <BackspaceIcon fontSize="small" />
                                        </IconButton>
                                    </InputAdornment>
                                ) : null,
                            },
                        }}
                    />
                    {keypad}
                </>
            ) : null}
            {inCall && keypadInCall ? keypad : null}

            {/* actions */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: large ? 2 : 1,
                    pt: 0.5,
                }}
            >
                {snap.call === 'none' ? (
                    <>
                        {target ? (
                            <Button
                                variant="contained"
                                color="success"
                                disabled={!registered}
                                startIcon={<CallIcon />}
                                onClick={() => void phone?.call(target, options.video && options.sendCamera)}
                                sx={{ borderRadius: 99, px: 3 }}
                            >
                                {!options.showKeypad && options.numberLabel ? options.numberLabel : t('call')}
                            </Button>
                        ) : null}
                        {target && options.video && !options.sendCamera ? (
                            <Tooltip title={t('video_call')}>
                                <span>
                                    <IconButton
                                        disabled={!registered}
                                        onClick={() => void phone?.call(target, true)}
                                        color="success"
                                    >
                                        <VideocamIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        ) : null}
                    </>
                ) : null}

                {snap.call === 'incoming' ? (
                    <>
                        <RoundButton
                            color={GREEN}
                            title={t('answer')}
                            size={buttonSize}
                            onClick={() => void phone?.answer(options.video && options.sendCamera)}
                        >
                            <CallIcon />
                        </RoundButton>
                        {options.video && snap.incomingVideo && !options.sendCamera ? (
                            <RoundButton
                                color={BLUE}
                                title={t('answer_video')}
                                size={buttonSize}
                                onClick={() => void phone?.answer(true)}
                            >
                                <VideocamIcon />
                            </RoundButton>
                        ) : null}
                        <RoundButton
                            color={RED}
                            title={t('decline')}
                            size={buttonSize}
                            onClick={() => phone?.decline()}
                        >
                            <CallEndIcon />
                        </RoundButton>
                    </>
                ) : null}

                {inCall ? (
                    <>
                        <RoundButton
                            color={snap.muted ? RED : GREY}
                            title={snap.muted ? t('unmute') : t('mute')}
                            size={buttonSize * 0.8}
                            active={snap.muted}
                            onClick={() => phone?.toggleMute()}
                        >
                            {snap.muted ? <MicOffIcon /> : <MicIcon />}
                        </RoundButton>
                        {options.video ? (
                            <RoundButton
                                color={snap.cameraOn ? BLUE : GREY}
                                title={snap.cameraOn ? t('camera_off') : t('camera_on')}
                                size={buttonSize * 0.8}
                                active={snap.cameraOn}
                                onClick={() => void phone?.toggleCamera()}
                            >
                                {snap.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />}
                            </RoundButton>
                        ) : null}
                        <RoundButton
                            color={keypadInCall ? BLUE : GREY}
                            title={t('keypad')}
                            size={buttonSize * 0.8}
                            active={keypadInCall}
                            onClick={() => setKeypadInCall(v => !v)}
                        >
                            <DialpadIcon />
                        </RoundButton>
                        {options.actionLabel ? (
                            <Button
                                variant="contained"
                                startIcon={<ActionIcon />}
                                onClick={props.onAction}
                                sx={{ borderRadius: 99 }}
                            >
                                {options.actionLabel}
                            </Button>
                        ) : null}
                    </>
                ) : null}

                {inCall || snap.call === 'calling' ? (
                    <RoundButton
                        color={RED}
                        title={t('hangup')}
                        size={buttonSize}
                        onClick={() => phone?.hangup()}
                    >
                        <CallEndIcon />
                    </RoundButton>
                ) : null}
            </Box>
        </Box>
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
                    maxWidth="sm"
                    onClose={() => setMinimizedCall(callId)}
                    slotProps={{ paper: { sx: { height: 'min(720px, 90vh)', borderRadius: 3 } } }}
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

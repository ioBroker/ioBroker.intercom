import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { keyframes } from '@emotion/react';
import {
    Alert,
    Avatar,
    Box,
    Button,
    ButtonBase,
    Card,
    Checkbox,
    Chip,
    Collapse,
    Dialog,
    DialogContent,
    Divider,
    Fab,
    FormControlLabel,
    IconButton,
    InputAdornment,
    MenuItem,
    Stack,
    TextField,
    Tooltip,
    Typography,
    alpha,
} from '@mui/material';
import BackspaceOutlinedIcon from '@mui/icons-material/BackspaceOutlined';
import CallIcon from '@mui/icons-material/Call';
import CallEndIcon from '@mui/icons-material/CallEnd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import LogoutIcon from '@mui/icons-material/Logout';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SettingsIcon from '@mui/icons-material/Settings';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import { LevelMeter } from './LevelMeter';
import { listAudioDevices, type AudioDevices, type SipPhone } from './SipPhone';
import { StreamVideo } from './StreamVideo';
import { texts as t } from './i18n';

const STORE_KEY = 'iobroker-phone';

interface Stored {
    extension?: string;
    password?: string;
    remember?: boolean;
    microphone?: string;
    speaker?: string;
    camera?: string;
}

function loadStored(): Stored {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Stored;
    } catch {
        return {};
    }
}

function saveStored(data: Stored): void {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStored(), ...data }));
    } catch {
        // private mode: nothing is remembered
    }
}

function formatDuration(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

const pulse = keyframes`
    from { transform: scale(1); opacity: 0.7; }
    to { transform: scale(1.8); opacity: 0; }
`;
const shake = keyframes`
    0%, 50%, 100% { transform: rotate(0); }
    5%, 15%, 25%, 35%, 45% { transform: rotate(-14deg); }
    10%, 20%, 30%, 40% { transform: rotate(14deg); }
`;

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

/** Gradient of the app icon, the same as the primary buttons of admin 8 */
const BRAND_GRADIENT = 'linear-gradient(135deg, #48A1FA 0%, #0B76F5 100%)';

/** Framed area inside the card, like the panels in the mockup */
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

/** Collapsible panel with an icon and a title */
function CollapsePanel({
    icon,
    title,
    children,
    actions,
}: {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
}): React.JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <Panel sx={{ mt: 1.5 }}>
            <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', px: 2, py: 1.25 }}
            >
                <ButtonBase
                    onClick={() => setOpen(!open)}
                    sx={{ flex: 1, justifyContent: 'flex-start', gap: 1.5, borderRadius: 2, py: 0.5 }}
                >
                    <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box>
                    <Typography sx={{ fontWeight: 600, flex: 1, textAlign: 'left' }}>{title}</Typography>
                </ButtonBase>
                {open ? actions : null}
                <IconButton
                    size="small"
                    onClick={() => setOpen(!open)}
                    aria-expanded={open}
                >
                    <ExpandMoreIcon
                        sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                    />
                </IconButton>
            </Stack>
            <Collapse in={open}>
                <Box sx={{ px: 2, pb: 2 }}>{children}</Box>
            </Collapse>
        </Panel>
    );
}

interface PhoneProps {
    phone: SipPhone;
    /** Number preset in the dial field */
    defaultNumber: string;
}

export function Phone({ phone, defaultNumber }: PhoneProps): React.JSX.Element {
    const state = useSyncExternalStore(phone.subscribe, phone.getSnapshot);
    const stored = loadStored();
    const [extension, setExtension] = useState(stored.extension || '');
    const [password, setPassword] = useState('');
    const [remember, setRemember] = useState(!!stored.remember);
    const [number, setNumber] = useState(defaultNumber);
    const [devices, setDevices] = useState<AudioDevices | null>(null);
    const [microphone, setMicrophone] = useState(stored.microphone || '');
    const [speaker, setSpeaker] = useState(stored.speaker || '');
    const [camera, setCamera] = useState(stored.camera || '');
    const [now, setNow] = useState(() => Date.now());

    const loggedIn = state.registration !== 'offline' && !(state.registration === 'error' && !state.extension);
    const inCall = state.call !== 'none';

    // Restore devices and the remembered login once
    useEffect(() => {
        const s = loadStored();
        if (s.microphone) {
            phone.setMicrophone(s.microphone);
        }
        if (s.speaker) {
            phone.setSpeaker(s.speaker);
        }
        if (s.camera) {
            phone.setCamera(s.camera);
        }
        if (s.remember && s.extension && s.password) {
            phone.login(s.extension, s.password);
        }
        void listAudioDevices().then(setDevices);
    }, [phone]);

    // Device labels are only available after the microphone was opened once
    useEffect(() => {
        if (state.micActive || state.cameraOn) {
            void listAudioDevices().then(setDevices);
        }
    }, [phone, state.micActive, state.cameraOn]);

    // Call timer
    useEffect(() => {
        if (!state.callStart) {
            return;
        }
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [state.callStart]);

    // Incoming call: blinking title, notification and focus while the page is in the background
    useEffect(() => {
        if (state.call !== 'incoming') {
            return;
        }
        const title = document.title;
        let on = false;
        const timer = setInterval(() => {
            on = !on;
            document.title = on ? `📞 ${state.peer}` : title;
        }, 800);
        let notification: Notification | null = null;
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
            notification = new Notification(t.incoming, {
                body: state.peer,
                tag: 'iobroker-phone',
                requireInteraction: true,
            });
            notification.onclick = () => {
                window.focus();
                notification?.close();
            };
        }
        window.focus();
        return () => {
            clearInterval(timer);
            document.title = title;
            notification?.close();
        };
    }, [state.call, state.peer]);

    // Every click may unlock the audio (browsers only allow sound after a user gesture)
    useEffect(() => {
        const unlock = (): void => phone.unlockAudio();
        document.addEventListener('pointerdown', unlock, { capture: true });
        return () => document.removeEventListener('pointerdown', unlock, { capture: true });
    }, [phone]);

    // Keyboard input during a call is sent as DTMF
    useEffect(() => {
        if (state.call !== 'incall') {
            return;
        }
        const onKey = (e: KeyboardEvent): void => {
            if (/^[0-9*#]$/.test(e.key)) {
                phone.pressKey(e.key);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [phone, state.call]);

    const signIn = (): void => {
        const ext = extension.trim();
        if (!ext || !password) {
            return;
        }
        saveStored({ extension: ext, remember, password: remember ? password : '' });
        if ('Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
        phone.login(ext, password);
    };

    const signOut = (): void => {
        saveStored({ remember: false, password: '' });
        phone.logout();
    };

    const pressKey = (key: string): void => {
        phone.pressKey(key);
        if (!inCall) {
            setNumber(n => n + key);
        }
    };

    const chipColor = ({ registered: 'success', connecting: 'warning', error: 'error', offline: 'default' } as const)[
        state.registration
    ];

    let callText = '';
    if (state.call === 'calling') {
        callText = t.calling;
    } else if (state.call === 'incall') {
        callText = `${t.connected} · ${formatDuration(now - state.callStart)}`;
    }

    const stats = state.stats;
    // the picture area is shown as soon as one side sends video
    const showVideo = state.call === 'incall' && (state.remoteVideo || state.cameraOn);

    return (
        <Card
            variant="outlined"
            sx={{
                width: '100%',
                maxWidth: 420,
                borderRadius: '24px',
                boxShadow: theme =>
                    theme.palette.mode === 'dark'
                        ? '0 24px 60px rgba(0, 0, 0, 0.45)'
                        : '0 24px 60px rgba(15, 23, 42, 0.12)',
            }}
        >
            {/* header */}
            <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', px: 2.5, py: 2 }}
            >
                <Box
                    sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '11px',
                        background: BRAND_GRADIENT,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 14px rgba(19, 123, 248, 0.35)',
                    }}
                >
                    <CallIcon />
                </Box>
                <Typography
                    variant="h6"
                    sx={{ flex: 1, fontWeight: 700 }}
                >
                    {t.title}
                </Typography>
                <Tooltip title={state.error || ''}>
                    <Chip
                        variant="outlined"
                        color={chipColor}
                        label={t[state.registration]}
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
                {loggedIn ? (
                    <Tooltip title={t.signOut}>
                        <span>
                            <IconButton
                                onClick={signOut}
                                disabled={inCall}
                            >
                                <LogoutIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                ) : null}
            </Stack>
            <Divider />

            {loggedIn && state.audioLocked ? (
                <Alert
                    severity="warning"
                    sx={{ borderRadius: 0, cursor: 'pointer' }}
                    onClick={() => phone.unlockAudio()}
                >
                    {t.enableSound}
                </Alert>
            ) : null}

            <Box sx={{ p: 2.5 }}>
                {!loggedIn ? (
                    /* login */
                    <Box
                        component="form"
                        onSubmit={e => {
                            e.preventDefault();
                            signIn();
                        }}
                    >
                        {state.error ? (
                            <Alert
                                severity="error"
                                sx={{ mb: 2 }}
                            >
                                {state.error}
                            </Alert>
                        ) : null}
                        <TextField
                            label={t.extension}
                            value={extension}
                            onChange={e => setExtension(e.target.value)}
                            fullWidth
                            margin="dense"
                            autoComplete="username"
                            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                        />
                        <TextField
                            label={t.password}
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            fullWidth
                            margin="dense"
                            autoComplete="current-password"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={remember}
                                    onChange={e => setRemember(e.target.checked)}
                                />
                            }
                            label={<Typography variant="body2">{t.remember}</Typography>}
                        />
                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            size="large"
                            sx={{ mt: 1 }}
                            disabled={!extension.trim() || !password}
                        >
                            {t.signIn}
                        </Button>
                    </Box>
                ) : (
                    /* dialer */
                    <>
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            component="div"
                            align="center"
                            sx={{ mb: 1.5 }}
                        >
                            {t.signedInAs} {state.extension}
                        </Typography>

                        <Panel sx={{ px: 2, minHeight: 76, display: 'flex', alignItems: 'center' }}>
                            {inCall ? (
                                <Box sx={{ textAlign: 'center', width: '100%', py: 1 }}>
                                    <Typography
                                        variant="h5"
                                        sx={{ fontWeight: 600 }}
                                    >
                                        {state.peer}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color={state.call === 'incall' ? 'success.main' : 'text.secondary'}
                                    >
                                        {callText}
                                    </Typography>
                                </Box>
                            ) : (
                                <TextField
                                    variant="standard"
                                    value={number}
                                    onChange={e => setNumber(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            void phone.call(number);
                                        }
                                    }}
                                    fullWidth
                                    placeholder={t.number}
                                    slotProps={{
                                        htmlInput: {
                                            inputMode: 'numeric',
                                            'aria-label': t.number,
                                            style: {
                                                textAlign: 'center',
                                                fontSize: 36,
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
                                                        aria-label={t.backspace}
                                                        onClick={() => setNumber(n => n.slice(0, -1))}
                                                        sx={{ visibility: number ? 'visible' : 'hidden' }}
                                                    >
                                                        <BackspaceOutlinedIcon />
                                                    </IconButton>
                                                </InputAdornment>
                                            ),
                                        },
                                    }}
                                />
                            )}
                        </Panel>

                        {showVideo ? (
                            <Box
                                sx={{
                                    position: 'relative',
                                    mt: 1.5,
                                    borderRadius: '16px',
                                    overflow: 'hidden',
                                    bgcolor: '#000',
                                    aspectRatio: '4 / 3',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {state.remoteVideo ? (
                                    <StreamVideo
                                        stream={state.remoteStream}
                                        version={state.remoteVideo}
                                        style={{ objectFit: 'contain' }}
                                    />
                                ) : (
                                    <Typography
                                        variant="body2"
                                        sx={{ color: 'rgba(255, 255, 255, 0.7)', px: 2, textAlign: 'center' }}
                                    >
                                        {t.noRemoteVideo}
                                    </Typography>
                                )}
                                {state.cameraOn ? (
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
                                            stream={state.localStream}
                                            version={state.cameraLabel}
                                            mirrored
                                        />
                                    </Box>
                                ) : null}
                            </Box>
                        ) : null}

                        {/* during a video call the keyboard still sends DTMF */}
                        {state.call !== 'calling' && !showVideo ? (
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25, my: 2 }}>
                                {KEYS.map(([key, letters]) => (
                                    <ButtonBase
                                        key={key}
                                        onClick={() => pressKey(key)}
                                        sx={theme => ({
                                            height: 64,
                                            borderRadius: '16px',
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
                                        <Typography sx={{ fontSize: 26, fontWeight: 500, lineHeight: 1 }}>
                                            {key}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                letterSpacing: 2,
                                                color: 'text.secondary',
                                                minHeight: 14,
                                                mt: 0.25,
                                            }}
                                        >
                                            {letters}
                                        </Typography>
                                    </ButtonBase>
                                ))}
                            </Box>
                        ) : (
                            <Box sx={{ height: showVideo ? 20 : 32 }} />
                        )}

                        <Stack
                            direction="row"
                            spacing={3}
                            sx={{ justifyContent: 'center', alignItems: 'center', mb: 2.5 }}
                        >
                            {state.call === 'incall' ? (
                                <Tooltip title={state.muted ? t.unmute : t.mute}>
                                    <Fab
                                        color={state.muted ? 'error' : 'default'}
                                        onClick={() => phone.toggleMute()}
                                    >
                                        {state.muted ? <MicOffIcon /> : <MicIcon />}
                                    </Fab>
                                </Tooltip>
                            ) : null}
                            {state.call === 'incall' ? (
                                <Tooltip title={state.cameraOn ? t.cameraOff : t.cameraOn}>
                                    <Fab
                                        color={state.cameraOn ? 'primary' : 'default'}
                                        onClick={() => void phone.toggleCamera()}
                                    >
                                        {state.cameraOn ? <VideocamIcon /> : <VideocamOffIcon />}
                                    </Fab>
                                </Tooltip>
                            ) : null}
                            {inCall ? (
                                <Tooltip title={t.hangup}>
                                    <Fab
                                        color="error"
                                        onClick={() => phone.hangup()}
                                        sx={{
                                            width: 72,
                                            height: 72,
                                            boxShadow: theme => `0 0 28px ${alpha(theme.palette.error.main, 0.55)}`,
                                        }}
                                    >
                                        <CallEndIcon sx={{ fontSize: 32 }} />
                                    </Fab>
                                </Tooltip>
                            ) : (
                                <>
                                    <Tooltip title={t.call}>
                                        <span>
                                            <Fab
                                                color="success"
                                                onClick={() => void phone.call(number)}
                                                disabled={state.registration !== 'registered' || !number.trim()}
                                                sx={{
                                                    width: 72,
                                                    height: 72,
                                                    boxShadow: theme =>
                                                        `0 0 28px ${alpha(theme.palette.success.main, 0.55)}`,
                                                }}
                                            >
                                                <CallIcon sx={{ fontSize: 32 }} />
                                            </Fab>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title={t.videoCall}>
                                        <span>
                                            <Fab
                                                color="primary"
                                                onClick={() => void phone.call(number, true)}
                                                disabled={state.registration !== 'registered' || !number.trim()}
                                                sx={{ width: 64, height: 64 }}
                                            >
                                                <VideocamIcon />
                                            </Fab>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title={t.audioTest}>
                                        <Fab
                                            onClick={() => void phone.audioTest()}
                                            sx={{ width: 64, height: 64 }}
                                        >
                                            <GraphicEqIcon />
                                        </Fab>
                                    </Tooltip>
                                </>
                            )}
                        </Stack>

                        {/* level meters and statistics */}
                        <Panel sx={{ px: 2.5, py: 1.5 }}>
                            <LevelMeter
                                icon={<MicIcon />}
                                label={t.microphone}
                                getLevel={() => phone.getLevels().mic}
                            />
                            <LevelMeter
                                icon={<VolumeUpIcon />}
                                label={t.speaker}
                                getLevel={() => phone.getLevels().speaker}
                            />
                            {(stats && state.call === 'incall') || state.lastCallEnd || state.micActive ? (
                                <Divider sx={{ my: 1.25 }} />
                            ) : null}
                            <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {stats && state.call === 'incall' ? (
                                    <Typography variant="body2">
                                        ↑ {stats.sent} · ↓ {stats.received}
                                        {stats.lost ? ` (−${stats.lost})` : ''}
                                        {stats.codec ? ` · ${stats.codec}` : ''}
                                        {stats.rtt !== null ? ` · RTT ${stats.rtt} ms` : ''}
                                        {stats.videoCodec
                                            ? ` · ${stats.videoCodec}${stats.videoSize ? ` ${stats.videoSize}` : ''}`
                                            : ''}
                                        {stats.warning ? (
                                            <Box
                                                component="span"
                                                sx={{ color: 'error.main', fontWeight: 600, display: 'block' }}
                                            >
                                                {t[stats.warning]}
                                            </Box>
                                        ) : null}
                                    </Typography>
                                ) : state.lastCallEnd ? (
                                    <Typography variant="body2">
                                        <Box
                                            component="span"
                                            sx={{ fontWeight: 600 }}
                                        >
                                            {t.callEnded}:
                                        </Box>{' '}
                                        <Box
                                            component="span"
                                            sx={{ color: 'text.secondary' }}
                                        >
                                            {state.lastCallEnd}
                                        </Box>
                                    </Typography>
                                ) : null}
                                {state.micActive ? (
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        component="div"
                                        noWrap
                                        title={state.micLabel}
                                        sx={{ mt: 0.5 }}
                                    >
                                        {t.micInUse}: {state.micLabel}
                                    </Typography>
                                ) : null}
                                {state.cameraOn ? (
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        component="div"
                                        noWrap
                                        title={state.cameraLabel}
                                    >
                                        {t.cameraInUse}: {state.cameraLabel}
                                    </Typography>
                                ) : null}
                            </Box>
                        </Panel>
                    </>
                )}

                {/* devices */}
                <CollapsePanel
                    icon={<SettingsIcon />}
                    title={t.devices}
                >
                    <TextField
                        select
                        fullWidth
                        margin="dense"
                        label={t.microphone}
                        value={microphone}
                        onChange={e => {
                            setMicrophone(e.target.value);
                            saveStored({ microphone: e.target.value });
                            phone.setMicrophone(e.target.value);
                        }}
                        slotProps={{
                            select: { displayEmpty: true },
                            inputLabel: { shrink: true },
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <MicIcon />
                                    </InputAdornment>
                                ),
                            },
                        }}
                    >
                        <MenuItem value="">{t.defaultDevice}</MenuItem>
                        {devices?.microphones.map((d, i) => (
                            <MenuItem
                                key={d.deviceId}
                                value={d.deviceId}
                            >
                                {d.label || `${t.microphone} ${i + 1}`}
                            </MenuItem>
                        ))}
                    </TextField>
                    {devices?.canSelectSpeaker ? (
                        <TextField
                            select
                            fullWidth
                            margin="dense"
                            label={t.speaker}
                            value={speaker}
                            onChange={e => {
                                setSpeaker(e.target.value);
                                saveStored({ speaker: e.target.value });
                                phone.setSpeaker(e.target.value);
                            }}
                            slotProps={{
                                select: { displayEmpty: true },
                                inputLabel: { shrink: true },
                                input: {
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <VolumeUpIcon />
                                        </InputAdornment>
                                    ),
                                },
                            }}
                        >
                            <MenuItem value="">{t.defaultDevice}</MenuItem>
                            {devices.speakers.map((d, i) => (
                                <MenuItem
                                    key={d.deviceId}
                                    value={d.deviceId}
                                >
                                    {d.label || `${t.speaker} ${i + 1}`}
                                </MenuItem>
                            ))}
                        </TextField>
                    ) : null}
                    <TextField
                        select
                        fullWidth
                        margin="dense"
                        label={t.camera}
                        value={camera}
                        onChange={e => {
                            setCamera(e.target.value);
                            saveStored({ camera: e.target.value });
                            phone.setCamera(e.target.value);
                        }}
                        slotProps={{
                            select: { displayEmpty: true },
                            inputLabel: { shrink: true },
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <VideocamIcon />
                                    </InputAdornment>
                                ),
                            },
                        }}
                    >
                        <MenuItem value="">{t.defaultDevice}</MenuItem>
                        {devices?.cameras.map((d, i) => (
                            <MenuItem
                                key={d.deviceId}
                                value={d.deviceId}
                            >
                                {d.label || `${t.camera} ${i + 1}`}
                            </MenuItem>
                        ))}
                    </TextField>
                </CollapsePanel>

                {/* log */}
                <CollapsePanel
                    icon={<ReceiptLongIcon />}
                    title={`${t.log} (${state.log.length})`}
                    actions={
                        <>
                            <Tooltip title={t.copyLog}>
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={!state.log.length}
                                        onClick={() =>
                                            void navigator.clipboard?.writeText(
                                                state.log
                                                    .map(l => `${new Date(l.ts).toLocaleTimeString()} ${l.text}`)
                                                    .reverse()
                                                    .join('\n'),
                                            )
                                        }
                                    >
                                        <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title={t.clearLog}>
                                <span>
                                    <IconButton
                                        size="small"
                                        disabled={!state.log.length}
                                        onClick={() => phone.clearLog()}
                                    >
                                        <DeleteSweepIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </>
                    }
                >
                    <Box
                        sx={{
                            fontFamily: 'ui-monospace, Consolas, monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                            maxHeight: 260,
                            overflow: 'auto',
                            bgcolor: 'action.hover',
                            borderRadius: '10px',
                            p: 1.25,
                        }}
                    >
                        {state.log.length ? (
                            state.log.map(l => (
                                <div key={l.id}>
                                    <Box
                                        component="span"
                                        sx={{ color: 'text.secondary' }}
                                    >
                                        {new Date(l.ts).toLocaleTimeString()}
                                    </Box>{' '}
                                    {l.text}
                                </div>
                            ))
                        ) : (
                            <Box sx={{ color: 'text.secondary' }}>{t.emptyLog}</Box>
                        )}
                    </Box>
                </CollapsePanel>
            </Box>

            {/* incoming call */}
            <Dialog
                open={state.call === 'incoming'}
                slotProps={{ paper: { sx: { borderRadius: '24px', width: 340 } } }}
            >
                <DialogContent sx={{ textAlign: 'center', pt: 5, pb: 4 }}>
                    <Box sx={{ position: 'relative', width: 96, height: 96, mx: 'auto', mb: 3 }}>
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
                    <Typography
                        variant="h5"
                        sx={{ fontWeight: 600 }}
                    >
                        {state.peer}
                    </Typography>
                    <Typography color="text.secondary">{state.incomingVideo ? t.incomingVideo : t.incoming}</Typography>
                    <Stack
                        direction="row"
                        spacing={state.incomingVideo ? 3 : 6}
                        sx={{ justifyContent: 'center', mt: 4 }}
                    >
                        <Tooltip title={t.decline}>
                            <Fab
                                color="error"
                                onClick={() => phone.decline()}
                                sx={{ width: 64, height: 64 }}
                            >
                                <CallEndIcon />
                            </Fab>
                        </Tooltip>
                        <Tooltip title={t.answer}>
                            <Fab
                                color="success"
                                onClick={() => void phone.answer()}
                                sx={{
                                    width: 64,
                                    height: 64,
                                    boxShadow: theme => `0 0 24px ${alpha(theme.palette.success.main, 0.55)}`,
                                }}
                            >
                                <CallIcon />
                            </Fab>
                        </Tooltip>
                        {state.incomingVideo ? (
                            <Tooltip title={t.answerVideo}>
                                <Fab
                                    color="primary"
                                    onClick={() => void phone.answer(true)}
                                    sx={{
                                        width: 64,
                                        height: 64,
                                        boxShadow: theme => `0 0 24px ${alpha(theme.palette.primary.main, 0.55)}`,
                                    }}
                                >
                                    <VideocamIcon />
                                </Fab>
                            </Tooltip>
                        ) : null}
                    </Stack>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

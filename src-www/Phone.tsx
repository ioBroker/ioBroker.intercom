import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { keyframes } from '@emotion/react';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Avatar,
    Box,
    Button,
    ButtonBase,
    Card,
    Checkbox,
    Chip,
    Dialog,
    DialogContent,
    Divider,
    Fab,
    FormControl,
    FormControlLabel,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
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
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import { LevelMeter } from './LevelMeter';
import { listAudioDevices, type AudioDevices, type SipPhone } from './SipPhone';
import { texts as t } from './i18n';

const STORE_KEY = 'iobroker-phone';

interface Stored {
    extension?: string;
    password?: string;
    remember?: boolean;
    microphone?: string;
    speaker?: string;
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
        if (s.remember && s.extension && s.password) {
            phone.login(s.extension, s.password);
        }
        void listAudioDevices().then(setDevices);
    }, [phone]);

    // Device labels are only available after the microphone was opened once
    useEffect(() => {
        if (state.micActive) {
            void listAudioDevices().then(setDevices);
        }
    }, [phone, state.micActive]);

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

    return (
        <Card
            sx={{ width: '100%', maxWidth: 400, borderRadius: 4 }}
            elevation={6}
        >
            {/* header */}
            <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', px: 2, py: 1.5 }}
            >
                <Typography
                    variant="subtitle1"
                    sx={{ flex: 1, fontWeight: 600 }}
                >
                    {t.title}
                </Typography>
                <Tooltip title={state.error || ''}>
                    <Chip
                        size="small"
                        color={chipColor}
                        label={t[state.registration]}
                        variant="outlined"
                    />
                </Tooltip>
                {loggedIn ? (
                    <Tooltip title={t.signOut}>
                        <IconButton
                            size="small"
                            onClick={signOut}
                            disabled={inCall}
                        >
                            <LogoutIcon fontSize="small" />
                        </IconButton>
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

            {!loggedIn ? (
                /* login */
                <Box
                    component="form"
                    sx={{ p: 2.5 }}
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
                <Box sx={{ p: 2.5, pb: 2 }}>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        align="center"
                    >
                        {t.signedInAs} {state.extension}
                    </Typography>

                    {inCall ? (
                        <Box sx={{ textAlign: 'center', minHeight: 64, mt: 1 }}>
                            <Typography
                                variant="h5"
                                sx={{ fontWeight: 600 }}
                            >
                                {state.peer}
                            </Typography>
                            <Typography
                                variant="body2"
                                color="text.secondary"
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
                            sx={{ mt: 1 }}
                            slotProps={{
                                htmlInput: {
                                    inputMode: 'numeric',
                                    style: { textAlign: 'center', fontSize: 30, letterSpacing: 1 },
                                },
                                input: {
                                    disableUnderline: true,
                                    endAdornment: number ? (
                                        <InputAdornment position="end">
                                            <IconButton
                                                aria-label={t.backspace}
                                                onClick={() => setNumber(n => n.slice(0, -1))}
                                            >
                                                <BackspaceOutlinedIcon />
                                            </IconButton>
                                        </InputAdornment>
                                    ) : null,
                                },
                            }}
                        />
                    )}

                    {state.call !== 'calling' ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.25, my: 2 }}>
                            {KEYS.map(([key, letters]) => (
                                <ButtonBase
                                    key={key}
                                    onClick={() => pressKey(key)}
                                    sx={{
                                        height: 56,
                                        borderRadius: 3.5,
                                        bgcolor: 'action.hover',
                                        flexDirection: 'column',
                                        '&:hover': { bgcolor: 'action.selected' },
                                    }}
                                >
                                    <Typography sx={{ fontSize: 22, lineHeight: 1 }}>{key}</Typography>
                                    <Typography
                                        sx={{ fontSize: 9, letterSpacing: 1.5, color: 'text.secondary', minHeight: 12 }}
                                    >
                                        {letters}
                                    </Typography>
                                </ButtonBase>
                            ))}
                        </Box>
                    ) : (
                        <Box sx={{ height: 24 }} />
                    )}

                    <Stack
                        direction="row"
                        spacing={3}
                        sx={{ justifyContent: 'center', alignItems: 'center' }}
                    >
                        {state.call === 'incall' ? (
                            <Tooltip title={state.muted ? t.unmute : t.mute}>
                                <Fab
                                    size="medium"
                                    color={state.muted ? 'error' : 'default'}
                                    onClick={() => phone.toggleMute()}
                                >
                                    {state.muted ? <MicOffIcon /> : <MicIcon />}
                                </Fab>
                            </Tooltip>
                        ) : null}
                        {inCall ? (
                            <Tooltip title={t.hangup}>
                                <Fab
                                    color="error"
                                    onClick={() => phone.hangup()}
                                >
                                    <CallEndIcon />
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
                                        >
                                            <CallIcon />
                                        </Fab>
                                    </span>
                                </Tooltip>
                                <Tooltip title={t.audioTest}>
                                    <Fab
                                        size="medium"
                                        onClick={() => void phone.audioTest()}
                                    >
                                        <GraphicEqIcon />
                                    </Fab>
                                </Tooltip>
                            </>
                        )}
                    </Stack>
                </Box>
            )}

            {loggedIn ? (
                /* level meters and statistics */
                <>
                    <Divider />
                    <Box sx={{ px: 2.5, py: 1.5 }}>
                        <LevelMeter
                            icon={<MicIcon fontSize="small" />}
                            label={t.microphone}
                            getLevel={() => phone.getLevels().mic}
                        />
                        <LevelMeter
                            icon={<VolumeUpIcon fontSize="small" />}
                            label={t.speaker}
                            getLevel={() => phone.getLevels().speaker}
                        />
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{ mt: 1, minHeight: 20, fontVariantNumeric: 'tabular-nums' }}
                        >
                            {stats && state.call === 'incall' ? (
                                <>
                                    ↑ {stats.sent} · ↓ {stats.received}
                                    {stats.lost ? ` (−${stats.lost})` : ''}
                                    {stats.codec ? ` · ${stats.codec}` : ''}
                                    {stats.rtt !== null ? ` · RTT ${stats.rtt} ms` : ''}
                                    {stats.warning ? (
                                        <Box
                                            component="span"
                                            sx={{ color: 'error.main', fontWeight: 600 }}
                                        >
                                            {' · '}
                                            {t[stats.warning]}
                                        </Box>
                                    ) : null}
                                </>
                            ) : state.lastCallEnd ? (
                                `${t.callEnded}: ${state.lastCallEnd}`
                            ) : null}
                        </Typography>
                    </Box>
                </>
            ) : null}

            {/* devices */}
            <Accordion
                disableGutters
                elevation={0}
                square
                sx={{ borderTop: 1, borderColor: 'divider', '&::before': { display: 'none' } }}
            >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        {t.devices}
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    <FormControl
                        fullWidth
                        size="small"
                        margin="dense"
                    >
                        <InputLabel>{t.microphone}</InputLabel>
                        <Select
                            label={t.microphone}
                            value={microphone}
                            onChange={e => {
                                setMicrophone(e.target.value);
                                saveStored({ microphone: e.target.value });
                                phone.setMicrophone(e.target.value);
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
                        </Select>
                    </FormControl>
                    {devices?.canSelectSpeaker ? (
                        <FormControl
                            fullWidth
                            size="small"
                            margin="dense"
                        >
                            <InputLabel>{t.speaker}</InputLabel>
                            <Select
                                label={t.speaker}
                                value={speaker}
                                onChange={e => {
                                    setSpeaker(e.target.value);
                                    saveStored({ speaker: e.target.value });
                                    phone.setSpeaker(e.target.value);
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
                            </Select>
                        </FormControl>
                    ) : null}
                </AccordionDetails>
            </Accordion>

            {/* log */}
            <Accordion
                disableGutters
                elevation={0}
                square
                sx={{ borderTop: 1, borderColor: 'divider', '&::before': { display: 'none' } }}
            >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography
                        variant="body2"
                        color="text.secondary"
                    >
                        {t.log} ({state.log.length})
                    </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                    <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ justifyContent: 'flex-end' }}
                    >
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
                    </Stack>
                    <Box
                        sx={{
                            fontFamily: 'ui-monospace, Consolas, monospace',
                            fontSize: 12,
                            lineHeight: 1.5,
                            maxHeight: 240,
                            overflow: 'auto',
                            bgcolor: 'action.hover',
                            borderRadius: 2,
                            p: 1.25,
                            mt: 0.5,
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
                </AccordionDetails>
            </Accordion>

            {/* incoming call */}
            <Dialog
                open={state.call === 'incoming'}
                slotProps={{ paper: { sx: { borderRadius: 5, width: 340 } } }}
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
                            <CallIcon sx={{ fontSize: 44, animation: `${shake} 1.2s infinite` }} />
                        </Avatar>
                    </Box>
                    <Typography
                        variant="h5"
                        sx={{ fontWeight: 600 }}
                    >
                        {state.peer}
                    </Typography>
                    <Typography color="text.secondary">{t.incoming}</Typography>
                    <Stack
                        direction="row"
                        spacing={6}
                        sx={{ justifyContent: 'center', mt: 4 }}
                    >
                        <Tooltip title={t.decline}>
                            <Fab
                                color="error"
                                onClick={() => phone.decline()}
                            >
                                <CallEndIcon />
                            </Fab>
                        </Tooltip>
                        <Tooltip title={t.answer}>
                            <Fab
                                color="success"
                                onClick={() => void phone.answer()}
                            >
                                <CallIcon />
                            </Fab>
                        </Tooltip>
                    </Stack>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

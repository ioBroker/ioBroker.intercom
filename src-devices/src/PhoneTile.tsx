/**
 * The phone on a small tile: whether it is ready or who is calling, and on a 2x1 tile the picture of the door.
 * A click opens the whole phone in a dialog.
 */
import React from 'react';
import { Avatar, Box, Typography, keyframes } from '@mui/material';
import {
    Call as CallIcon,
    PhoneDisabled as OfflineIcon,
    PhoneInTalk as InCallIcon,
    RingVolume as RingingIcon,
} from '@mui/icons-material';

import type { PhoneSnapshot } from '../../src-www/src/SipPhone';
import { CameraImage } from '../../src-shared/src/CameraImage';
import { CallTimer } from '../../src-shared/src/PhoneView';
import type { PhoneViewOptions } from '../../src-shared/src/phoneSettings';

/** The tile sizes of the devices app */
export type TileSize = '1x1' | '2x0.5' | '2x1' | '2x2';

const pulse = keyframes`
    from { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.6); }
    to { box-shadow: 0 0 0 16px rgba(46, 125, 50, 0); }
`;

interface PhoneTileProps {
    snap: PhoneSnapshot;
    options: PhoneViewOptions;
    title: string;
    /** Translated problem that prevents the start */
    problem: string;
    size: Exclude<TileSize, '2x2'>;
    t: (key: string) => string;
    onClick: () => void;
}

export function PhoneTile({ snap, options, title, problem, size, t, onClick }: PhoneTileProps): React.JSX.Element {
    const inCall = snap.call !== 'none';
    const registered = snap.registration === 'registered';
    const row = size === '2x0.5';

    let status: React.ReactNode;
    let Icon = registered ? CallIcon : OfflineIcon;
    if (problem) {
        status = problem;
    } else if (snap.call === 'incoming') {
        status = snap.peer ? `${t('incoming')}: ${snap.peer}` : t('incoming');
        Icon = RingingIcon;
    } else if (snap.call === 'calling') {
        status = snap.peer ? `${t('calling')} ${snap.peer}` : t('calling');
        Icon = InCallIcon;
    } else if (snap.call === 'incall') {
        status = (
            <>
                {snap.peer || t('connected')} · <CallTimer start={snap.callStart} />
            </>
        );
        Icon = InCallIcon;
    } else if (snap.registration === 'error') {
        status = snap.error ? `${t('error')}: ${snap.error}` : t('error');
    } else {
        status = t(snap.registration);
    }

    let color = 'action.disabled';
    if (inCall) {
        color = 'success.main';
    } else if (problem || snap.registration === 'error') {
        color = 'error.main';
    } else if (registered) {
        color = 'primary.main';
    }

    const showCamera = size === '2x1' && !!options.cameraSrc && (options.cameraAlways || inCall);
    // a 2x½ tile is a row; the other ones have the icon at the top and the text at the bottom
    const avatarSize = row ? 'max(28px, 7cqi)' : size === '2x1' ? 'max(44px, 15cqi)' : 'max(44px, 30cqi)';

    return (
        <Box
            onClick={onClick}
            sx={{ display: 'flex', width: '100%', height: '100%', cursor: 'pointer', boxSizing: 'border-box' }}
        >
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: row ? 'row' : 'column',
                    alignItems: row ? 'center' : 'flex-start',
                    justifyContent: 'space-between',
                    gap: row ? 1.5 : 0,
                    flex: 1,
                    minWidth: 0,
                    p: row ? '0 12px' : 'max(12px, 8cqi)',
                    boxSizing: 'border-box',
                }}
            >
                <Avatar
                    sx={{
                        width: avatarSize,
                        height: avatarSize,
                        bgcolor: color,
                        color: '#fff',
                        animation: snap.call === 'incoming' ? `${pulse} 1.2s ease-out infinite` : undefined,
                        '& svg': { fontSize: '55%' },
                    }}
                >
                    <Icon />
                </Avatar>
                <Box sx={{ minWidth: 0, flex: row ? 1 : undefined, width: row ? undefined : '100%' }}>
                    <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontWeight: 600 }}
                    >
                        {title}
                    </Typography>
                    <Typography
                        variant="caption"
                        component="div"
                        noWrap
                        sx={{ color: problem ? 'error.main' : 'text.secondary' }}
                    >
                        {status}
                    </Typography>
                </Box>
            </Box>
            {showCamera ? (
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        m: 1,
                        borderRadius: '12px',
                        overflow: 'hidden',
                        bgcolor: '#000',
                    }}
                >
                    <CameraImage
                        src={options.cameraSrc}
                        refresh={options.cameraRefresh}
                        alt={t('camera')}
                    />
                </Box>
            ) : null}
        </Box>
    );
}

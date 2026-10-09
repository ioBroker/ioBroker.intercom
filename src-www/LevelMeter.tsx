import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';

interface LevelMeterProps {
    icon: React.ReactNode;
    label: string;
    /** Returns the current level in dBFS, `null` if there is no source. Polled in every animation frame */
    getLevel: () => number | null;
}

/** Horizontal level bar with peak hold. Updated directly in the DOM, not by re-rendering */
export function LevelMeter({ icon, label, getLevel }: LevelMeterProps): React.JSX.Element {
    const fillRef = useRef<HTMLDivElement>(null);
    const peakRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const getLevelRef = useRef(getLevel);
    useEffect(() => {
        getLevelRef.current = getLevel;
    });

    useEffect(() => {
        let peak = 0;
        let frame = 0;
        const draw = (): void => {
            const db = getLevelRef.current();
            // -60 dB .. 0 dB => 0 .. 100 %
            const pct = db === null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
            peak = Math.max(pct, peak - 0.6);
            if (fillRef.current) {
                fillRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0 round 5px)`;
            }
            if (peakRef.current) {
                peakRef.current.style.left = `calc(${peak}% - 2px)`;
                peakRef.current.style.opacity = peak > 1 ? '0.6' : '0';
            }
            if (textRef.current) {
                textRef.current.textContent = db === null || db <= -100 ? '–' : `${Math.round(db)} dB`;
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frame);
    }, []);

    return (
        <Box
            sx={{ display: 'grid', gridTemplateColumns: '24px 1fr 48px', alignItems: 'center', gap: 1.5, my: 0.75 }}
            title={label}
        >
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
            <Box
                sx={{
                    position: 'relative',
                    height: 10,
                    borderRadius: '5px',
                    bgcolor: 'action.hover',
                }}
                role="meter"
                aria-label={label}
            >
                <Box
                    ref={fillRef}
                    sx={theme => ({
                        position: 'absolute',
                        inset: 0,
                        borderRadius: '5px',
                        // the gradient spans the whole bar, the clip path shows the current level
                        background: `linear-gradient(90deg, ${theme.palette.success.main} 0%, ${theme.palette.success.main} 65%, ${theme.palette.warning.main} 82%, ${theme.palette.error.main} 100%)`,
                        clipPath: 'inset(0 100% 0 0)',
                    })}
                />
                <Box
                    ref={peakRef}
                    sx={{ position: 'absolute', top: 0, bottom: 0, width: 2, bgcolor: 'text.primary', opacity: 0 }}
                />
            </Box>
            <Typography
                ref={textRef}
                component="span"
                variant="caption"
                sx={{ color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            >
                –
            </Typography>
        </Box>
    );
}

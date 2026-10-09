import React, { useEffect, useRef } from 'react';
import { Box, Typography, useTheme } from '@mui/material';

interface LevelMeterProps {
    icon: React.ReactNode;
    label: string;
    /** Returns the current level in dBFS, `null` if there is no source. Polled in every animation frame */
    getLevel: () => number | null;
}

const SEGMENTS = 24;

/** Segmented level meter (LED style) with peak hold. Updated directly in the DOM, not by re-rendering */
export function LevelMeter({ icon, label, getLevel }: LevelMeterProps): React.JSX.Element {
    const theme = useTheme();
    const segmentsRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);
    const getLevelRef = useRef(getLevel);
    useEffect(() => {
        getLevelRef.current = getLevel;
    });

    useEffect(() => {
        const colorOf = (i: number): string =>
            i >= SEGMENTS - 3
                ? theme.palette.error.main
                : i >= SEGMENTS - 7
                  ? theme.palette.warning.main
                  : theme.palette.success.main;
        let peak = 0;
        let frame = 0;
        const draw = (): void => {
            const db = getLevelRef.current();
            // -60 dB .. 0 dB => 0 .. SEGMENTS
            const lit = db === null ? 0 : Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * SEGMENTS);
            peak = Math.max(lit, peak - 0.08);
            const peakIndex = Math.round(peak) - 1;
            const children = segmentsRef.current?.children;
            if (children) {
                for (let i = 0; i < children.length; i++) {
                    const el = children[i] as HTMLElement;
                    const on = i < lit || (i === peakIndex && peakIndex >= lit);
                    el.style.backgroundColor = on ? colorOf(i) : '';
                    el.style.boxShadow = on ? `0 0 6px ${colorOf(i)}66` : '';
                }
            }
            if (textRef.current) {
                textRef.current.textContent = db === null || db <= -100 ? '–' : `${Math.round(db)} dB`;
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(frame);
    }, [theme]);

    return (
        <Box
            sx={{ display: 'grid', gridTemplateColumns: '28px 1fr 52px', alignItems: 'center', gap: 1.5, my: 1 }}
            title={label}
        >
            <Box sx={{ color: 'text.secondary', display: 'flex' }}>{icon}</Box>
            <Box
                ref={segmentsRef}
                role="meter"
                aria-label={label}
                sx={{ display: 'grid', gridTemplateColumns: `repeat(${SEGMENTS}, 1fr)`, gap: '3px', height: 12 }}
            >
                {Array.from({ length: SEGMENTS }, (_, i) => (
                    <Box
                        key={i}
                        sx={{
                            borderRadius: '2px',
                            bgcolor: 'action.selected',
                            transition: 'background-color 60ms linear',
                        }}
                    />
                ))}
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

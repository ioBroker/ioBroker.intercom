import React, { useEffect, useRef } from 'react';

interface StreamVideoProps {
    stream: MediaStream | null;
    /** Changes when tracks were added to or removed from the same stream */
    version?: string | number | boolean;
    /** Mirror the picture, as expected for the own camera */
    mirrored?: boolean;
    style?: React.CSSProperties;
}

/** Shows the picture of a media stream. Always muted: the sound is played by the phone itself */
export function StreamVideo({ stream, version, mirrored, style }: StreamVideoProps): React.JSX.Element {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = ref.current;
        if (!video) {
            return;
        }
        // set again for a changed track list of the same stream
        video.srcObject = null;
        video.srcObject = stream;
        if (stream) {
            video.play().catch(() => {
                // autoplay of a muted video is always allowed; a failure only means it was replaced
            });
        }
    }, [stream, version]);

    return (
        <video
            ref={ref}
            autoPlay
            playsInline
            muted
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: mirrored ? 'scaleX(-1)' : undefined,
                ...style,
            }}
        />
    );
}

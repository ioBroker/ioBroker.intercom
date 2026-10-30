import React, { useEffect, useState } from 'react';

interface CameraImageProps {
    /** URL of a snapshot or of an MJPEG stream, or a data URL; '' while there is no picture yet */
    src: string;
    /** Reload a snapshot every n seconds. 0: load once (MJPEG streams and data URLs) */
    refresh: number;
    alt: string;
}

/** Picture of a camera, e.g. of the door, for a call without video */
export function CameraImage({ src, refresh, alt }: CameraImageProps): React.JSX.Element {
    const [tick, setTick] = useState(0);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!refresh || refresh < 0 || src.startsWith('data:')) {
            return;
        }
        const timer = setInterval(() => setTick(t => t + 1), Math.max(0.5, refresh) * 1000);
        return () => clearInterval(timer);
    }, [src, refresh]);

    if (!src) {
        return <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 12, padding: 8 }}>…</span>;
    }

    let url = src;
    if (tick && !src.startsWith('data:')) {
        // bypass the browser cache for snapshots
        url = `${src}${src.includes('?') ? '&' : '?'}_ts=${tick}`;
    }

    return (
        <img
            src={url}
            alt={alt}
            onError={() => setFailed(true)}
            onLoad={() => setFailed(false)}
            style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: failed ? 0.3 : 1,
            }}
        />
    );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { CameraImage } from './CameraImage';
import { frigateStreamUrl, isCloud, type FrigateWebUrl } from './frigate';
import type { CameraSource, FrigateMode, PhoneHost } from './phoneSettings';

/** How long to wait for `frigate:getWebUrl`: an adapter too old to know the command never answers */
const RESOLVE_TIMEOUT = 3000;
/** How long the stream may take for its first frame before the pictures come over the socket */
const STREAM_TIMEOUT = 10000;
/** Frames per second of the stream, and of the pictures over the socket if the stream fails */
const STREAM_FPS = 5;

const IMAGE_STYLE: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };

interface FrigateImageProps {
    host: PhoneHost;
    instance: string;
    camera: string;
    mode: FrigateMode;
    /** Seconds between two snapshots */
    refresh: number;
    /** Height of the picture Frigate delivers */
    height: number;
    alt: string;
}

/**
 * Picture of a camera of the frigate adapter.
 *
 * `snapshot`: single pictures over the socket, which also works through the ioBroker cloud and with the login of
 * Frigate. `stream`: the MJPEG stream of the web extension of the adapter. It is not possible through the cloud, and
 * an https page - the phone needs one - cannot load it from an http web instance; it can also fail or never start.
 * In all these cases the pictures come over the socket, as with the widgets of the frigate adapter itself.
 */
function FrigateImage({ host, instance, camera, mode, refresh, height, alt }: FrigateImageProps): React.JSX.Element {
    const wantStream = mode === 'stream' && !isCloud(window.location.hostname);
    // undefined: still asking the adapter; null: no stream
    const [stream, setStream] = useState<{ key: string; url: string | null } | undefined>(undefined);
    const [failedUrl, setFailedUrl] = useState('');
    const [loadedUrl, setLoadedUrl] = useState('');
    const [frame, setFrame] = useState<{ key: string; src: string; error: string }>({ key: '', src: '', error: '' });
    const streamImg = useRef<HTMLImageElement | null>(null);

    const key = `${instance}/${camera}/${height}`;
    const streamUrl = wantStream && stream?.key === key ? stream.url : null;
    const resolving = wantStream && stream?.key !== key;
    const useSocket = !resolving && (!streamUrl || streamUrl === failedUrl);

    // where the web extension of the adapter serves the stream
    useEffect(() => {
        if (!wantStream) {
            return;
        }
        let done = false;
        const finish = (answer: FrigateWebUrl | null): void => {
            if (!done) {
                done = true;
                setStream({
                    key,
                    url: frigateStreamUrl(answer, instance, camera, { fps: STREAM_FPS, height }, window.location),
                });
            }
        };
        const timer = setTimeout(() => finish(null), RESOLVE_TIMEOUT);
        host.sendTo(instance, 'frigate:getWebUrl', { hostname: window.location.hostname })
            .then(answer => finish(answer as FrigateWebUrl))
            .catch(() => finish(null));
        return () => {
            done = true;
            clearTimeout(timer);
        };
    }, [host, instance, camera, height, key, wantStream]);

    // a stream that never sends its first frame, e.g. because the browser has no free connection to the server
    useEffect(() => {
        if (!streamUrl || streamUrl === failedUrl || streamUrl === loadedUrl) {
            return;
        }
        const timer = setTimeout(() => setFailedUrl(streamUrl), STREAM_TIMEOUT);
        return () => clearTimeout(timer);
    }, [streamUrl, failedUrl, loadedUrl]);

    // single pictures over the socket, one after the other
    useEffect(() => {
        if (!useSocket) {
            return;
        }
        // the stream failed: as fast as it would have been
        const interval = mode === 'stream' ? 1000 / STREAM_FPS : Math.max(0.5, refresh || 1) * 1000;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const poll = async (): Promise<void> => {
            const start = Date.now();
            let src = '';
            let error = '';
            try {
                const answer = (await host.sendTo(instance, 'snapshot', { camera, height })) as {
                    data?: string;
                    contentType?: string;
                    error?: string;
                } | null;
                if (answer?.data) {
                    src = `data:${answer.contentType || 'image/jpeg'};base64,${answer.data}`;
                } else {
                    error = answer?.error || 'No picture';
                }
            } catch (e) {
                error = String(e);
            }
            if (stopped) {
                return;
            }
            // an error keeps the last picture
            setFrame(old => (src ? { key, src, error: '' } : { ...old, key, error }));
            // the round trip is part of the interval, so a slow connection does not add it up
            timer = setTimeout(() => void poll(), Math.max(0, interval - (Date.now() - start)));
        };
        void poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [useSocket, host, instance, camera, height, key, mode, refresh]);

    // end the stream with its picture: removing the element does not reliably end an endless response
    const setStreamImg = useCallback((element: HTMLImageElement | null): void => {
        if (!element) {
            streamImg.current?.removeAttribute('src');
        }
        streamImg.current = element;
    }, []);

    if (!useSocket && streamUrl) {
        return (
            <img
                key={streamUrl}
                ref={setStreamImg}
                src={streamUrl}
                alt={alt}
                onLoad={() => setLoadedUrl(streamUrl)}
                onError={() => setFailedUrl(streamUrl)}
                style={IMAGE_STYLE}
            />
        );
    }
    const current = frame.key === key ? frame : null;
    if (!current?.src) {
        return (
            <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: 12, padding: 8, textAlign: 'center' }}>
                {current?.error || '…'}
            </span>
        );
    }
    return (
        <img
            src={current.src}
            alt={alt}
            title={current.error || undefined}
            style={{ ...IMAGE_STYLE, opacity: current.error ? 0.3 : 1 }}
        />
    );
}

export interface CameraPictureProps {
    source: CameraSource;
    /** Needed for the cameras of the frigate adapter */
    host?: PhoneHost | null;
    /** The large phone of the dialog asks Frigate for a larger picture */
    large?: boolean;
    alt: string;
}

/** Picture of a camera: a URL, a state with a URL or data URL, or a camera of the frigate adapter */
export function CameraPicture({ source, host, large, alt }: CameraPictureProps): React.JSX.Element | null {
    if (source.kind === 'url') {
        return (
            <CameraImage
                src={source.src}
                refresh={source.refresh}
                alt={alt}
            />
        );
    }
    if (!host) {
        return null;
    }
    return (
        <FrigateImage
            host={host}
            instance={source.instance}
            camera={source.camera}
            mode={source.mode}
            refresh={source.refresh}
            height={large ? 720 : 480}
            alt={alt}
        />
    );
}

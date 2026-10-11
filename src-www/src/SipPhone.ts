/**
 * Phone core without any UI: registration, audio and video calls, ring tones, level meters, call
 * statistics and log.
 *
 * The UI subscribes to it (`subscribe` + `getSnapshot`, made for React's `useSyncExternalStore`)
 * and calls its actions. It has no dependency on React or MUI, so it can be reused as it is in a
 * vis-2 widget.
 */
import * as JsSIP from 'jssip';
import type { RTCSession } from 'jssip/lib/RTCSession';
import type { RTCSessionEvent } from 'jssip/lib/UA';

export type Registration = 'offline' | 'connecting' | 'registered' | 'error';
export type CallState = 'none' | 'calling' | 'incoming' | 'incall';
export type MediaWarning = '' | 'noSend' | 'noReceive' | 'micSilent';

export interface CallStats {
    sent: number;
    received: number;
    lost: number;
    codec: string;
    /** Round trip time in ms */
    rtt: number | null;
    warning: MediaWarning;
    /** Codec of the received or sent video, empty without video */
    videoCodec: string;
    /** Resolution of the received video, e.g. 640x480 */
    videoSize: string;
}

export interface LogEntry {
    id: number;
    ts: number;
    text: string;
}

export interface PhoneSnapshot {
    registration: Registration;
    /** Reason of the last registration error */
    error: string;
    extension: string;
    call: CallState;
    /** Display name and/or number of the other party */
    peer: string;
    /** Start of the connected call (ms), 0 if not connected */
    callStart: number;
    /** Text of the last call end, e.g. "Busy" */
    lastCallEnd: string;
    muted: boolean;
    stats: CallStats | null;
    /** The browser blocks sound until the user clicked into the page */
    audioLocked: boolean;
    /** The microphone is open (call or audio test) */
    micActive: boolean;
    /** Name of the microphone in use */
    micLabel: string;
    /** The own camera is sending */
    cameraOn: boolean;
    /** Name of the camera in use */
    cameraLabel: string;
    /** The incoming call offers video */
    incomingVideo: boolean;
    /** Own microphone and camera, for a preview */
    localStream: MediaStream | null;
    /** Media of the other party; the sound is played by the phone itself, use it only for the picture */
    remoteStream: MediaStream | null;
    /** The other party really sends pictures (a negotiated but silent video track does not count) */
    remoteVideo: boolean;
    /**
     * The microphone cannot be used: 'denied' by the browser, the user or the app around the page
     * (e.g. a WebView without the permission), 'nodevice' when there is none. Known before a call if the
     * browser reports the permission.
     */
    mediaError: '' | 'denied' | 'nodevice';
    log: LogEntry[];
}

export interface PhoneOptions {
    /** e.g. `wss://192.168.1.10:8089/ws` */
    wssUrl: string;
    /** Domain of the SIP URIs, normally the host of the PBX */
    domain: string;
    realm?: string;
    iceServers?: RTCIceServer[];
    /** Maximal number of log entries */
    maxLog?: number;
    /** Video calls: receive the picture of the other party */
    video?: boolean;
    /** The own camera may be used in video calls. false: it is never opened, and only receiving is offered */
    camera?: boolean;
}

export interface AudioDevices {
    microphones: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
    cameras: MediaDeviceInfo[];
    canSelectSpeaker: boolean;
}

const DTMF_FREQUENCIES: Record<string, [number, number]> = {
    1: [697, 1209],
    2: [697, 1336],
    3: [697, 1477],
    4: [770, 1209],
    5: [770, 1336],
    6: [770, 1477],
    7: [852, 1209],
    8: [852, 1336],
    9: [852, 1477],
    '*': [941, 1209],
    0: [941, 1336],
    '#': [941, 1477],
};

/**
 * DTMF in the media stream (RFC 4733/2833), the default of Asterisk (dtmf_mode=rfc4733). It reaches SIP
 * devices like door intercoms the same way. JsSIP would send SIP INFO by default.
 */
const DTMF_OPTIONS = { transportType: JsSIP.C.DTMF_TRANSPORT.RFC2833 };

type AudioContextWithSink = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type AudioElementWithSink = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/** RMS level of an analyser in dBFS */
function analyserLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    return rms > 0 ? 20 * Math.log10(rms) : -100;
}

/** Microphones, speakers and cameras of this device. The labels are only filled after a device was opened once */
export async function listAudioDevices(): Promise<AudioDevices> {
    const devices = navigator.mediaDevices?.enumerateDevices ? await navigator.mediaDevices.enumerateDevices() : [];
    const real = (d: MediaDeviceInfo): boolean => !!d.deviceId && d.deviceId !== 'default';
    return {
        microphones: devices.filter(d => d.kind === 'audioinput' && real(d)),
        speakers: devices.filter(d => d.kind === 'audiooutput' && real(d)),
        cameras: devices.filter(d => d.kind === 'videoinput' && !!d.deviceId),
        canSelectSpeaker: 'setSinkId' in HTMLMediaElement.prototype,
    };
}

export class SipPhone {
    readonly #options: Required<PhoneOptions>;
    readonly #listeners = new Set<() => void>();
    #snapshot: PhoneSnapshot;
    #logId = 0;

    #ua: JsSIP.UA | null = null;
    #session: RTCSession | null = null;
    readonly #hooked = new WeakSet<RTCPeerConnection>();

    #ctx: AudioContextWithSink | null = null;
    #micAnalyser: AnalyserNode | null = null;
    #spkAnalyser: AnalyserNode | null = null;
    #micBuffer: Float32Array<ArrayBuffer> | null = null;
    #spkBuffer: Float32Array<ArrayBuffer> | null = null;
    #micSource: MediaStreamAudioSourceNode | null = null;
    #remoteSource: MediaStreamAudioSourceNode | null = null;
    #localStream: MediaStream | null = null;
    /** All tracks received from the other party */
    #remoteMedia: MediaStream | null = null;
    readonly #remoteAudio: AudioElementWithSink;

    #micDevice = '';
    #speakerDevice = '';
    #cameraDevice = '';

    #ringTimer: ReturnType<typeof setInterval> | null = null;
    #ringbackTimer: ReturnType<typeof setInterval> | null = null;
    #statsTimer: ReturnType<typeof setInterval> | null = null;
    #testTimer: ReturnType<typeof setTimeout> | null = null;
    #lastPackets: { sent: number; received: number } | null = null;
    /** Seconds in a row in which the microphone delivered (almost) nothing */
    #silentSeconds = 0;
    /** Video frames of the other party decoded so far */
    #lastFrames = 0;
    /** Seconds in a row without a new video frame */
    #frozenSeconds = 0;
    #permissionWatched = false;

    constructor(options: PhoneOptions) {
        this.#options = { realm: 'iobroker', iceServers: [], maxLog: 500, video: false, camera: true, ...options };
        this.#snapshot = {
            registration: 'offline',
            error: '',
            extension: '',
            call: 'none',
            peer: '',
            callStart: 0,
            lastCallEnd: '',
            muted: false,
            stats: null,
            audioLocked: true,
            micActive: false,
            micLabel: '',
            cameraOn: false,
            cameraLabel: '',
            incomingVideo: false,
            localStream: null,
            remoteStream: null,
            remoteVideo: false,
            mediaError: '',
            log: [],
        };
        this.#remoteAudio = document.createElement('audio');
        this.#remoteAudio.autoplay = true;
        this.#remoteAudio.setAttribute('playsinline', '');
        this.#remoteAudio.style.display = 'none';
        document.body.appendChild(this.#remoteAudio);
    }

    // ------------------------------------------------------------------ store
    subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };

    getSnapshot = (): PhoneSnapshot => this.#snapshot;

    #update(patch: Partial<PhoneSnapshot>): void {
        this.#snapshot = { ...this.#snapshot, ...patch };
        this.#listeners.forEach(l => l());
    }

    log(text: string): void {
        const entry: LogEntry = { id: ++this.#logId, ts: Date.now(), text };
        console.log('[phone]', text);
        this.#update({ log: [entry, ...this.#snapshot.log].slice(0, this.#options.maxLog) });
    }

    clearLog(): void {
        this.#update({ log: [] });
    }

    // ------------------------------------------------------------------ audio engine
    /** Create or resume the audio context. Must be called from a user gesture at least once */
    unlockAudio(): void {
        if (!this.#ctx) {
            const AC =
                window.AudioContext ||
                (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            this.#ctx = new AC();
            this.#micAnalyser = this.#ctx.createAnalyser();
            this.#micAnalyser.fftSize = 1024;
            this.#spkAnalyser = this.#ctx.createAnalyser();
            this.#spkAnalyser.fftSize = 1024;
            this.#micBuffer = new Float32Array(this.#micAnalyser.fftSize);
            this.#spkBuffer = new Float32Array(this.#spkAnalyser.fftSize);
            this.#ctx.onstatechange = () => this.#update({ audioLocked: this.#ctx?.state !== 'running' });
            if (this.#speakerDevice && this.#ctx.setSinkId) {
                this.#ctx.setSinkId(this.#speakerDevice).catch(() => {});
            }
        }
        if (this.#ctx.state === 'suspended') {
            this.#ctx.resume().catch(() => {});
        }
        this.#update({ audioLocked: this.#ctx.state !== 'running' });
    }

    #audio(): AudioContextWithSink {
        this.unlockAudio();
        return this.#ctx!;
    }

    /**
     * Current levels in dBFS for the meters, `null` if there is no signal source.
     * Poll it in an animation frame.
     */
    getLevels(): { mic: number | null; speaker: number } {
        if (!this.#ctx || !this.#micAnalyser || !this.#spkAnalyser) {
            return { mic: null, speaker: -100 };
        }
        return {
            mic: this.#micSource && !this.#snapshot.muted ? analyserLevel(this.#micAnalyser, this.#micBuffer!) : null,
            speaker: analyserLevel(this.#spkAnalyser, this.#spkBuffer!),
        };
    }

    /** Play a tone through the speakers and the speaker meter */
    #tone(freqs: number[], start: number, duration: number, volume: number): void {
        const ctx = this.#audio();
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(volume, start + 0.01);
        gain.gain.setValueAtTime(volume, start + duration - 0.02);
        gain.gain.linearRampToValueAtTime(0, start + duration);
        gain.connect(ctx.destination);
        gain.connect(this.#spkAnalyser!);
        for (const f of freqs) {
            const osc = ctx.createOscillator();
            osc.frequency.value = f;
            osc.connect(gain);
            osc.start(start);
            osc.stop(start + duration + 0.05);
        }
    }

    #startRingtone(): void {
        this.#stopRingtone();
        const play = (): void => {
            const now = this.#audio().currentTime + 0.05;
            // two bursts of a warbling trill
            for (let burst = 0; burst < 2; burst++) {
                for (let i = 0; i < 12; i++) {
                    this.#tone([i % 2 ? 1320 : 1050], now + burst + i * 0.055, 0.05, 0.18);
                }
            }
        };
        play();
        this.#ringTimer = setInterval(play, 3000);
        navigator.vibrate?.([400, 200, 400, 2000, 400, 200, 400]);
    }

    #stopRingtone(): void {
        if (this.#ringTimer) {
            clearInterval(this.#ringTimer);
            this.#ringTimer = null;
            navigator.vibrate?.(0);
        }
    }

    #startRingback(): void {
        if (this.#ringbackTimer) {
            return;
        }
        // European ring back tone: 425 Hz, 1 s on, 4 s off
        const play = (): void => this.#tone([425], this.#audio().currentTime + 0.05, 1, 0.12);
        play();
        this.#ringbackTimer = setInterval(play, 5000);
    }

    #stopRingback(): void {
        if (this.#ringbackTimer) {
            clearInterval(this.#ringbackTimer);
            this.#ringbackTimer = null;
        }
    }

    // ------------------------------------------------------------------ devices
    setMicrophone(deviceId: string): void {
        this.#micDevice = deviceId;
        // takes effect with the next call; a running test is restarted
        if (this.#localStream && !this.#session) {
            this.#closeMedia();
        }
    }

    /** Takes effect the next time the camera is switched on */
    setCamera(deviceId: string): void {
        this.#cameraDevice = deviceId;
    }

    setSpeaker(deviceId: string): void {
        this.#speakerDevice = deviceId;
        this.#remoteAudio.setSinkId?.(deviceId).catch(e => this.log(`Cannot select speaker: ${(e as Error).message}`));
        this.#ctx?.setSinkId?.(deviceId).catch(() => {});
    }

    #videoConstraints(): MediaTrackConstraints {
        return {
            deviceId: this.#cameraDevice ? { ideal: this.#cameraDevice } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 15, max: 30 },
        };
    }

    /**
     * Open the microphone and, if wanted, the camera. Without a usable camera the call continues with
     * audio only.
     *
     * @param video open the camera too
     */
    async #openMedia(video = false): Promise<MediaStream> {
        if (this.#localStream) {
            return this.#localStream;
        }
        const audio: MediaTrackConstraints = {
            deviceId: this.#micDevice ? { ideal: this.#micDevice } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };
        let stream: MediaStream;
        if (video && this.#options.video && this.#options.camera) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio, video: this.#videoConstraints() });
            } catch (e) {
                this.log(`Cannot open camera: ${(e as Error).message}. Continuing with audio only`);
                stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
            }
        } else {
            stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        }
        this.#localStream = stream;
        if (this.#snapshot.mediaError) {
            this.#update({ mediaError: '' });
        }
        this.#watchCamera(stream.getVideoTracks()[0]);
        this.#micSource = this.#audio().createMediaStreamSource(this.#localStream);
        this.#micSource.connect(this.#micAnalyser!);
        const track = this.#localStream.getAudioTracks()[0];
        const label = track?.label || '?';
        const settings = track?.getSettings?.() || {};
        this.log(
            `Microphone: ${label} (${settings.sampleRate || '?'} Hz, echo cancellation ${settings.echoCancellation ? 'on' : 'off'})`,
        );
        if (track) {
            // muted by the operating system or the hardware (e.g. a mute key), not by the call
            track.onmute = () => this.log(`Microphone "${label}" muted by the system`);
            track.onunmute = () => this.log(`Microphone "${label}" active again`);
            track.onended = () => this.log(`Microphone "${label}" disconnected`);
            if (track.muted) {
                this.log(`Microphone "${label}" is muted by the system`);
            }
        }
        this.#update({ micActive: true, micLabel: label, localStream: stream });
        return this.#localStream;
    }

    /** Update the camera state of the snapshot for a new (or no) camera track */
    #watchCamera(track: MediaStreamTrack | undefined): void {
        if (!track) {
            this.#update({ cameraOn: false, cameraLabel: '' });
            return;
        }
        const label = track.label || '?';
        const settings = track.getSettings?.() || {};
        this.log(`Camera: ${label} (${settings.width || '?'}x${settings.height || '?'})`);
        track.onended = () => {
            this.log(`Camera "${label}" disconnected`);
            this.#update({ cameraOn: false });
        };
        this.#update({ cameraOn: true, cameraLabel: label });
    }

    #closeMedia(): void {
        this.#micSource?.disconnect();
        this.#micSource = null;
        this.#localStream?.getTracks().forEach(track => track.stop());
        this.#localStream = null;
        this.#update({
            micActive: false,
            muted: false,
            micLabel: '',
            cameraOn: false,
            cameraLabel: '',
            localStream: null,
        });
    }

    /**
     * Collect a received track in the one stream of the other party. Audio and video arrive as separate
     * tracks, often in separate streams: replacing the source of the audio element for every track would
     * interrupt the playback and could leave it with the video only.
     */
    #addRemoteTrack(track: MediaStreamTrack): void {
        let stream = this.#remoteMedia;
        if (!stream) {
            stream = new MediaStream();
            this.#remoteMedia = stream;
            this.#remoteAudio.srcObject = stream;
            this.#remoteAudio.play().catch(e => {
                // AbortError: replaced by the next call - nothing to report
                if ((e as Error).name !== 'AbortError') {
                    this.log(`Cannot play remote audio: ${(e as Error).message}`);
                }
            });
        }
        if (stream.getTracks().includes(track)) {
            return;
        }
        stream.addTrack(track);
        if (track.kind === 'audio') {
            this.#remoteSource?.disconnect();
            // only for the meter - the sound itself is played by the audio element
            this.#remoteSource = this.#audio().createMediaStreamSource(new MediaStream([track]));
            this.#remoteSource.connect(this.#spkAnalyser!);
        } else if (track.kind === 'video') {
            // A video track exists as soon as video was negotiated. Whether pictures really arrive is
            // decided by the statistics (#readStats): some devices send a few packets and then nothing,
            // and the video would freeze instead of the camera picture being shown.
            const remote = stream;
            const stopVideo = (): void => {
                if (this.#remoteMedia === remote && this.#snapshot.remoteVideo) {
                    this.#update({ remoteVideo: false });
                }
            };
            track.addEventListener('mute', stopVideo);
            track.addEventListener('ended', stopVideo);
        }
        this.#update({ remoteStream: stream });
    }

    #clearRemoteStream(): void {
        this.#remoteSource?.disconnect();
        this.#remoteSource = null;
        this.#remoteMedia = null;
        this.#remoteAudio.srcObject = null;
        this.#update({ remoteStream: null, remoteVideo: false });
    }

    /** Open the microphone for some seconds and play a short melody: both meters must move */
    async audioTest(): Promise<void> {
        try {
            await this.#openMedia();
        } catch (e) {
            this.log(`Cannot open microphone: ${(e as Error).message}`);
            return;
        }
        const now = this.#audio().currentTime;
        [523, 659, 784].forEach((f, i) => this.#tone([f], now + 0.1 + i * 0.25, 0.22, 0.2));
        if (this.#testTimer) {
            clearTimeout(this.#testTimer);
        }
        this.#testTimer = setTimeout(() => {
            if (!this.#session) {
                this.#closeMedia();
            }
        }, 8000);
    }

    /** Remember why the microphone could not be opened, so the UI can explain it */
    #noteMediaError(e: unknown): void {
        const name = (e as Error)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
            this.#update({ mediaError: 'denied' });
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            this.#update({ mediaError: 'nodevice' });
        }
    }

    /**
     * Report a blocked microphone already before a call: otherwise a door phone notices it only when
     * somebody rings. Not every browser or WebView supports the query - then the error comes with the call.
     */
    async #watchMicPermission(): Promise<void> {
        if (this.#permissionWatched || !navigator.permissions?.query) {
            return;
        }
        this.#permissionWatched = true;
        try {
            const status = await navigator.permissions.query({ name: 'microphone' });
            const apply = (): void => {
                if (status.state === 'denied') {
                    this.log('The microphone is blocked for this page');
                    this.#update({ mediaError: 'denied' });
                } else if (this.#snapshot.mediaError === 'denied') {
                    this.#update({ mediaError: '' });
                }
            };
            status.addEventListener('change', apply);
            apply();
        } catch {
            // "microphone" is not supported by this browser
        }
    }

    // ------------------------------------------------------------------ registration
    login(extension: string, password: string): void {
        this.logout(false);
        this.unlockAudio();
        void this.#watchMicPermission();
        try {
            this.#ua = new JsSIP.UA({
                sockets: [new JsSIP.WebSocketInterface(this.#options.wssUrl)],
                uri: `sip:${extension}@${this.#options.domain}`,
                authorization_user: extension,
                password,
                realm: this.#options.realm,
                register: true,
                session_timers: false,
                user_agent: `ioBroker Phone (JsSIP ${JsSIP.version})`,
            });
        } catch (e) {
            this.#ua = null;
            this.log(`Error: ${(e as Error).message}`);
            this.#update({ registration: 'error', error: (e as Error).message });
            return;
        }
        const ua = this.#ua;
        this.#update({ registration: 'connecting', error: '', extension });

        ua.on('connected', () => this.log(`WebSocket connected to ${this.#options.wssUrl}`));
        ua.on('disconnected', e => {
            this.log(`WebSocket disconnected${e?.code ? ` (${e.code})` : ''}`);
            if (this.#ua === ua) {
                this.#update({ registration: 'connecting' });
            }
        });
        ua.on('registered', () => {
            this.log(`Registered as ${extension}`);
            this.#update({ registration: 'registered', error: '' });
        });
        ua.on('unregistered', () => this.log('Unregistered'));
        ua.on('registrationFailed', e => {
            this.log(`Registration failed: ${e.cause}`);
            this.#update({ registration: 'error', error: String(e.cause || '') });
            if (e.cause === JsSIP.C.causes.AUTHENTICATION_ERROR || e.cause === JsSIP.C.causes.REJECTED) {
                // do not retry with wrong credentials forever
                ua.stop();
            }
        });
        ua.on('newRTCSession', (e: RTCSessionEvent) => this.#onNewSession(e));
        ua.start();
    }

    logout(log = true): void {
        this.#session?.terminate();
        if (this.#ua) {
            const ua = this.#ua;
            this.#ua = null;
            ua.stop();
            if (log) {
                this.log('Signed out');
            }
        }
        this.#update({ registration: 'offline', error: '' });
    }

    // ------------------------------------------------------------------ calls
    #onNewSession(e: RTCSessionEvent): void {
        if (this.#session) {
            // one call at a time
            e.session.terminate({ status_code: 486 });
            return;
        }
        const s = e.session;
        this.#session = s;
        this.#hookConnection(s.connection);
        s.on('peerconnection', ev => this.#hookConnection(ev.peerconnection));
        s.on('progress', (ev: unknown) => {
            if (s.direction !== 'outgoing') {
                return;
            }
            const response = (ev as { response?: { status_code: number; body?: string } }).response;
            // 180 without media: play the ring back tone ourselves, 183 brings its own audio
            if (response?.status_code === 180 && !response.body) {
                this.#startRingback();
            } else {
                this.#stopRingback();
            }
            this.log('Ringing');
        });
        s.on('connecting', () => {
            // Offer a video channel even with the camera off: the picture of the other party can be
            // received, and the own camera can be switched on later without a new negotiation.
            // Without permission for the camera only receiving is offered.
            const pc = s.connection;
            if (this.#options.video && pc && !pc.getTransceivers().some(t => t.receiver.track.kind === 'video')) {
                pc.addTransceiver('video', { direction: this.#options.camera ? 'sendrecv' : 'recvonly' });
            }
        });
        s.on('accepted', () => this.#stopRingback());
        s.on('confirmed', () => {
            this.#stopRingtone();
            this.#stopRingback();
            this.#update({ call: 'incall', callStart: Date.now() });
            this.#startStats();
            this.log('Call connected');
        });
        s.on('ended', ev => this.#endCall(`Call ended (${ev.cause})`, String(ev.cause)));
        s.on('failed', ev => this.#endCall(`Call failed: ${ev.cause}`, String(ev.cause)));

        const identity = s.remote_identity;
        const user = identity?.uri?.user || '';
        const peer =
            identity?.display_name && identity.display_name !== user ? `${identity.display_name} (${user})` : user;

        if (e.originator === 'remote') {
            const incomingVideo = this.#options.video && /^m=video [1-9]/m.test(String(e.request?.body || ''));
            this.log(`Incoming ${incomingVideo ? 'video ' : ''}call from ${peer}`);
            this.#update({ call: 'incoming', peer, stats: null, lastCallEnd: '', incomingVideo });
            this.#startRingtone();
        } else {
            this.#update({ call: 'calling', peer, stats: null, lastCallEnd: '' });
        }
    }

    #hookConnection(pc: RTCPeerConnection | undefined | null): void {
        if (!pc || this.#hooked.has(pc)) {
            return;
        }
        this.#hooked.add(pc);
        pc.addEventListener('track', ev => this.#addRemoteTrack(ev.track));
        pc.addEventListener('iceconnectionstatechange', () => this.log(`ICE: ${pc.iceConnectionState}`));
        pc.addEventListener('signalingstatechange', () => {
            // An offer with video and the camera off: answer with sendrecv anyway, so the camera can be
            // switched on later without a new negotiation. The state changes before the answer is created.
            if (this.#options.video && this.#options.camera && pc.signalingState === 'have-remote-offer') {
                pc.getTransceivers()
                    .filter(t => t.receiver.track.kind === 'video' && t.direction === 'recvonly')
                    .forEach(t => (t.direction = 'sendrecv'));
            }
        });
        pc.getReceivers().forEach(r => r.track && this.#addRemoteTrack(r.track));
    }

    /**
     * Call a number
     *
     * @param target number or extension
     * @param video send the own camera from the start
     */
    async call(target: string, video = false): Promise<void> {
        const number = target.trim();
        if (!number || !this.#ua?.isRegistered() || this.#session) {
            return;
        }
        try {
            const stream = await this.#openMedia(video);
            this.log(`Calling ${number}`);
            this.#ua.call(`sip:${number}@${this.#options.domain}`, {
                mediaStream: stream,
                pcConfig: { iceServers: this.#options.iceServers },
            });
        } catch (e) {
            this.#noteMediaError(e);
            this.#endCall(`Cannot start call: ${(e as Error).message}`, (e as Error).message);
        }
    }

    /**
     * Answer the incoming call
     *
     * @param video send the own camera, if the caller offers video
     */
    async answer(video = false): Promise<void> {
        const s = this.#session;
        if (!s || this.#snapshot.call !== 'incoming') {
            return;
        }
        this.#stopRingtone();
        try {
            const stream = await this.#openMedia(video && this.#snapshot.incomingVideo);
            s.answer({ mediaStream: stream, pcConfig: { iceServers: this.#options.iceServers } });
        } catch (e) {
            this.#noteMediaError(e);
            this.log(`Cannot answer: ${(e as Error).message}`);
            s.terminate();
        }
    }

    decline(): void {
        this.#session?.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    }

    hangup(): void {
        this.#session?.terminate();
    }

    toggleMute(): void {
        const s = this.#session;
        if (!s) {
            return;
        }
        const muted = !this.#snapshot.muted;
        if (muted) {
            s.mute({ audio: true });
        } else {
            s.unmute({ audio: true });
        }
        this.#update({ muted });
    }

    /** The transceiver of the negotiated video channel of the current call */
    #videoTransceiver(): RTCRtpTransceiver | undefined {
        return this.#session?.connection
            ?.getTransceivers()
            .find(t => t.receiver.track.kind === 'video' && t.currentDirection !== 'stopped');
    }

    /** Switch the own camera on or off during a call */
    async toggleCamera(): Promise<void> {
        if (!this.#options.camera) {
            this.log('The own camera is disabled in the settings');
            return;
        }
        const transceiver = this.#videoTransceiver();
        if (!this.#session || !transceiver) {
            this.log('The call has no video channel');
            return;
        }
        const current = transceiver.sender.track;
        if (current) {
            await transceiver.sender.replaceTrack(null);
            current.stop();
            this.#localStream?.removeTrack(current);
            this.log('Camera off');
            this.#update({ cameraOn: false, cameraLabel: '' });
            return;
        }
        let track: MediaStreamTrack | undefined;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: this.#videoConstraints() });
            track = stream.getVideoTracks()[0];
            await transceiver.sender.replaceTrack(track);
        } catch (e) {
            track?.stop();
            this.log(`Cannot switch the camera on: ${(e as Error).message}`);
            return;
        }
        this.#localStream?.addTrack(track);
        if (transceiver.currentDirection === 'recvonly' || transceiver.currentDirection === 'inactive') {
            this.log('The other party does not accept video');
        }
        this.#watchCamera(track);
    }

    /**
     * Send several DTMF tones during a call, e.g. the code that opens a door
     *
     * @param tones digits, `*` and `#`
     */
    sendDtmf(tones: string): void {
        const valid = tones.replace(/[^0-9*#A-D]/gi, '');
        if (valid && this.#session?.isEstablished()) {
            this.#session.sendDTMF(valid, DTMF_OPTIONS);
            this.log(`DTMF ${valid}`);
        }
    }

    /** Key of the keypad: local DTMF tone and, during a call, DTMF to the other party */
    pressKey(key: string): void {
        const freqs = DTMF_FREQUENCIES[key];
        if (freqs) {
            this.#tone(freqs, this.#audio().currentTime + 0.01, 0.12, 0.08);
        }
        if (this.#session?.isEstablished()) {
            this.#session.sendDTMF(key, DTMF_OPTIONS);
            this.log(`DTMF ${key}`);
        }
    }

    #endCall(text: string, reason: string): void {
        this.log(text);
        this.#stopRingtone();
        this.#stopRingback();
        this.#stopStats();
        this.#closeMedia();
        this.#clearRemoteStream();
        this.#session = null;
        this.#update({ call: 'none', peer: '', callStart: 0, muted: false, incomingVideo: false, lastCallEnd: reason });
    }

    // ------------------------------------------------------------------ statistics
    #startStats(): void {
        this.#stopStats();
        this.#lastPackets = null;
        this.#silentSeconds = 0;
        this.#lastFrames = 0;
        this.#frozenSeconds = 0;
        this.#statsTimer = setInterval(() => void this.#readStats(), 1000);
    }

    #stopStats(): void {
        if (this.#statsTimer) {
            clearInterval(this.#statsTimer);
            this.#statsTimer = null;
        }
    }

    async #readStats(): Promise<void> {
        const pc = this.#session?.connection;
        if (!pc) {
            return;
        }
        const report = await pc.getStats();
        const codecs: Record<string, string> = {};
        let frames = 0;
        const stats: CallStats = {
            sent: 0,
            received: 0,
            lost: 0,
            codec: '',
            rtt: null,
            warning: '',
            videoCodec: '',
            videoSize: '',
        };
        report.forEach((r: Record<string, unknown>) => {
            if (r.type === 'codec') {
                codecs[r.id as string] =
                    typeof r.mimeType === 'string' ? r.mimeType.replace(/^(audio|video)\//, '') : '';
            }
        });
        report.forEach((r: Record<string, unknown>) => {
            if (r.type === 'outbound-rtp' && r.kind === 'audio') {
                stats.sent = Number(r.packetsSent) || 0;
                stats.codec = codecs[r.codecId as string] || stats.codec;
            } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
                stats.received = Number(r.packetsReceived) || 0;
                stats.lost = Number(r.packetsLost) || 0;
            } else if ((r.type === 'inbound-rtp' || r.type === 'outbound-rtp') && r.kind === 'video') {
                stats.videoCodec = codecs[r.codecId as string] || stats.videoCodec;
                if (r.type === 'inbound-rtp') {
                    frames += Number(r.framesDecoded) || 0;
                    if (r.frameWidth) {
                        stats.videoSize = `${Number(r.frameWidth)}x${Number(r.frameHeight)}`;
                    }
                }
            } else if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
                stats.rtt =
                    typeof r.currentRoundTripTime === 'number' ? Math.round(r.currentRoundTripTime * 1000) : null;
            }
        });
        // A silent microphone still sends packets: check the level itself
        const micLevel = this.getLevels().mic;
        if (!this.#snapshot.muted && (micLevel === null || micLevel < -65)) {
            this.#silentSeconds++;
        } else {
            this.#silentSeconds = 0;
        }
        const last = this.#lastPackets;
        if (last) {
            if (stats.sent === last.sent) {
                stats.warning = 'noSend';
            } else if (stats.received === last.received) {
                stats.warning = 'noReceive';
            } else if (this.#silentSeconds >= 5) {
                stats.warning = 'micSilent';
            }
            if (stats.warning && this.#snapshot.stats?.warning !== stats.warning) {
                this.log(
                    {
                        noSend: 'No audio packets are sent',
                        noReceive: 'No audio packets are received',
                        micSilent: `The microphone "${this.#snapshot.micLabel}" delivers no sound - wrong device or muted in the system?`,
                    }[stats.warning],
                );
            }
        }
        this.#lastPackets = { sent: stats.sent, received: stats.received };

        // show the video of the other party only while new pictures arrive
        if (frames > this.#lastFrames) {
            this.#lastFrames = frames;
            this.#frozenSeconds = 0;
        } else {
            this.#frozenSeconds++;
        }
        const remoteVideo =
            frames > 0 &&
            this.#frozenSeconds < 2 &&
            !!this.#remoteMedia?.getVideoTracks().some(t => t.readyState === 'live' && !t.muted);
        if (remoteVideo !== this.#snapshot.remoteVideo) {
            this.log(remoteVideo ? 'Video of the other party is received' : 'No video from the other party');
        }
        this.#update({ stats, remoteVideo });
    }

    destroy(): void {
        this.logout(false);
        this.#closeMedia();
        this.#remoteAudio.remove();
        void this.#ctx?.close();
        this.#listeners.clear();
    }
}

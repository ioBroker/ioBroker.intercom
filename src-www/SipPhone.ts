/**
 * Phone core without any UI: registration, calls, ring tones, level meters, call statistics and log.
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
export type MediaWarning = '' | 'noSend' | 'noReceive';

export interface CallStats {
    sent: number;
    received: number;
    lost: number;
    codec: string;
    /** Round trip time in ms */
    rtt: number | null;
    warning: MediaWarning;
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
}

export interface AudioDevices {
    microphones: MediaDeviceInfo[];
    speakers: MediaDeviceInfo[];
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

/** Microphones and speakers of this device. The labels are only filled after the microphone was opened once */
export async function listAudioDevices(): Promise<AudioDevices> {
    const devices = navigator.mediaDevices?.enumerateDevices ? await navigator.mediaDevices.enumerateDevices() : [];
    const real = (d: MediaDeviceInfo): boolean => !!d.deviceId && d.deviceId !== 'default';
    return {
        microphones: devices.filter(d => d.kind === 'audioinput' && real(d)),
        speakers: devices.filter(d => d.kind === 'audiooutput' && real(d)),
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
    readonly #remoteAudio: AudioElementWithSink;

    #micDevice = '';
    #speakerDevice = '';

    #ringTimer: ReturnType<typeof setInterval> | null = null;
    #ringbackTimer: ReturnType<typeof setInterval> | null = null;
    #statsTimer: ReturnType<typeof setInterval> | null = null;
    #testTimer: ReturnType<typeof setTimeout> | null = null;
    #lastPackets: { sent: number; received: number } | null = null;

    constructor(options: PhoneOptions) {
        this.#options = { realm: 'iobroker', iceServers: [], maxLog: 500, ...options };
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
            this.#closeMic();
        }
    }

    setSpeaker(deviceId: string): void {
        this.#speakerDevice = deviceId;
        this.#remoteAudio.setSinkId?.(deviceId).catch(e => this.log(`Cannot select speaker: ${(e as Error).message}`));
        this.#ctx?.setSinkId?.(deviceId).catch(() => {});
    }

    async #openMic(): Promise<MediaStream> {
        if (this.#localStream) {
            return this.#localStream;
        }
        this.#localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: this.#micDevice ? { ideal: this.#micDevice } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });
        this.#micSource = this.#audio().createMediaStreamSource(this.#localStream);
        this.#micSource.connect(this.#micAnalyser!);
        this.log(`Microphone: ${this.#localStream.getAudioTracks()[0]?.label || '?'}`);
        this.#update({ micActive: true });
        return this.#localStream;
    }

    #closeMic(): void {
        this.#micSource?.disconnect();
        this.#micSource = null;
        this.#localStream?.getTracks().forEach(track => track.stop());
        this.#localStream = null;
        this.#update({ micActive: false, muted: false });
    }

    #setRemoteStream(stream: MediaStream): void {
        if (this.#remoteAudio.srcObject !== stream) {
            this.#remoteAudio.srcObject = stream;
            this.#remoteAudio.play().catch(e => this.log(`Cannot play remote audio: ${(e as Error).message}`));
        }
        this.#remoteSource?.disconnect();
        // only for the meter - the sound itself is played by the audio element
        this.#remoteSource = this.#audio().createMediaStreamSource(stream);
        this.#remoteSource.connect(this.#spkAnalyser!);
    }

    #clearRemoteStream(): void {
        this.#remoteSource?.disconnect();
        this.#remoteSource = null;
        this.#remoteAudio.srcObject = null;
    }

    /** Open the microphone for some seconds and play a short melody: both meters must move */
    async audioTest(): Promise<void> {
        try {
            await this.#openMic();
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
                this.#closeMic();
            }
        }, 8000);
    }

    // ------------------------------------------------------------------ registration
    login(extension: string, password: string): void {
        this.logout(false);
        this.unlockAudio();
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
            this.log(`Incoming call from ${peer}`);
            this.#update({ call: 'incoming', peer, stats: null, lastCallEnd: '' });
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
        pc.addEventListener('track', ev => this.#setRemoteStream(ev.streams[0] || new MediaStream([ev.track])));
        pc.addEventListener('iceconnectionstatechange', () => this.log(`ICE: ${pc.iceConnectionState}`));
        pc.getReceivers().forEach(r => r.track && this.#setRemoteStream(new MediaStream([r.track])));
    }

    async call(target: string): Promise<void> {
        const number = target.trim();
        if (!number || !this.#ua?.isRegistered() || this.#session) {
            return;
        }
        try {
            const stream = await this.#openMic();
            this.log(`Calling ${number}`);
            this.#ua.call(`sip:${number}@${this.#options.domain}`, {
                mediaStream: stream,
                pcConfig: { iceServers: this.#options.iceServers },
            });
        } catch (e) {
            this.#endCall(`Cannot start call: ${(e as Error).message}`, (e as Error).message);
        }
    }

    async answer(): Promise<void> {
        const s = this.#session;
        if (!s || this.#snapshot.call !== 'incoming') {
            return;
        }
        this.#stopRingtone();
        try {
            const stream = await this.#openMic();
            s.answer({ mediaStream: stream, pcConfig: { iceServers: this.#options.iceServers } });
        } catch (e) {
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

    /** Key of the keypad: local DTMF tone and, during a call, DTMF to the other party */
    pressKey(key: string): void {
        const freqs = DTMF_FREQUENCIES[key];
        if (freqs) {
            this.#tone(freqs, this.#audio().currentTime + 0.01, 0.12, 0.08);
        }
        if (this.#session?.isEstablished()) {
            this.#session.sendDTMF(key);
            this.log(`DTMF ${key}`);
        }
    }

    #endCall(text: string, reason: string): void {
        this.log(text);
        this.#stopRingtone();
        this.#stopRingback();
        this.#stopStats();
        this.#closeMic();
        this.#clearRemoteStream();
        this.#session = null;
        this.#update({ call: 'none', peer: '', callStart: 0, muted: false, lastCallEnd: reason });
    }

    // ------------------------------------------------------------------ statistics
    #startStats(): void {
        this.#stopStats();
        this.#lastPackets = null;
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
        const stats: CallStats = { sent: 0, received: 0, lost: 0, codec: '', rtt: null, warning: '' };
        report.forEach((r: Record<string, unknown>) => {
            if (r.type === 'codec') {
                codecs[r.id as string] = typeof r.mimeType === 'string' ? r.mimeType.replace('audio/', '') : '';
            }
        });
        report.forEach((r: Record<string, unknown>) => {
            if (r.type === 'outbound-rtp' && r.kind === 'audio') {
                stats.sent = Number(r.packetsSent) || 0;
                stats.codec = codecs[r.codecId as string] || stats.codec;
            } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
                stats.received = Number(r.packetsReceived) || 0;
                stats.lost = Number(r.packetsLost) || 0;
            } else if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
                stats.rtt =
                    typeof r.currentRoundTripTime === 'number' ? Math.round(r.currentRoundTripTime * 1000) : null;
            }
        });
        const last = this.#lastPackets;
        if (last) {
            if (stats.sent === last.sent) {
                stats.warning = 'noSend';
            } else if (stats.received === last.received) {
                stats.warning = 'noReceive';
            }
            if (stats.warning && this.#snapshot.stats?.warning !== stats.warning) {
                this.log(stats.warning === 'noSend' ? 'No audio packets are sent' : 'No audio packets are received');
            }
        }
        this.#lastPackets = { sent: stats.sent, received: stats.received };
        this.#update({ stats });
    }

    destroy(): void {
        this.logout(false);
        this.#closeMic();
        this.#remoteAudio.remove();
        void this.#ctx?.close();
        this.#listeners.clear();
    }
}

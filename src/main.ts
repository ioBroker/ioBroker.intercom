import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as utils from '@iobroker/adapter-core';

import { AmiClient, type AmiMessage } from './lib/ami';
import { CameraPoller, validateCameras, type CameraSettings } from './lib/cameras';
import {
    generateCertificate,
    getFingerprint,
    getHostAddresses,
    getSubjectAltNames,
    getUncoveredHosts,
} from './lib/certificate';
import {
    AMI_USER,
    ALL_CODECS,
    ASTERISK_LOG_LEVELS,
    getLogCommands,
    LOG_FILE,
    type AsteriskLogLevel,
    generateConfig,
    getReloadCommands,
    isValidExtension,
    RESTART_FILES,
    type GeneratorConfig,
    type GeneratorResult,
    type GeneratorSubscriber,
} from './lib/configGenerator';
import { writeConfigFiles } from './lib/configWriter';
import { classifyMessage, LogTail, TlsFailureMonitor } from './lib/logTail';
import {
    ContactTracker,
    describeSubscriber,
    extensionOfDevice,
    mapDeviceState,
    type SubscriberState,
} from './lib/subscriberStatus';
import { describeUrl, fetchSnapshot } from './lib/snapshot';
import { PHONE_FILE } from './lib/testPage';
import type { Codec } from './types';

/** The part of the docker plugin this adapter uses */
interface DockerPluginInstance {
    instanceIsReady(forceRestartOfExistingContainer?: boolean): Promise<void>;
}

/** Commands that make Asterisk read all generated files again */
const RELOAD_ALL = getReloadCommands(['pjsip.conf', 'extensions.conf', 'http.conf', 'rtp.conf', 'logger.conf']);
const STATUS_REFRESH_INTERVAL = 5 * 60_000;
/** Passwords of the subscribers that io-package.json creates on installation */
const DEFAULT_PASSWORDS: Record<string, string> = { 100: '0100', 101: '0101' };

function randomSecret(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}

/** Encryption used by the jsonConfig table for `encryptedAttributes` */
function legacyEncrypt(secret: string, value: string): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}

function toNumber(value: number | string | undefined, def: number): number {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

export class IntercomAdapter extends utils.Adapter {
    private ami: AmiClient | null = null;
    private readonly contacts = new ContactTracker();
    private subscribers: GeneratorSubscriber[] = [];
    private configHash = '';
    private configDir = '';
    private statusTimer: ioBroker.Interval | undefined;
    private logTail: LogTail | null = null;
    /** Counts the aborted TLS handshakes per client */
    private readonly tlsFailures = new TlsFailureMonitor();
    private reloading: Promise<void> | null = null;
    private cameraPoller: CameraPoller | null = null;
    /** Device state of every subscriber, to know whether a call is going on */
    private readonly deviceStates = new Map<string, SubscriberState>();

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'intercom',
            ready: () => this.main(),
            unload: callback => this.onUnload(callback),
            message: obj => this.onMessage(obj),
        });
    }

    private async main(): Promise<void> {
        await this.setStateAsync('info.connection', false, true);

        // Fill everything that has to be generated once. Writing the instance object restarts the adapter.
        if (await this.initNativeOnce()) {
            return;
        }

        this.configDir = this.config.configDir;

        const certificate = await this.getActiveCertificate();
        const fingerprint = certificate ? this.safeFingerprint(certificate.cert) : '';
        await this.setStateAsync('info.certFingerprint', fingerprint, true);
        const wssHost =
            (certificate && this.safeSan(certificate.cert)[0]) || (this.config.certHosts || [])[0] || 'localhost';
        await this.setStateAsync('info.wssUrl', `wss://${wssHost}:${toNumber(this.config.wssPort, 8089)}/ws`, true);
        if (certificate && this.config.certSource !== 'iobroker') {
            const uncovered = getUncoveredHosts(
                certificate.cert,
                getHostAddresses().filter(h => /^\d+\.\d+\.\d+\.\d+$/.test(h)),
            );
            if (uncovered.length) {
                this.log.warn(
                    `The certificate does not contain the address(es) ${uncovered.join(', ')} of this host. ` +
                        'Clients using these addresses will fail. Regenerate the certificate in the settings if required ' +
                        '(all apps have to accept the new fingerprint afterwards).',
                );
            }
        }

        const result = await this.writeConfiguration(certificate);
        await this.syncObjects(result?.subscribers || []);
        this.warnDefaultPasswords();

        this.startLogTail();
        await this.startCameras();
        this.startAmi();
    }

    /**
     * Generate secrets, the configuration directory and the certificate if they do not exist yet.
     *
     * @returns true if the instance object was changed and the adapter will restart
     */
    private async initNativeOnce(): Promise<boolean> {
        const native: Partial<ioBroker.AdapterConfig> = {};

        if (!this.config.configDir) {
            native.configDir = join(utils.getAbsoluteInstanceDataDir(this), 'asterisk');
        }
        if (!this.config.amiSecret) {
            native.amiSecret = this.encrypt(randomSecret(32));
        }
        if (this.config.certSource !== 'iobroker' && !this.config.certPublic) {
            const hosts = this.config.certHosts?.length ? this.config.certHosts : getHostAddresses();
            this.log.info(`Generating a self-signed certificate for ${hosts.join(', ')}`);
            try {
                const cert = generateCertificate(hosts);
                native.certHosts = hosts;
                native.certPublic = cert.certPublic;
                native.certPrivate = this.encrypt(cert.certPrivate);
                native.certFingerprint = cert.certFingerprint;
            } catch (e) {
                this.log.error(`Cannot generate certificate: ${(e as Error).message}`);
            }
        }
        // The subscribers of io-package.json come with clear text passwords (the secret of the system is
        // unknown there). They and the passwords left empty in the table are stored the way the table
        // encrypts them.
        const subscribers = this.config.subscribers || [];
        const plain = !!this.config.subscribersPlain;
        if (plain || subscribers.some(s => s && !s.password)) {
            const systemConfig = await this.getForeignObjectAsync('system.config');
            const secret = (systemConfig?.native as { secret?: string } | undefined)?.secret || 'Zgfr56gFe87jJOM';
            native.subscribers = subscribers.map(s => {
                if (!s) {
                    return s;
                }
                if (!s.password) {
                    this.log.info(`Generated a password for subscriber ${s.extension}`);
                    return { ...s, password: legacyEncrypt(secret, randomSecret(12)) };
                }
                return plain ? { ...s, password: legacyEncrypt(secret, s.password) } : s;
            });
            if (plain) {
                native.subscribersPlain = false;
            }
        }

        if (!Object.keys(native).length) {
            return false;
        }
        this.log.info('Storing generated settings. The instance will restart.');
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, { native });
        return true;
    }

    /** The certificate that Asterisk uses: the own one or one of `system.certificates` */
    private async getActiveCertificate(): Promise<{ cert: string; key: string } | null> {
        if (this.config.certSource === 'iobroker') {
            if (!this.config.certIobPublic || !this.config.certIobPrivate) {
                this.log.error('No certificate of ioBroker selected');
                return null;
            }
            try {
                const [certs] = await this.getCertificatesAsync(
                    this.config.certIobPublic,
                    this.config.certIobPrivate,
                    this.config.certIobChained || undefined,
                );
                if (!certs?.cert || !certs?.key) {
                    this.log.error('Selected ioBroker certificate not found');
                    return null;
                }
                const ca = certs.ca ? (Array.isArray(certs.ca) ? certs.ca.join('\n') : String(certs.ca)) : '';
                return {
                    cert: ca ? `${String(certs.cert).trim()}\n${ca.trim()}\n` : String(certs.cert),
                    key: String(certs.key),
                };
            } catch (e) {
                this.log.error(`Cannot read ioBroker certificates: ${(e as Error).message}`);
                return null;
            }
        }
        if (!this.config.certPublic || !this.config.certPrivate) {
            return null;
        }
        return { cert: this.config.certPublic, key: this.config.certPrivate };
    }

    private safeFingerprint(pem: string): string {
        try {
            return getFingerprint(pem);
        } catch (e) {
            this.log.error(`Invalid certificate: ${(e as Error).message}`);
            return '';
        }
    }

    private safeSan(pem: string): string[] {
        try {
            return getSubjectAltNames(pem);
        } catch {
            return [];
        }
    }

    private getGeneratorConfig(): GeneratorConfig {
        const codecs = (Array.isArray(this.config.codecs) ? this.config.codecs : []).filter((c: Codec) =>
            ALL_CODECS.includes(c),
        );
        return {
            amiPort: toNumber(this.config.amiPort, 5038),
            wssPort: toNumber(this.config.wssPort, 8089),
            rtpStart: toNumber(this.config.rtpStart, 10000),
            rtpEnd: toNumber(this.config.rtpEnd, 20000),
            stunServer: this.config.stunServer || '',
            externalAddress: this.config.externalAddress || '',
            iceDenylist: this.config.iceDenylist || '',
            logLevel: this.getLogLevel(),
            codecs: codecs.length ? codecs : ['ulaw', 'alaw'],
            // missing in instances created before video support: enable it like a new installation
            videoCodecs: Array.isArray(this.config.videoCodecs) ? this.config.videoCodecs : ['vp8', 'h264'],
            echoTest: this.config.echoTest !== false,
            testPage: this.config.testPage !== false,
            subscribers: (this.config.subscribers || []).map(s => ({
                extension: String(s?.extension ?? '').trim(),
                name: s?.name || '',
                kind: s?.kind === 'sip' ? 'sip' : 'webrtc',
                enabled: !!s?.enabled,
            })),
            groups: (Array.isArray(this.config.groups) ? this.config.groups : []).map(g => ({
                extension: String(g?.extension ?? '').trim(),
                name: g?.name || '',
                members: (Array.isArray(g?.members) ? g.members : String(g?.members ?? '').split(/[\s,;]+/))
                    .map(m => String(m).trim())
                    .filter(Boolean),
                ringTime: toNumber(g?.ringTime, 30),
                enabled: !!g?.enabled,
            })),
        };
    }

    /** The subscribers of a new installation have well-known passwords */
    private warnDefaultPasswords(): void {
        const passwords = this.getPasswords();
        const defaults = Object.entries(DEFAULT_PASSWORDS).filter(([ext, pw]) => passwords[ext] === pw);
        if (defaults.length) {
            this.log.warn(
                `Subscriber(s) ${defaults.map(([ext]) => ext).join(', ')} still use the default password of the installation. ` +
                    'Change it in the settings, at the latest before Asterisk is reachable from outside the LAN.',
            );
        }
    }

    private getPasswords(): Record<string, string> {
        const passwords: Record<string, string> = {};
        for (const s of this.config.subscribers || []) {
            const ext = String(s?.extension ?? '').trim();
            if (ext && s.password && passwords[ext] === undefined) {
                passwords[ext] = this.decrypt(s.password);
            }
        }
        return passwords;
    }

    /** Phone bundle (React + MUI + JsSIP) for the test page, built into `build/static` by `npm run build:www` */
    private async readPhoneBundle(): Promise<string | undefined> {
        if (this.config.testPage === false) {
            return undefined;
        }
        const file = join(__dirname, 'static', PHONE_FILE);
        try {
            return await readFile(file, 'utf8');
        } catch (e) {
            this.log.warn(`Cannot read ${file}: ${(e as Error).message}. The test page will not work`);
            return undefined;
        }
    }

    /**
     * Generate and write all files, then hand the container over to the docker plugin.
     *
     * @param certificate the certificate for the WSS listener
     */
    private async writeConfiguration(
        certificate: { cert: string; key: string } | null,
    ): Promise<GeneratorResult | null> {
        let result: GeneratorResult;
        try {
            result = generateConfig(
                this.getGeneratorConfig(),
                {
                    amiSecret: this.config.amiSecret,
                    passwords: this.getPasswords(),
                    certPublic: certificate?.cert || '',
                    certPrivate: certificate?.key || '',
                },
                { phone: await this.readPhoneBundle() },
            );
        } catch (e) {
            this.log.error(`Cannot generate the Asterisk configuration: ${(e as Error).message}`);
            return null;
        }
        result.warnings.forEach(w => this.log.warn(w));
        if (!certificate) {
            this.log.warn('No certificate available: WSS (WebRTC) will not work');
        }

        let restartRequired = false;
        try {
            const written = await writeConfigFiles(this.configDir, result.files);
            this.configHash = written.hash;
            if (written.changed.length) {
                this.log.info(`Asterisk configuration written to ${this.configDir}: ${written.changed.join(', ')}`);
            }
            restartRequired = written.changed.some(f => RESTART_FILES.includes(f));
        } catch (e) {
            this.log.error(`Cannot write the Asterisk configuration to ${this.configDir}: ${(e as Error).message}`);
            return result;
        }

        if (this.config.dockerEnabled) {
            const plugin = this.getPluginInstance('docker') as DockerPluginInstance | null;
            if (plugin) {
                // the files exist now: the container may be created or (if required) restarted
                plugin
                    .instanceIsReady(restartRequired)
                    .catch(e => this.log.error(`Cannot start the Asterisk container: ${(e as Error).message}`));
            } else {
                this.log.error('Docker plugin is not available. Is js-controller 7 or newer installed?');
            }
        } else if (restartRequired) {
            this.log.warn('start.sh, modules.conf or manager.conf changed: please restart Asterisk');
        }
        return result;
    }

    private async syncObjects(subscribers: GeneratorSubscriber[]): Promise<void> {
        this.subscribers = subscribers;
        const wanted = new Set(subscribers.map(s => s.extension));

        for (const sub of subscribers) {
            const id = `subscribers.${sub.extension}`;
            await this.extendObjectAsync(id, {
                type: 'channel',
                common: { name: sub.name },
                native: { kind: sub.kind },
            });
            await this.setObjectNotExistsAsync(`${id}.registered`, {
                type: 'state',
                common: {
                    name: 'Registered',
                    type: 'boolean',
                    role: 'indicator.reachable',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${id}.contacts`, {
                type: 'state',
                common: { name: 'Contacts', type: 'number', role: 'value', read: true, write: false, def: 0 },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${id}.userAgent`, {
                type: 'state',
                common: { name: 'User agent', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${id}.state`, {
                type: 'state',
                common: {
                    name: 'State',
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    def: 'unavailable',
                    states: {
                        idle: 'idle',
                        ringing: 'ringing',
                        inuse: 'in use',
                        unavailable: 'unavailable',
                    },
                },
                native: {},
            });
        }

        const channels = await this.getChannelsOfAsync('subscribers').catch(() => []);
        for (const channel of channels || []) {
            const ext = channel._id.split('.').pop() || '';
            if (!wanted.has(ext)) {
                this.log.info(`Deleting objects of removed subscriber ${ext}`);
                await this.delObjectAsync(`subscribers.${ext}`, { recursive: true });
            }
        }
        await this.setSubscribersOffline();
    }

    private async setSubscribersOffline(): Promise<void> {
        this.deviceStates.clear();
        this.cameraPoller?.setActive(false);
        for (const sub of this.subscribers) {
            await this.setStateChangedAsync(`subscribers.${sub.extension}.registered`, false, true);
            await this.setStateChangedAsync(`subscribers.${sub.extension}.contacts`, 0, true);
            await this.setStateChangedAsync(`subscribers.${sub.extension}.state`, 'unavailable', true);
        }
    }

    private startAmi(): void {
        this.ami = new AmiClient({
            host: this.config.amiHost || '127.0.0.1',
            port: toNumber(this.config.amiPort, 5038),
            username: AMI_USER,
            secret: this.config.amiSecret,
            log: this.log,
        });
        this.ami.on('connected', () => void this.onAmiConnected());
        this.ami.on('disconnected', () => void this.onAmiDisconnected());
        this.ami.on('event', (ev: AmiMessage) => void this.onAmiEvent(ev));
        this.log.info(
            `Waiting for Asterisk AMI on ${this.config.amiHost || '127.0.0.1'}:${toNumber(this.config.amiPort, 5038)}`,
        );
        this.ami.start();
    }

    private async onAmiConnected(): Promise<void> {
        this.log.info('Connected to Asterisk AMI');
        await this.setStateAsync('info.connection', true, true);
        try {
            const { response } = await this.ami!.action({ Action: 'CoreSettings' });
            if (response.AsteriskVersion) {
                await this.setStateAsync('info.asteriskVersion', response.AsteriskVersion, true);
            }
        } catch (e) {
            this.log.debug(`Cannot read Asterisk version: ${(e as Error).message}`);
        }

        const applied = await this.getStateAsync('info.configHash');
        if (applied?.val !== this.configHash) {
            await this.reloadAsterisk(RELOAD_ALL);
        }
        await this.applyLogSettings();
        await this.refreshStatus();

        if (this.statusTimer) {
            this.clearInterval(this.statusTimer);
        }
        this.statusTimer = this.setInterval(() => void this.refreshStatus(), STATUS_REFRESH_INTERVAL);
    }

    private async onAmiDisconnected(): Promise<void> {
        if (this.statusTimer) {
            this.clearInterval(this.statusTimer);
            this.statusTimer = undefined;
        }
        this.contacts.clear();
        await this.setStateAsync('info.connection', false, true);
        await this.setSubscribersOffline();
    }

    /**
     * Execute the reload commands. Concurrent calls are serialized.
     *
     * @param commands CLI commands
     */
    private reloadAsterisk(commands: string[]): Promise<void> {
        const run = async (): Promise<void> => {
            if (!this.ami?.connected) {
                throw new Error('Asterisk is not connected');
            }
            for (const command of commands) {
                this.log.debug(`Asterisk: ${command}`);
                try {
                    await this.ami.command(command);
                } catch (e) {
                    this.log.warn(`Asterisk command "${command}" failed: ${(e as Error).message}`);
                }
            }
            await this.setStateAsync('info.configHash', this.configHash, true);
            this.log.info('Asterisk configuration reloaded');
        };
        const previous = this.reloading || Promise.resolve();
        const current = previous.catch(() => {}).then(run);
        this.reloading = current;
        return current;
    }

    private async refreshStatus(): Promise<void> {
        if (!this.ami?.connected) {
            return;
        }
        try {
            const contacts = await this.ami.action({ Action: 'PJSIPShowContacts' });
            this.contacts.setFromList(contacts.events);
            for (const sub of this.subscribers) {
                await this.updateRegistration(sub.extension);
            }
            const devices = await this.ami.action({ Action: 'DeviceStateList' });
            for (const ev of devices.events) {
                await this.updateDeviceState(ev);
            }
        } catch (e) {
            this.log.debug(`Cannot read the status of the subscribers: ${(e as Error).message}`);
        }
    }

    private async updateRegistration(extension: string): Promise<void> {
        if (!this.subscribers.some(s => s.extension === extension)) {
            return;
        }
        const summary = this.contacts.summary(extension);
        await this.setStateChangedAsync(`subscribers.${extension}.registered`, summary.registered, true);
        await this.setStateChangedAsync(`subscribers.${extension}.contacts`, summary.contacts, true);
        await this.setStateChangedAsync(`subscribers.${extension}.userAgent`, summary.userAgent, true);
    }

    private async updateDeviceState(ev: AmiMessage): Promise<void> {
        const extension = extensionOfDevice(ev.Device);
        if (extension && this.subscribers.some(s => s.extension === extension)) {
            const state = mapDeviceState(ev.State);
            this.deviceStates.set(extension, state);
            this.cameraPoller?.setActive([...this.deviceStates.values()].some(s => s === 'ringing' || s === 'inuse'));
            await this.setStateChangedAsync(`subscribers.${extension}.state`, state, true);
        }
    }

    private async onAmiEvent(ev: AmiMessage): Promise<void> {
        try {
            switch (ev.Event) {
                case 'ContactStatus': {
                    const aor = this.contacts.applyContactStatus(ev);
                    if (aor) {
                        await this.updateRegistration(aor);
                    }
                    break;
                }
                case 'DeviceStateChange':
                    await this.updateDeviceState(ev);
                    break;
                case 'FullyBooted':
                    this.log.debug('Asterisk is fully booted');
                    break;
                default:
                    break;
            }
        } catch (e) {
            this.log.debug(`Cannot process AMI event ${ev.Event}: ${(e as Error).message}`);
        }
    }

    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj || typeof obj !== 'object' || !obj.command) {
            return;
        }
        const reply = (result: unknown): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result as ioBroker.MessagePayload, obj.callback);
            }
        };
        const message = (obj.message || {}) as Record<string, unknown>;

        switch (obj.command) {
            case 'generateCert': {
                let hosts: string[] = [];
                if (Array.isArray(message.certHosts)) {
                    hosts = message.certHosts.map(String);
                } else if (typeof message.certHosts === 'string') {
                    hosts = message.certHosts.split(/[,;\s]+/);
                }
                hosts = hosts.map(h => h.trim()).filter(Boolean);
                if (!hosts.length) {
                    hosts = getHostAddresses();
                }
                try {
                    const cert = generateCertificate(hosts);
                    this.log.info(`New certificate generated, fingerprint ${cert.certFingerprint}`);
                    reply({ native: { ...cert, certHosts: hosts } });
                } catch (e) {
                    reply({ error: (e as Error).message });
                }
                break;
            }

            case 'getHostAddresses':
                reply({ native: { certHosts: getHostAddresses() } });
                break;

            case 'getIobFingerprint': {
                // Fingerprint of a certificate from system.certificates for the settings dialog
                const name = typeof message.certIobPublic === 'string' ? message.certIobPublic : '';
                if (!name) {
                    reply({ text: '' });
                    break;
                }
                try {
                    const [certs] = await this.getCertificatesAsync(name, name);
                    reply({ text: certs?.cert ? getFingerprint(String(certs.cert)) : '' });
                } catch (e) {
                    reply({ text: (e as Error).message, style: { color: 'red' } });
                }
                break;
            }

            case 'getSubscriberStatus': {
                // a cell of the subscribers table in the admin
                const extension = typeof message.extension === 'string' ? message.extension.trim() : '';
                const known = this.subscribers.some(s => s.extension === extension);
                const config = await this.getForeignObjectAsync('system.config');
                reply(
                    describeSubscriber(
                        known ? this.contacts.summary(extension) : null,
                        this.deviceStates.get(extension),
                        config?.common?.language || 'en',
                    ),
                );
                break;
            }

            case 'getSubscriberOptions': {
                // the members of a group in the admin: the subscribers of the form, also the ones not saved yet
                const rows = Array.isArray(message.subscribers)
                    ? (message.subscribers as unknown[])
                    : (this.config.subscribers || []).filter(s => s?.enabled).map(s => [s.extension, s.name]);
                const options: { value: string; label: string }[] = [];
                for (const row of rows) {
                    const [extension, name] = Array.isArray(row)
                        ? row.map(v => (typeof v === 'string' ? v.trim() : ''))
                        : [];
                    if (extension && isValidExtension(extension) && !options.some(o => o.value === extension)) {
                        options.push({ value: extension, label: name ? `${extension} – ${name}` : extension });
                    }
                }
                reply(options);
                break;
            }

            case 'reload':
                try {
                    const result = await this.writeConfiguration(await this.getActiveCertificate());
                    await this.syncObjects(result?.subscribers || this.subscribers);
                    await this.reloadAsterisk(RELOAD_ALL);
                    await this.refreshStatus();
                    reply({ result: 'ok' });
                } catch (e) {
                    reply({ error: (e as Error).message });
                }
                break;

            default:
                this.log.warn(`Unknown command: ${obj.command}`);
                reply({ error: `Unknown command: ${obj.command}` });
        }
    }

    private getLogLevel(): AsteriskLogLevel {
        const level = this.config.asteriskLogLevel;
        return ASTERISK_LOG_LEVELS.includes(level) ? level : 'errors';
    }

    /** Forward the log file of Asterisk to the ioBroker log */
    private startLogTail(): void {
        if (this.getLogLevel() === 'none') {
            return;
        }
        this.logTail = new LogTail({
            file: join(this.configDir, LOG_FILE),
            onMessage: raw => {
                const { message, tlsPeer } = classifyMessage(raw);
                this.log[message.level](`Asterisk: ${message.text}`);
                if (tlsPeer) {
                    this.warnTlsPeer(tlsPeer);
                }
            },
            onSkipped: count => this.log.warn(`Asterisk: ${count} log messages skipped (more than 50 per second)`),
        });
        this.logTail.start();
    }

    /**
     * A client aborted the TLS handshake. Browsers do that with spare connections now and then, which
     * is harmless; only a client that fails again and again (20 times in 10 minutes) gets a warning.
     *
     * @param peer IP address of the client
     */
    private warnTlsPeer(peer: string): void {
        if (!this.tlsFailures.record(peer)) {
            return;
        }
        this.log.warn(
            `The client ${peer} repeatedly cannot establish the secure WebSocket connection (TLS handshake aborted), ` +
                'usually because it does not trust the certificate. Open the test page once on that device and ' +
                'accept the certificate, or close the page/app that still uses an old certificate.',
        );
    }

    /** Verbosity of the Asterisk core and SIP trace: runtime settings, applied after every connect */
    private async applyLogSettings(): Promise<void> {
        for (const command of getLogCommands(this.getLogLevel(), !!this.config.sipTrace)) {
            try {
                await this.ami?.command(command);
            } catch (e) {
                this.log.debug(`Asterisk command "${command}" failed: ${(e as Error).message}`);
            }
        }
        if (this.config.sipTrace) {
            this.log.warn('SIP trace is enabled: every SIP message is logged. Disable it after troubleshooting');
        }
    }

    /**
     * Snapshot proxy: fetch the pictures of the cameras (with credentials the browser cannot send in an
     * `<img>`) into `cameras.<name>.image` as data URL, for the camera picture of the phone widget.
     */
    private async startCameras(): Promise<void> {
        const rows = (this.config.cameras || []).map(c => ({
            ...c,
            password: c?.password ? this.decrypt(c.password) : '',
        }));
        const { cameras, warnings } = validateCameras(rows);
        warnings.forEach(w => this.log.warn(w));

        await this.setObjectNotExistsAsync('cameras', {
            type: 'folder',
            common: { name: 'Cameras' },
            native: {},
        });
        for (const camera of cameras) {
            await this.extendObjectAsync(`cameras.${camera.id}`, {
                type: 'channel',
                common: { name: camera.id },
                native: {},
            });
            await this.extendObjectAsync(`cameras.${camera.id}.image`, {
                type: 'state',
                common: {
                    name: 'Picture (data URL)',
                    desc: 'Select it in the phone widget under "Camera picture from state"',
                    type: 'string',
                    role: 'url',
                    read: true,
                    write: false,
                    def: '',
                },
                native: {},
            });
            await this.extendObjectAsync(`cameras.${camera.id}.error`, {
                type: 'state',
                common: { name: 'Error', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
        }
        const channels = await this.getChannelsOfAsync('cameras').catch(() => []);
        for (const channel of channels || []) {
            const id = channel._id.split('.').pop() || '';
            if (!cameras.some(c => c.id === id)) {
                this.log.info(`Deleting objects of removed camera ${id}`);
                await this.delObjectAsync(`cameras.${id}`, { recursive: true });
            }
        }
        if (!cameras.length) {
            return;
        }

        const describe = (camera: CameraSettings): string => `Camera ${camera.id} (${describeUrl(camera.url)})`;
        this.cameraPoller = new CameraPoller({
            cameras,
            fetch: camera =>
                fetchSnapshot({
                    url: camera.url,
                    auth: camera.auth,
                    user: camera.user,
                    password: camera.password,
                    insecure: camera.insecure,
                }),
            onImage: (camera, dataUrl) => void this.setState(`cameras.${camera.id}.image`, dataUrl, true),
            onError: (camera, error) => {
                if (error) {
                    this.log.warn(`${describe(camera)}: ${error}`);
                } else {
                    this.log.debug(`${describe(camera)}: OK`);
                }
                void this.setState(`cameras.${camera.id}.error`, error, true);
            },
        });
        this.cameraPoller.start();
        this.log.info(`Snapshot proxy for ${cameras.length} camera(s) started`);
    }

    private onUnload(callback: () => void): void {
        try {
            this.cameraPoller?.stop();
            this.cameraPoller = null;
            this.logTail?.stop();
            this.logTail = null;
            if (this.statusTimer) {
                this.clearInterval(this.statusTimer);
                this.statusTimer = undefined;
            }
            const ami = this.ami;
            this.ami = null;
            void Promise.race([ami?.stop(), new Promise(r => setTimeout(r, 300))]).finally(() => callback());
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new IntercomAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new IntercomAdapter())();
}

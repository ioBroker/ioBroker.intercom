import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import * as utils from '@iobroker/adapter-core';

import { AmiClient, type AmiMessage } from './lib/ami';
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
    generateConfig,
    getReloadCommands,
    RESTART_FILES,
    type GeneratorConfig,
    type GeneratorResult,
    type GeneratorSubscriber,
} from './lib/configGenerator';
import { writeConfigFiles } from './lib/configWriter';
import { ContactTracker, extensionOfDevice, mapDeviceState } from './lib/subscriberStatus';
import type { Codec } from './types';

/** The part of the docker plugin this adapter uses */
interface DockerPluginInstance {
    instanceIsReady(forceRestartOfExistingContainer?: boolean): Promise<void>;
}

/** Commands that make Asterisk read all generated files again */
const RELOAD_ALL = getReloadCommands(['pjsip.conf', 'extensions.conf', 'http.conf', 'rtp.conf']);
const STATUS_REFRESH_INTERVAL = 5 * 60_000;

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

export class AsteriskDockerAdapter extends utils.Adapter {
    private ami: AmiClient | null = null;
    private readonly contacts = new ContactTracker();
    private subscribers: GeneratorSubscriber[] = [];
    private configHash = '';
    private configDir = '';
    private statusTimer: ioBroker.Interval | undefined;
    private reloading: Promise<void> | null = null;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'asterisk-docker',
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
        // Passwords left empty in the table are generated and stored the way the table encrypts them
        const subscribers = this.config.subscribers || [];
        if (subscribers.some(s => s && !s.password)) {
            const systemConfig = await this.getForeignObjectAsync('system.config');
            const secret = (systemConfig?.native as { secret?: string } | undefined)?.secret || 'Zgfr56gFe87jJOM';
            native.subscribers = subscribers.map(s => {
                if (s && !s.password) {
                    this.log.info(`Generated a password for subscriber ${s.extension}`);
                    return { ...s, password: legacyEncrypt(secret, randomSecret(12)) };
                }
                return s;
            });
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
            codecs: codecs.length ? codecs : ['ulaw', 'alaw'],
            echoTest: this.config.echoTest !== false,
            testPage: this.config.testPage !== false,
            subscribers: (this.config.subscribers || []).map(s => ({
                extension: String(s?.extension ?? '').trim(),
                name: s?.name || '',
                kind: s?.kind === 'sip' ? 'sip' : 'webrtc',
                enabled: !!s?.enabled,
            })),
        };
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
            result = generateConfig(this.getGeneratorConfig(), {
                amiSecret: this.config.amiSecret,
                passwords: this.getPasswords(),
                certPublic: certificate?.cert || '',
                certPrivate: certificate?.key || '',
            });
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
            await this.setStateChangedAsync(`subscribers.${extension}.state`, mapDeviceState(ev.State), true);
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

    private onUnload(callback: () => void): void {
        try {
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
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new AsteriskDockerAdapter(options);
} else {
    // otherwise start the instance directly
    (() => new AsteriskDockerAdapter())();
}

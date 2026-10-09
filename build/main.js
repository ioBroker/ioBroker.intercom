"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsteriskDockerAdapter = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const utils = __importStar(require("@iobroker/adapter-core"));
const ami_1 = require("./lib/ami");
const certificate_1 = require("./lib/certificate");
const configGenerator_1 = require("./lib/configGenerator");
const configWriter_1 = require("./lib/configWriter");
const subscriberStatus_1 = require("./lib/subscriberStatus");
const testPage_1 = require("./lib/testPage");
/** Commands that make Asterisk read all generated files again */
const RELOAD_ALL = (0, configGenerator_1.getReloadCommands)(['pjsip.conf', 'extensions.conf', 'http.conf', 'rtp.conf']);
const STATUS_REFRESH_INTERVAL = 5 * 60_000;
/** Passwords of the subscribers that io-package.json creates on installation */
const DEFAULT_PASSWORDS = { 100: '0100', 101: '0101' };
function randomSecret(length) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = (0, node_crypto_1.randomBytes)(length);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}
/** Encryption used by the jsonConfig table for `encryptedAttributes` */
function legacyEncrypt(secret, value) {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        result += String.fromCharCode(secret[i % secret.length].charCodeAt(0) ^ value.charCodeAt(i));
    }
    return result;
}
function toNumber(value, def) {
    const n = parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}
class AsteriskDockerAdapter extends utils.Adapter {
    ami = null;
    contacts = new subscriberStatus_1.ContactTracker();
    subscribers = [];
    configHash = '';
    configDir = '';
    statusTimer;
    reloading = null;
    constructor(options = {}) {
        super({
            ...options,
            name: 'asterisk-docker',
            ready: () => this.main(),
            unload: callback => this.onUnload(callback),
            message: obj => this.onMessage(obj),
        });
    }
    async main() {
        await this.setStateAsync('info.connection', false, true);
        // Fill everything that has to be generated once. Writing the instance object restarts the adapter.
        if (await this.initNativeOnce()) {
            return;
        }
        this.configDir = this.config.configDir;
        const certificate = await this.getActiveCertificate();
        const fingerprint = certificate ? this.safeFingerprint(certificate.cert) : '';
        await this.setStateAsync('info.certFingerprint', fingerprint, true);
        const wssHost = (certificate && this.safeSan(certificate.cert)[0]) || (this.config.certHosts || [])[0] || 'localhost';
        await this.setStateAsync('info.wssUrl', `wss://${wssHost}:${toNumber(this.config.wssPort, 8089)}/ws`, true);
        if (certificate && this.config.certSource !== 'iobroker') {
            const uncovered = (0, certificate_1.getUncoveredHosts)(certificate.cert, (0, certificate_1.getHostAddresses)().filter(h => /^\d+\.\d+\.\d+\.\d+$/.test(h)));
            if (uncovered.length) {
                this.log.warn(`The certificate does not contain the address(es) ${uncovered.join(', ')} of this host. ` +
                    'Clients using these addresses will fail. Regenerate the certificate in the settings if required ' +
                    '(all apps have to accept the new fingerprint afterwards).');
            }
        }
        const result = await this.writeConfiguration(certificate);
        await this.syncObjects(result?.subscribers || []);
        this.warnDefaultPasswords();
        this.startAmi();
    }
    /**
     * Generate secrets, the configuration directory and the certificate if they do not exist yet.
     *
     * @returns true if the instance object was changed and the adapter will restart
     */
    async initNativeOnce() {
        const native = {};
        if (!this.config.configDir) {
            native.configDir = (0, node_path_1.join)(utils.getAbsoluteInstanceDataDir(this), 'asterisk');
        }
        if (!this.config.amiSecret) {
            native.amiSecret = this.encrypt(randomSecret(32));
        }
        if (this.config.certSource !== 'iobroker' && !this.config.certPublic) {
            const hosts = this.config.certHosts?.length ? this.config.certHosts : (0, certificate_1.getHostAddresses)();
            this.log.info(`Generating a self-signed certificate for ${hosts.join(', ')}`);
            try {
                const cert = (0, certificate_1.generateCertificate)(hosts);
                native.certHosts = hosts;
                native.certPublic = cert.certPublic;
                native.certPrivate = this.encrypt(cert.certPrivate);
                native.certFingerprint = cert.certFingerprint;
            }
            catch (e) {
                this.log.error(`Cannot generate certificate: ${e.message}`);
            }
        }
        // The subscribers of io-package.json come with clear text passwords (the secret of the system is
        // unknown there). They and the passwords left empty in the table are stored the way the table
        // encrypts them.
        const subscribers = this.config.subscribers || [];
        const plain = !!this.config.subscribersPlain;
        if (plain || subscribers.some(s => s && !s.password)) {
            const systemConfig = await this.getForeignObjectAsync('system.config');
            const secret = systemConfig?.native?.secret || 'Zgfr56gFe87jJOM';
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
    async getActiveCertificate() {
        if (this.config.certSource === 'iobroker') {
            if (!this.config.certIobPublic || !this.config.certIobPrivate) {
                this.log.error('No certificate of ioBroker selected');
                return null;
            }
            try {
                const [certs] = await this.getCertificatesAsync(this.config.certIobPublic, this.config.certIobPrivate, this.config.certIobChained || undefined);
                if (!certs?.cert || !certs?.key) {
                    this.log.error('Selected ioBroker certificate not found');
                    return null;
                }
                const ca = certs.ca ? (Array.isArray(certs.ca) ? certs.ca.join('\n') : String(certs.ca)) : '';
                return {
                    cert: ca ? `${String(certs.cert).trim()}\n${ca.trim()}\n` : String(certs.cert),
                    key: String(certs.key),
                };
            }
            catch (e) {
                this.log.error(`Cannot read ioBroker certificates: ${e.message}`);
                return null;
            }
        }
        if (!this.config.certPublic || !this.config.certPrivate) {
            return null;
        }
        return { cert: this.config.certPublic, key: this.config.certPrivate };
    }
    safeFingerprint(pem) {
        try {
            return (0, certificate_1.getFingerprint)(pem);
        }
        catch (e) {
            this.log.error(`Invalid certificate: ${e.message}`);
            return '';
        }
    }
    safeSan(pem) {
        try {
            return (0, certificate_1.getSubjectAltNames)(pem);
        }
        catch {
            return [];
        }
    }
    getGeneratorConfig() {
        const codecs = (Array.isArray(this.config.codecs) ? this.config.codecs : []).filter((c) => configGenerator_1.ALL_CODECS.includes(c));
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
    /** The subscribers of a new installation have well-known passwords */
    warnDefaultPasswords() {
        const passwords = this.getPasswords();
        const defaults = Object.entries(DEFAULT_PASSWORDS).filter(([ext, pw]) => passwords[ext] === pw);
        if (defaults.length) {
            this.log.warn(`Subscriber(s) ${defaults.map(([ext]) => ext).join(', ')} still use the default password of the installation. ` +
                'Change it in the settings, at the latest before Asterisk is reachable from outside the LAN.');
        }
    }
    getPasswords() {
        const passwords = {};
        for (const s of this.config.subscribers || []) {
            const ext = String(s?.extension ?? '').trim();
            if (ext && s.password && passwords[ext] === undefined) {
                passwords[ext] = this.decrypt(s.password);
            }
        }
        return passwords;
    }
    /** Phone bundle (React + MUI + JsSIP) for the test page, built into `build/static` by `npm run build:www` */
    async readPhoneBundle() {
        if (this.config.testPage === false) {
            return undefined;
        }
        const file = (0, node_path_1.join)(__dirname, 'static', testPage_1.PHONE_FILE);
        try {
            return await (0, promises_1.readFile)(file, 'utf8');
        }
        catch (e) {
            this.log.warn(`Cannot read ${file}: ${e.message}. The test page will not work`);
            return undefined;
        }
    }
    /**
     * Generate and write all files, then hand the container over to the docker plugin.
     *
     * @param certificate the certificate for the WSS listener
     */
    async writeConfiguration(certificate) {
        let result;
        try {
            result = (0, configGenerator_1.generateConfig)(this.getGeneratorConfig(), {
                amiSecret: this.config.amiSecret,
                passwords: this.getPasswords(),
                certPublic: certificate?.cert || '',
                certPrivate: certificate?.key || '',
            }, { phone: await this.readPhoneBundle() });
        }
        catch (e) {
            this.log.error(`Cannot generate the Asterisk configuration: ${e.message}`);
            return null;
        }
        result.warnings.forEach(w => this.log.warn(w));
        if (!certificate) {
            this.log.warn('No certificate available: WSS (WebRTC) will not work');
        }
        let restartRequired = false;
        try {
            const written = await (0, configWriter_1.writeConfigFiles)(this.configDir, result.files);
            this.configHash = written.hash;
            if (written.changed.length) {
                this.log.info(`Asterisk configuration written to ${this.configDir}: ${written.changed.join(', ')}`);
            }
            restartRequired = written.changed.some(f => configGenerator_1.RESTART_FILES.includes(f));
        }
        catch (e) {
            this.log.error(`Cannot write the Asterisk configuration to ${this.configDir}: ${e.message}`);
            return result;
        }
        if (this.config.dockerEnabled) {
            const plugin = this.getPluginInstance('docker');
            if (plugin) {
                // the files exist now: the container may be created or (if required) restarted
                plugin
                    .instanceIsReady(restartRequired)
                    .catch(e => this.log.error(`Cannot start the Asterisk container: ${e.message}`));
            }
            else {
                this.log.error('Docker plugin is not available. Is js-controller 7 or newer installed?');
            }
        }
        else if (restartRequired) {
            this.log.warn('start.sh, modules.conf or manager.conf changed: please restart Asterisk');
        }
        return result;
    }
    async syncObjects(subscribers) {
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
    async setSubscribersOffline() {
        for (const sub of this.subscribers) {
            await this.setStateChangedAsync(`subscribers.${sub.extension}.registered`, false, true);
            await this.setStateChangedAsync(`subscribers.${sub.extension}.contacts`, 0, true);
            await this.setStateChangedAsync(`subscribers.${sub.extension}.state`, 'unavailable', true);
        }
    }
    startAmi() {
        this.ami = new ami_1.AmiClient({
            host: this.config.amiHost || '127.0.0.1',
            port: toNumber(this.config.amiPort, 5038),
            username: configGenerator_1.AMI_USER,
            secret: this.config.amiSecret,
            log: this.log,
        });
        this.ami.on('connected', () => void this.onAmiConnected());
        this.ami.on('disconnected', () => void this.onAmiDisconnected());
        this.ami.on('event', (ev) => void this.onAmiEvent(ev));
        this.log.info(`Waiting for Asterisk AMI on ${this.config.amiHost || '127.0.0.1'}:${toNumber(this.config.amiPort, 5038)}`);
        this.ami.start();
    }
    async onAmiConnected() {
        this.log.info('Connected to Asterisk AMI');
        await this.setStateAsync('info.connection', true, true);
        try {
            const { response } = await this.ami.action({ Action: 'CoreSettings' });
            if (response.AsteriskVersion) {
                await this.setStateAsync('info.asteriskVersion', response.AsteriskVersion, true);
            }
        }
        catch (e) {
            this.log.debug(`Cannot read Asterisk version: ${e.message}`);
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
    async onAmiDisconnected() {
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
    reloadAsterisk(commands) {
        const run = async () => {
            if (!this.ami?.connected) {
                throw new Error('Asterisk is not connected');
            }
            for (const command of commands) {
                this.log.debug(`Asterisk: ${command}`);
                try {
                    await this.ami.command(command);
                }
                catch (e) {
                    this.log.warn(`Asterisk command "${command}" failed: ${e.message}`);
                }
            }
            await this.setStateAsync('info.configHash', this.configHash, true);
            this.log.info('Asterisk configuration reloaded');
        };
        const previous = this.reloading || Promise.resolve();
        const current = previous.catch(() => { }).then(run);
        this.reloading = current;
        return current;
    }
    async refreshStatus() {
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
        }
        catch (e) {
            this.log.debug(`Cannot read the status of the subscribers: ${e.message}`);
        }
    }
    async updateRegistration(extension) {
        if (!this.subscribers.some(s => s.extension === extension)) {
            return;
        }
        const summary = this.contacts.summary(extension);
        await this.setStateChangedAsync(`subscribers.${extension}.registered`, summary.registered, true);
        await this.setStateChangedAsync(`subscribers.${extension}.contacts`, summary.contacts, true);
        await this.setStateChangedAsync(`subscribers.${extension}.userAgent`, summary.userAgent, true);
    }
    async updateDeviceState(ev) {
        const extension = (0, subscriberStatus_1.extensionOfDevice)(ev.Device);
        if (extension && this.subscribers.some(s => s.extension === extension)) {
            await this.setStateChangedAsync(`subscribers.${extension}.state`, (0, subscriberStatus_1.mapDeviceState)(ev.State), true);
        }
    }
    async onAmiEvent(ev) {
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
        }
        catch (e) {
            this.log.debug(`Cannot process AMI event ${ev.Event}: ${e.message}`);
        }
    }
    async onMessage(obj) {
        if (!obj || typeof obj !== 'object' || !obj.command) {
            return;
        }
        const reply = (result) => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        };
        const message = (obj.message || {});
        switch (obj.command) {
            case 'generateCert': {
                let hosts = [];
                if (Array.isArray(message.certHosts)) {
                    hosts = message.certHosts.map(String);
                }
                else if (typeof message.certHosts === 'string') {
                    hosts = message.certHosts.split(/[,;\s]+/);
                }
                hosts = hosts.map(h => h.trim()).filter(Boolean);
                if (!hosts.length) {
                    hosts = (0, certificate_1.getHostAddresses)();
                }
                try {
                    const cert = (0, certificate_1.generateCertificate)(hosts);
                    this.log.info(`New certificate generated, fingerprint ${cert.certFingerprint}`);
                    reply({ native: { ...cert, certHosts: hosts } });
                }
                catch (e) {
                    reply({ error: e.message });
                }
                break;
            }
            case 'getHostAddresses':
                reply({ native: { certHosts: (0, certificate_1.getHostAddresses)() } });
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
                    reply({ text: certs?.cert ? (0, certificate_1.getFingerprint)(String(certs.cert)) : '' });
                }
                catch (e) {
                    reply({ text: e.message, style: { color: 'red' } });
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
                }
                catch (e) {
                    reply({ error: e.message });
                }
                break;
            default:
                this.log.warn(`Unknown command: ${obj.command}`);
                reply({ error: `Unknown command: ${obj.command}` });
        }
    }
    onUnload(callback) {
        try {
            if (this.statusTimer) {
                this.clearInterval(this.statusTimer);
                this.statusTimer = undefined;
            }
            const ami = this.ami;
            this.ami = null;
            void Promise.race([ami?.stop(), new Promise(r => setTimeout(r, 300))]).finally(() => callback());
        }
        catch {
            callback();
        }
    }
}
exports.AsteriskDockerAdapter = AsteriskDockerAdapter;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new AsteriskDockerAdapter(options);
}
else {
    // otherwise start the instance directly
    (() => new AsteriskDockerAdapter())();
}
//# sourceMappingURL=main.js.map
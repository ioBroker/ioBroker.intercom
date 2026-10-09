const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ioPackage = require('../../io-package.json');
const compose = readFileSync(join(__dirname, '..', '..', 'docker-compose.yaml'), 'utf8');

describe('docker-compose.yaml', () => {
    it('is registered for the docker plugin', () => {
        assert.deepEqual(ioPackage.common.plugins.docker.iobDockerComposeFiles, ['docker-compose.yaml']);
    });

    it('uses host networking, needed for RTP and ICE', () => {
        assert.match(compose, /^\s+network_mode: host$/m);
    });

    it('waits for the adapter and is opt-in', () => {
        assert.ok(compose.includes("'iobWaitForReady=true'"));
        assert.ok(compose.includes("'iobEnabled=${config.dockerEnabled:-false}'"));
    });

    it('only references existing native settings', () => {
        const refs = [...compose.matchAll(/\$\{config\.([a-zA-Z]+)/g)].map(m => m[1]);
        assert.ok(refs.length > 0);
        for (const ref of refs) {
            assert.ok(Object.hasOwn(ioPackage.native, ref), `native.${ref} is missing`);
        }
    });

    it('mounts the log directory writable, the configuration read-only', () => {
        assert.ok(compose.includes("'${config.configDir}/logs:/var/log/asterisk'"));
    });

    it('mounts the configuration directory where start.sh expects it', () => {
        assert.ok(compose.includes("'${config.configDir}:/etc/asterisk/iobroker:ro'"));
        assert.ok(compose.includes("'/etc/asterisk/iobroker/start.sh'"));
    });
});

describe('io-package.json', () => {
    it('creates a WebRTC and a SIP subscriber that the generator accepts', () => {
        const { generateConfig } = require('../../build/lib/configGenerator');
        const subs = ioPackage.native.subscribers;
        assert.deepEqual(
            subs.map(s => [s.extension, s.kind, s.enabled]),
            [
                ['100', 'webrtc', true],
                ['101', 'sip', true],
            ],
        );
        // clear text until the first start encrypts them with the secret of the system
        assert.equal(ioPackage.native.subscribersPlain, true);
        const passwords = Object.fromEntries(subs.map(s => [s.extension, s.password]));
        const r = generateConfig(
            { ...ioPackage.native, codecs: ioPackage.native.codecs, subscribers: subs },
            { amiSecret: 'x', passwords, certPublic: '', certPrivate: '' },
        );
        assert.deepEqual(r.warnings, []);
        assert.deepEqual(
            r.subscribers.map(s => s.extension),
            ['100', '101'],
        );
        // the test page calls the phone (101), not the echo test
        assert.ok(r.files['static-http/test.html'].includes('data-number="101"'));
        // errors and warnings of Asterisk go to the ioBroker log by default
        assert.equal(ioPackage.native.asteriskLogLevel, 'errors');
        assert.match(r.files['logger.conf'], /^iobroker\.log => error,warning$/m);
    });

    it('encrypts and protects the secrets', () => {
        for (const key of ['amiSecret', 'certPrivate']) {
            assert.ok(ioPackage.encryptedNative.includes(key), `${key} not encrypted`);
            assert.ok(ioPackage.protectedNative.includes(key), `${key} not protected`);
        }
    });
});

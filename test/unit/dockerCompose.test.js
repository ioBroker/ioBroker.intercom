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

    it('mounts the configuration directory where start.sh expects it', () => {
        assert.ok(compose.includes("'${config.configDir}:/etc/asterisk/iobroker:ro'"));
        assert.ok(compose.includes("'/etc/asterisk/iobroker/start.sh'"));
    });
});

describe('io-package.json', () => {
    it('encrypts and protects the secrets', () => {
        for (const key of ['amiSecret', 'certPrivate']) {
            assert.ok(ioPackage.encryptedNative.includes(key), `${key} not encrypted`);
            assert.ok(ioPackage.protectedNative.includes(key), `${key} not protected`);
        }
    });
});

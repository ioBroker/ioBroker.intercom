const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { writeConfigFiles, hashFiles } = require('../../build/lib/configWriter');

describe('writeConfigFiles', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'iob-asterisk-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('writes only changed files and keeps custom files', async () => {
        const files = {
            'pjsip.conf': 'a',
            'manager.conf': 'secret',
            'keys/asterisk.key': 'key',
            'static-http/test.html': '<html>',
        };
        let r = await writeConfigFiles(dir, files);
        assert.deepEqual(r.changed.sort(), Object.keys(files).sort());
        assert.equal(r.hash, hashFiles(files));

        r = await writeConfigFiles(dir, files);
        assert.deepEqual(r.changed, []);

        writeFileSync(join(dir, 'pjsip_custom.conf'), 'mine');
        writeFileSync(join(dir, 'notes.txt'), 'mine');
        r = await writeConfigFiles(dir, { 'pjsip.conf': 'b', 'manager.conf': 'secret', 'keys/asterisk.key': 'key' });
        assert.deepEqual(r.changed, ['pjsip.conf']);
        assert.deepEqual(r.removed, ['static-http/test.html']);
        assert.equal(readFileSync(join(dir, 'pjsip.conf'), 'utf8'), 'b');
        assert.equal(existsSync(join(dir, 'pjsip_custom.conf')), true);
        assert.equal(existsSync(join(dir, 'notes.txt')), true);
    });

    it('writes secrets with mode 0600', async function () {
        if (process.platform === 'win32') {
            this.skip();
        }
        await writeConfigFiles(dir, { 'manager.conf': 'secret', 'keys/asterisk.key': 'key', 'http.conf': 'x' });
        assert.equal(statSync(join(dir, 'manager.conf')).mode & 0o777, 0o600);
        assert.equal(statSync(join(dir, 'keys/asterisk.key')).mode & 0o777, 0o600);
        assert.equal(statSync(join(dir, 'http.conf')).mode & 0o777, 0o644);
    });

    it('leaves no temp files', async () => {
        await writeConfigFiles(dir, { 'http.conf': 'x' });
        assert.deepEqual(
            readdirSync(dir).filter(f => f.endsWith('.tmp')),
            [],
        );
    });
});

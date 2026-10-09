const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const {
    generateConfig,
    getReloadCommands,
    md5Credential,
    sanitizeName,
    HEADER,
} = require('../../build/lib/configGenerator');

const SNAPSHOT_DIR = join(__dirname, '__snapshots__');

/**
 * Compare all files with the stored snapshot. A missing snapshot is written;
 * run with UPDATE_SNAPSHOTS=1 to accept intended changes.
 */
function matchSnapshot(name, files) {
    const text = Object.keys(files)
        .sort()
        .map(file => `===== ${file} =====\n${files[file]}`)
        .join('\n');
    const path = join(SNAPSHOT_DIR, `${name}.snap`);
    if (!existsSync(path) || process.env.UPDATE_SNAPSHOTS) {
        mkdirSync(SNAPSHOT_DIR, { recursive: true });
        writeFileSync(path, text);
        return;
    }
    assert.equal(text, readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
}

function config(subscribers = [], extra = {}) {
    return {
        amiPort: 5038,
        wssPort: 8089,
        rtpStart: 10000,
        rtpEnd: 20000,
        stunServer: '',
        externalAddress: '',
        iceDenylist: '172.16.0.0/12',
        codecs: ['opus', 'ulaw', 'alaw'],
        echoTest: true,
        testPage: true,
        subscribers,
        ...extra,
    };
}

const secrets = {
    amiSecret: 'amisecret123',
    passwords: { 101: 'password101', 102: 'password102', 201: 'password201', 300: 'password300' },
    certPublic: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
    certPrivate: '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----\n',
};

describe('generateConfig', () => {
    it('0 subscribers', () => {
        const r = generateConfig(config(), secrets);
        assert.deepEqual(r.warnings, []);
        assert.ok(!r.files['pjsip.conf'].includes('[transport-udp]'));
        matchSnapshot('zero', r.files);
    });

    it('1 WebRTC subscriber', () => {
        const r = generateConfig(config([{ extension: '101', name: 'Kitchen', kind: 'webrtc', enabled: true }]), secrets);
        assert.deepEqual(
            r.subscribers.map(s => s.extension),
            ['101'],
        );
        assert.ok(r.files['pjsip.conf'].includes('webrtc=yes'));
        assert.ok(r.files['pjsip.conf'].includes('[101](webrtc-endpoint)'));
        matchSnapshot('one', r.files);
    });

    it('mixed WebRTC and SIP, disabled subscribers, no test page, STUN and NAT', () => {
        const r = generateConfig(
            config(
                [
                    { extension: '101', name: 'Kitchen', kind: 'webrtc', enabled: true },
                    { extension: '102', name: 'Office', kind: 'webrtc', enabled: false },
                    { extension: '201', name: 'Door', kind: 'sip', enabled: true },
                    { extension: '300', name: 'Living room', kind: 'webrtc', enabled: true },
                ],
                {
                    testPage: false,
                    echoTest: false,
                    stunServer: 'stun.l.google.com:19302',
                    externalAddress: 'pbx.example.com',
                    codecs: ['opus', 'g722', 'ulaw'],
                },
            ),
            secrets,
        );
        assert.deepEqual(
            r.subscribers.map(s => s.extension),
            ['101', '201', '300'],
        );
        assert.ok(r.files['pjsip.conf'].includes('[transport-udp]'));
        assert.ok(!r.files['pjsip.conf'].includes('[102]'));
        assert.equal(r.files['static-http/test.html'], undefined);
        assert.ok(r.files['http.conf'].includes('enablestatic=no'));
        assert.ok(!r.files['extensions.conf'].includes('exten => 600'));
        // SIP endpoints never get opus
        assert.match(r.files['pjsip.conf'], /\[sip-endpoint\][^[]*allow=g722,ulaw\n/);
        matchSnapshot('mixed', r.files);
    });

    it('every config file starts with the header', () => {
        const r = generateConfig(config(), secrets);
        for (const name of Object.keys(r.files).filter(f => f.endsWith('.conf'))) {
            assert.ok(r.files[name].startsWith(HEADER), name);
        }
    });

    it('stores no clear text passwords, only md5 credentials', () => {
        const r = generateConfig(config([{ extension: '101', name: 'A', kind: 'webrtc', enabled: true }]), secrets);
        const all = Object.values(r.files).join('\n');
        assert.ok(!all.includes('password101'));
        assert.ok(r.files['pjsip.conf'].includes(`md5_cred=${md5Credential('101', 'password101')}`));
        assert.equal(
            md5Credential('101', 'password101'),
            createHash('md5').update('101:iobroker:password101').digest('hex'),
        );
    });

    it('skips invalid, duplicate and reserved extensions and short passwords with a warning', () => {
        const r = generateConfig(
            config([
                { extension: '1', name: 'too short', kind: 'webrtc', enabled: true },
                { extension: '1234567', name: 'too long', kind: 'webrtc', enabled: true },
                { extension: '10a', name: 'letters', kind: 'webrtc', enabled: true },
                { extension: '600', name: 'echo', kind: 'webrtc', enabled: true },
                { extension: '101', name: 'first', kind: 'webrtc', enabled: true },
                { extension: '101', name: 'duplicate', kind: 'sip', enabled: true },
                { extension: '555', name: 'no password', kind: 'webrtc', enabled: true },
                null,
            ]),
            secrets,
        );
        assert.deepEqual(
            r.subscribers.map(s => s.extension),
            ['101'],
        );
        assert.equal(r.warnings.length, 6);
    });

    it('serves the phone bundle next to the test page, without any CDN', () => {
        const r = generateConfig(config(), secrets, { phone: 'console.log(1);' });
        assert.equal(r.files['static-http/phone.min.js'], 'console.log(1);');
        const page = r.files['static-http/test.html'];
        assert.ok(page.includes('<script src="phone.min.js"></script>'));
        assert.ok(page.includes('data-echo="600"'));
        assert.doesNotMatch(page, /https?:\/\//);

        const off = generateConfig(config([], { testPage: false }), secrets, { phone: 'x' });
        assert.equal(off.files['static-http/phone.min.js'], undefined);
        assert.equal(off.files['static-http/test.html'], undefined);
    });

    it('the built phone bundle contains React, MUI and JsSIP', () => {
        const file = join(__dirname, '..', '..', 'build', 'static', 'phone.min.js');
        assert.ok(existsSync(file), 'run npm run build first');
        const code = readFileSync(file, 'utf8');
        assert.ok(code.length > 200000);
        assert.ok(code.includes(`"${require('jssip/package.json').version}"`), 'JsSIP version is bundled');
        assert.ok(code.includes('iobroker-phone'), 'the phone UI is bundled');
    });

    it('accepts passwords with 4 characters, but not with 3', () => {
        const r = generateConfig(
            config([
                { extension: '401', name: 'four', kind: 'webrtc', enabled: true },
                { extension: '402', name: 'three', kind: 'sip', enabled: true },
            ]),
            { ...secrets, passwords: { 401: '1234', 402: '123' } },
        );
        assert.deepEqual(
            r.subscribers.map(s => s.extension),
            ['401'],
        );
        assert.deepEqual(r.warnings, ['Subscriber 402 skipped: password must have at least 4 characters']);
    });

    describe('injection attempts', () => {
        const evil = [
            {
                extension: '101',
                name: 'Evil"\n[anonymous]\ntype=endpoint\ncontext=iobroker',
                kind: 'webrtc',
                enabled: true,
            },
            { extension: '102\n[x]', name: 'x', kind: 'webrtc', enabled: true },
            { extension: '201', name: 'a;comment <999> [s]\r\nallow=all', kind: 'sip', enabled: true },
        ];

        it('removes line breaks, brackets, quotes and semicolons from names', () => {
            assert.equal(sanitizeName('a"b<c>d;e[f]g\nh\ri\\j'), 'abcdefghij');
        });

        it('cannot create new sections or options', () => {
            const r = generateConfig(
                config(evil, {
                    stunServer: 'evil\n[x]',
                    externalAddress: '1.2.3.4\nallow=all',
                    iceDenylist: '10.0.0.0/8\n[y]',
                }),
                { ...secrets, amiSecret: 'abc\n[admin]\nsecret=x' },
            );
            assert.deepEqual(
                r.subscribers.map(s => s.extension),
                ['101', '201'],
            );
            const pjsip = r.files['pjsip.conf'];
            assert.ok(!pjsip.includes('[anonymous]'));
            // everything ends up inside the quoted CallerID of the own line
            assert.ok(pjsip.includes('callerid="Evilanonymoustype=endpointcontext=iobroker" <101>'));
            assert.ok(pjsip.includes('callerid="acomment 999 sallow=all" <201>'));
            assert.doesNotMatch(pjsip, /^allow=all$/m);
            assert.doesNotMatch(r.files['rtp.conf'], /^\[x\]/m);
            assert.doesNotMatch(r.files['rtp.conf'], /^\[y\]/m);
            assert.doesNotMatch(r.files['manager.conf'], /^\[admin\]/m);
            // the only sections are the generated ones
            assert.deepEqual(pjsip.match(/^\[[^\]]*\]/gm), [
                '[global]',
                '[transport-wss]',
                '[transport-udp]',
                '[webrtc-endpoint]',
                '[sip-endpoint]',
                '[aor-template]',
                '[auth-template]',
                '[101]',
                '[101]',
                '[101]',
                '[201]',
                '[201]',
                '[201]',
            ]);
            matchSnapshot('injection', r.files);
        });
    });

    it('is deterministic', () => {
        const c = config([{ extension: '101', name: 'A', kind: 'webrtc', enabled: true }]);
        assert.deepEqual(generateConfig(c, secrets).files, generateConfig(c, secrets).files);
    });

    it('selects reload commands for the changed files', () => {
        assert.deepEqual(getReloadCommands(['pjsip.conf', 'keys/asterisk.crt']), [
            'module reload res_pjsip.so',
            'module reload http',
        ]);
        assert.deepEqual(getReloadCommands(['rtp.conf', 'extensions.conf', 'manager.conf']), [
            'dialplan reload',
            'module reload res_rtp_asterisk.so',
            'manager reload',
        ]);
    });
});

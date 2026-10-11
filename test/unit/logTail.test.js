const assert = require('node:assert/strict');
const { appendFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { classifyMessage, LogTail, mapLevel, parseLogLines, TlsFailureMonitor } = require('../../build/lib/logTail');

describe('Asterisk log', () => {
    it('maps the levels of Asterisk to ioBroker', () => {
        assert.equal(mapLevel('ERROR'), 'error');
        assert.equal(mapLevel('WARNING'), 'warn');
        assert.equal(mapLevel('SECURITY'), 'warn');
        assert.equal(mapLevel('NOTICE'), 'info');
        assert.equal(mapLevel('VERBOSE'), 'debug');
        assert.equal(mapLevel('DEBUG'), 'debug');
    });

    it('parses lines with and without call id', () => {
        const { messages, pending } = parseLogLines([
            '[2026-10-09 10:12:13.123] WARNING[1234] res_pjsip_registrar.c: Endpoint 100 failed to authenticate',
            '[2026-10-09 10:12:14.001] VERBOSE[1300][C-00000001] pbx.c: Executing [101@iobroker:1] Dial',
            '[2026-10-09 10:12:15.500] ERROR[1301] chan_pjsip.c: Something broke',
        ]);
        assert.deepEqual(messages, [
            {
                level: 'warn',
                asteriskLevel: 'WARNING',
                text: 'res_pjsip_registrar.c: Endpoint 100 failed to authenticate',
            },
            { level: 'debug', asteriskLevel: 'VERBOSE', text: 'pbx.c: Executing [101@iobroker:1] Dial' },
        ]);
        // the last message may still get continuation lines
        assert.deepEqual(pending, { level: 'error', asteriskLevel: 'ERROR', text: 'chan_pjsip.c: Something broke' });
    });

    it('appends lines without prefix (SIP trace) to the message before', () => {
        const first = parseLogLines([
            '[2026-10-09 10:00:00.000] VERBOSE[1] res_pjsip_logger.c: <--- Received SIP request (500 bytes) from WSS:1.2.3.4:5000 --->',
            'REGISTER sip:192.168.1.187 SIP/2.0',
        ]);
        assert.deepEqual(first.messages, []);
        const second = parseLogLines(['Via: SIP/2.0/WSS abc.invalid', '', '[2026-10-09 10:00:01.000] NOTICE[1] x.c: next'], first.pending);
        assert.equal(second.messages.length, 1);
        assert.equal(
            second.messages[0].text,
            'res_pjsip_logger.c: <--- Received SIP request (500 bytes) from WSS:1.2.3.4:5000 --->\nREGISTER sip:192.168.1.187 SIP/2.0\nVia: SIP/2.0/WSS abc.invalid',
        );
        assert.equal(second.pending.level, 'info');
    });

    it('turns the errors of an aborted TLS handshake into one client address', () => {
        const err = text => ({ level: 'error', asteriskLevel: 'ERROR', text });
        const peer = classifyMessage(err("tcptls.c: Unable to set up ssl connection with peer '192.168.1.6:59161'"));
        assert.equal(peer.tlsPeer, '192.168.1.6');
        assert.equal(peer.message.level, 'debug');

        const v6 = classifyMessage(err("tcptls.c: Unable to set up ssl connection with peer '[fe80::1]:4433'"));
        assert.equal(v6.tlsPeer, 'fe80::1');

        for (const text of [
            'iostream.c: SSL_shutdown() failed: error:00000001:lib(0)::reason(1), Internal SSL error',
            'iostream.c: Problem setting up ssl connection: error:00000001:lib(0)::reason(1), Internal SSL error',
        ]) {
            const r = classifyMessage(err(text));
            assert.equal(r.message.level, 'debug');
            assert.equal(r.tlsPeer, undefined);
        }

        // a closed or reloaded tab
        const ws = classifyMessage(err('res_http_websocket.c: Error reading from web socket: Connection reset by peer'));
        assert.equal(ws.message.level, 'debug');

        // the start of every WebRTC call
        const dtls = classifyMessage(
            err('res_rtp_asterisk.c: 1791704072.13: DTLS packet from 192.168.100.114:58998 dropped. ICE not completed yet.'),
        );
        assert.equal(dtls.message.level, 'debug');

        // everything else keeps its level
        const other = classifyMessage(err('chan_pjsip.c: Something broke'));
        assert.equal(other.message.level, 'error');
        assert.equal(other.tlsPeer, undefined);
    });

    it('does not warn about the spare connections of a browser, but about a client that retries endlessly', () => {
        const monitor = new TlsFailureMonitor(20, 10 * 60_000);
        const min = 60_000;
        // the pattern of a working page in Chrome: a few aborted handshakes when it (re)connects
        const bursts = [0, 0, 1000, 19 * min, 19 * min, 19 * min, 24 * min, 24 * min, 24 * min, 24 * min + 25000];
        for (const t of bursts) {
            assert.equal(monitor.record('192.168.1.6', t), false);
        }

        // a client that does not accept the certificate: JsSIP retries every few seconds
        let warnings = 0;
        for (let t = 0; t < 30 * min; t += 15000) {
            if (monitor.record('192.168.1.7', t)) {
                warnings++;
            }
        }
        // warned at the 20th failure (after ~5 minutes), then at most every 10 minutes
        assert.equal(warnings, 3);
    });

    describe('LogTail', () => {
        let dir;
        let file;
        beforeEach(() => {
            dir = mkdtempSync(join(tmpdir(), 'iob-asterisk-log-'));
            file = join(dir, 'iobroker.log');
        });
        afterEach(() => rmSync(dir, { recursive: true, force: true }));

        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

        it('skips the history, follows new lines and survives truncation', async () => {
            writeFileSync(file, '[2026-10-09 09:00:00.000] ERROR[1] old.c: from before the start\n');
            const got = [];
            const tail = new LogTail({ file, interval: 30, maxSize: 100000, onMessage: m => got.push(m) });
            tail.start();
            await wait(80);
            appendFileSync(file, '[2026-10-09 10:00:00.000] WARNING[1] a.c: one\n[2026-10-09 10:00:01.000] ERROR[1] b.c: tw');
            await wait(80);
            // the first message is complete, the second line not yet
            assert.deepEqual(
                got.map(m => m.text),
                ['a.c: one'],
            );
            appendFileSync(file, 'o\n');
            await wait(150);
            assert.deepEqual(
                got.map(m => [m.level, m.text]),
                [
                    ['warn', 'a.c: one'],
                    ['error', 'b.c: two'],
                ],
            );

            // rotated or truncated by somebody else: start from the beginning
            writeFileSync(file, '[2026-10-09 11:00:00.000] NOTICE[1] c.c: three\n');
            await wait(150);
            tail.stop();
            assert.deepEqual(got[2], { level: 'info', asteriskLevel: 'NOTICE', text: 'c.c: three' });
        });

        it('limits the number of messages per second, but never drops errors', async () => {
            writeFileSync(file, '');
            const got = [];
            let skipped = 0;
            const tail = new LogTail({
                file,
                interval: 30,
                maxPerSecond: 3,
                onMessage: m => got.push(m),
                onSkipped: n => (skipped += n),
            });
            tail.start();
            await wait(60);
            let text = '';
            for (let i = 0; i < 10; i++) {
                text += `[2026-10-09 10:00:00.000] VERBOSE[1] v.c: line ${i}\n`;
            }
            text += '[2026-10-09 10:00:00.000] ERROR[1] e.c: important\n';
            appendFileSync(file, text);
            await wait(1300);
            tail.stop();
            assert.equal(got.filter(m => m.level === 'debug').length, 3);
            assert.ok(got.some(m => m.text === 'e.c: important'));
            assert.equal(skipped, 7);
        });

        it('truncates the file when it gets too big', async () => {
            writeFileSync(file, '');
            const tail = new LogTail({ file, interval: 30, maxSize: 200, onMessage: () => {} });
            tail.start();
            await wait(60);
            appendFileSync(file, `[2026-10-09 10:00:00.000] NOTICE[1] x.c: ${'x'.repeat(300)}\n`);
            await wait(150);
            tail.stop();
            assert.equal(require('node:fs').statSync(file).size, 0);
        });
    });
});

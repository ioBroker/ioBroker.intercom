const assert = require('node:assert/strict');
const net = require('node:net');
const { AmiParser, AmiClient } = require('../../build/lib/ami');

const log = { debug() {}, info() {}, warn() {}, error() {} };

describe('AMI parser', () => {
    it('reads the banner and a response', () => {
        const parser = new AmiParser();
        const r = parser.feed(
            'Asterisk Call Manager/9.0.0\r\nResponse: Success\r\nActionID: 1\r\nMessage: Authentication accepted\r\n\r\n',
        );
        assert.equal(r.banner, 'Asterisk Call Manager/9.0.0');
        assert.deepEqual(r.messages, [{ Response: 'Success', ActionID: '1', Message: 'Authentication accepted' }]);
    });

    it('handles messages fragmented over several packets', () => {
        const parser = new AmiParser();
        const text =
            'Asterisk Call Manager/9.0.0\r\nEvent: DeviceStateChange\r\nDevice: PJSIP/101\r\nState: INUSE\r\n\r\nEvent: FullyBooted\r\nStatus: Fully Booted\r\n\r\n';
        const messages = [];
        let banner;
        // feed in chunks of 3 bytes, splitting the \r\n sequences as well
        for (let i = 0; i < text.length; i += 3) {
            const r = parser.feed(text.substring(i, i + 3));
            banner = banner || r.banner;
            messages.push(...r.messages);
        }
        assert.equal(banner, 'Asterisk Call Manager/9.0.0');
        assert.equal(messages.length, 2);
        assert.deepEqual(messages[0], { Event: 'DeviceStateChange', Device: 'PJSIP/101', State: 'INUSE' });
        assert.equal(messages[1].Event, 'FullyBooted');
    });

    it('handles several messages in one packet and values with colons', () => {
        const parser = new AmiParser();
        parser.feed('Asterisk Call Manager/9.0.0\r\n');
        const r = parser.feed(
            'Event: ContactStatus\r\nURI: sip:101@192.168.1.5:5060\r\nAOR: 101\r\nContactStatus: Reachable\r\n\r\nEvent: X\r\n\r\nEvent: Partial\r\n',
        );
        assert.equal(r.messages.length, 2);
        assert.equal(r.messages[0].URI, 'sip:101@192.168.1.5:5060');
        assert.deepEqual(parser.feed('\r\n').messages, [{ Event: 'Partial' }]);
    });

    it('joins repeated keys (command output)', () => {
        const msg = AmiParser.parseBlock(
            'Response: Success\r\nMessage: Command output follows\r\nOutput: line 1\r\nOutput: line 2',
        );
        assert.equal(msg.Output, 'line 1\nline 2');
    });

    it('serializes actions without allowing header injection', () => {
        const text = AmiParser.serialize({ Action: 'Command', Command: 'core show version\r\nAction: Logoff' });
        assert.equal(text, 'Action: Command\r\nCommand: core show version  Action: Logoff\r\n\r\n');
    });
});

describe('AMI client', () => {
    let server;
    let port;
    let received;

    before(done => {
        received = [];
        server = net.createServer(socket => {
            socket.write('Asterisk Call Manager/9.0.0\r\n');
            const parser = new AmiParser();
            parser.feed('banner\r\n');
            socket.on('data', data => {
                for (const msg of parser.feed(data.toString()).messages) {
                    received.push(msg);
                    const id = msg.ActionID;
                    if (msg.Action === 'Login') {
                        const ok = msg.Secret === 'secret';
                        socket.write(`Response: ${ok ? 'Success' : 'Error'}\r\nActionID: ${id}\r\nMessage: x\r\n\r\n`);
                    } else if (msg.Action === 'PJSIPShowContacts') {
                        socket.write(`Response: Success\r\nActionID: ${id}\r\nEventList: start\r\n\r\n`);
                        // an unsolicited event in between
                        socket.write('Event: DeviceStateChange\r\nDevice: PJSIP/101\r\nState: RINGING\r\n\r\n');
                        socket.write(
                            `Event: ContactList\r\nActionID: ${id}\r\nAor: 101\r\nUri: sip:a\r\nStatus: Reachable\r\n\r\n`,
                        );
                        socket.write(`Event: ContactListComplete\r\nActionID: ${id}\r\nEventList: Complete\r\n\r\n`);
                    } else if (msg.Action === 'Command') {
                        socket.write(
                            `Response: Success\r\nActionID: ${id}\r\nMessage: Command output follows\r\nOutput: Asterisk 20\r\n\r\n`,
                        );
                    } else if (msg.Action === 'Logoff') {
                        socket.end(`Response: Goodbye\r\nActionID: ${id}\r\n\r\n`);
                    }
                }
            });
        });
        server.listen(0, '127.0.0.1', () => {
            port = server.address().port;
            done();
        });
    });

    after(done => server.close(() => done()));

    it('logs in, runs list actions and commands and forwards events', async () => {
        const client = new AmiClient({ host: '127.0.0.1', port, username: 'iobroker', secret: 'secret', log });
        const events = [];
        client.on('event', ev => events.push(ev));
        const connected = new Promise(resolve => client.once('connected', resolve));
        client.start();
        await connected;
        assert.equal(client.connected, true);

        const list = await client.action({ Action: 'PJSIPShowContacts' });
        assert.equal(list.response.Response, 'Success');
        assert.equal(list.events.length, 1);
        assert.equal(list.events[0].Aor, '101');
        assert.deepEqual(
            events.map(e => e.Event),
            ['DeviceStateChange'],
        );

        assert.equal(await client.command('core show version'), 'Asterisk 20');
        await client.stop();
        assert.equal(client.connected, false);
        assert.equal(received.find(m => m.Action === 'Login').Events, 'on');
    });

    it('rejects actions when not connected', async () => {
        const client = new AmiClient({ host: '127.0.0.1', port: 1, username: 'x', secret: 'y', log });
        await assert.rejects(client.action({ Action: 'Ping' }));
    });
});

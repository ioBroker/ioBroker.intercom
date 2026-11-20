const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { callInfo, findCall, isValidDtmf, listCalls, parseDuration } = require('../../build/lib/calls');
const { AGENT_CONTEXT, generateConfig } = require('../../build/lib/configGenerator');
const { COMMANDS, getHelp } = require('../../build/lib/help');

const NAMES = { 100: 'Everybody', 101: 'Kitchen', 102: 'Office', 200: 'Front door', 600: 'Echo test' };

/** An event `CoreShowChannel` as Asterisk 20 sends it */
function channel(name, fields) {
    return {
        Event: 'CoreShowChannel',
        Channel: name,
        ChannelState: '6',
        ChannelStateDesc: 'Up',
        Context: 'iobroker',
        Exten: 's',
        Application: 'AppDial',
        Duration: '00:00:05',
        ...fields,
    };
}

const DOOR = 'PJSIP/200-00000010';

/** The door intercom calls the group 100, both members ring */
const RINGING = [
    channel(DOOR, {
        ChannelState: '4',
        ChannelStateDesc: 'Ring',
        CallerIDNum: '200',
        Exten: '100',
        Application: 'Dial',
        Uniqueid: '1795.10',
        Linkedid: '1795.10',
        Duration: '00:00:07',
    }),
    channel('PJSIP/101-00000011', { ChannelState: '5', ChannelStateDesc: 'Ringing', Uniqueid: '1795.11', Linkedid: '1795.10' }),
    channel('PJSIP/102-00000012', { ChannelState: '0', ChannelStateDesc: 'Down', Uniqueid: '1795.12', Linkedid: '1795.10' }),
];

/** The kitchen answered it */
const TALKING = [
    channel(DOOR, { CallerIDNum: '200', Exten: '100', Application: 'Dial', Uniqueid: '1795.10', Linkedid: '1795.10' }),
    channel('PJSIP/101-00000011', { Uniqueid: '1795.11', Linkedid: '1795.10', BridgeId: 'b1' }),
];

/** The office tests the echo */
const ECHO = [
    channel('PJSIP/102-00000020', { Exten: '600', Application: 'Echo', Uniqueid: '1795.20', Linkedid: '1795.20' }),
];

/** `call` from the kitchen to the door: the kitchen rings first */
const ORIGINATED = [
    channel('Local/101@iobroker-00000001;1', {
        ChannelState: '0',
        ChannelStateDesc: 'Down',
        CallerIDNum: '200',
        Application: '',
        Uniqueid: '1795.30',
        Linkedid: '1795.30',
    }),
    channel('Local/101@iobroker-00000001;2', {
        ChannelState: '4',
        ChannelStateDesc: 'Ring',
        CallerIDNum: '200',
        Exten: '101',
        Application: 'Dial',
        Uniqueid: '1795.31',
        Linkedid: '1795.30',
    }),
    channel('PJSIP/101-00000032', { ChannelState: '5', ChannelStateDesc: 'Ringing', Uniqueid: '1795.32', Linkedid: '1795.30' }),
];

describe('Calls', () => {
    it('reads the duration of a channel', () => {
        assert.equal(parseDuration('00:01:05'), 65);
        assert.equal(parseDuration('01:00:00'), 3600);
        assert.equal(parseDuration('42'), 42);
        assert.equal(parseDuration(''), 0);
        assert.equal(parseDuration(undefined), 0);
    });

    it('a call that rings a group', () => {
        const [call] = listCalls(RINGING, NAMES);
        assert.deepEqual(callInfo(call), {
            id: '1795.10',
            from: '200',
            fromName: 'Front door',
            to: '100',
            toName: 'Everybody',
            state: 'ringing',
            ringing: ['101', '102'],
            connected: [],
            seconds: 7,
        });
        assert.equal(call.callerChannel, DOOR);
        assert.deepEqual(call.channels, [DOOR, 'PJSIP/101-00000011', 'PJSIP/102-00000012']);
    });

    it('an answered call', () => {
        const [call] = listCalls(TALKING, NAMES);
        assert.equal(call.state, 'talking');
        assert.deepEqual(call.ringing, []);
        assert.deepEqual(call.connected, ['200', '101']);
        assert.equal(call.to, '100');
    });

    it('the echo test, and several calls at once', () => {
        const calls = listCalls([...RINGING, ...ECHO, { Event: 'CoreShowChannelsComplete' }], NAMES);
        assert.equal(calls.length, 2);
        assert.deepEqual(
            { from: calls[1].from, to: calls[1].to, toName: calls[1].toName, state: calls[1].state },
            { from: '102', to: '600', toName: 'Echo test', state: 'talking' },
        );
    });

    it('a call started with "call" has no caller to take over', () => {
        const [call] = listCalls(ORIGINATED, NAMES);
        assert.equal(call.from, '101');
        assert.equal(call.to, '200');
        assert.equal(call.state, 'ringing');
        assert.deepEqual(call.ringing, ['101']);
        assert.equal(call.callerChannel, '');
        assert.equal(call.channels.length, 3);
    });

    it('a call whose first channel is gone (Local channels optimized away)', () => {
        const [call] = listCalls(
            [
                channel('PJSIP/101-00000032', { Uniqueid: '1795.32', Linkedid: '1795.30', Duration: '00:00:20' }),
                channel('PJSIP/200-00000033', { Uniqueid: '1795.33', Linkedid: '1795.30', Duration: '00:00:12' }),
            ],
            NAMES,
        );
        assert.equal(call.from, '101');
        assert.equal(call.to, '200');
        assert.equal(call.state, 'talking');
        assert.equal(call.seconds, 20);
        assert.equal(call.callerChannel, '');
    });

    it('a call that Asterisk took over itself', () => {
        const [call] = listCalls(
            [
                channel(DOOR, {
                    Context: AGENT_CONTEXT,
                    Exten: 'answer',
                    Application: 'Wait',
                    Uniqueid: '1795.10',
                    Linkedid: '1795.10',
                }),
            ],
            NAMES,
        );
        assert.equal(call.from, '200');
        assert.equal(call.to, '');
        assert.equal(call.state, 'talking');
    });

    it('finds the call a message means', () => {
        const calls = listCalls([...RINGING, ...ECHO], NAMES);
        // answer without anything: the only ringing call
        assert.equal(findCall(calls, {}, true).call.id, '1795.10');
        // hangup without anything: two calls go on
        assert.match(findCall(calls, {}, false).error, /2 calls/);
        assert.equal(findCall(calls, { extension: '102' }, true).call.id, '1795.10');
        assert.equal(findCall(calls, { extension: 102 }, false).error, '2 calls: name one with "call" (its id from getCalls)');
        assert.equal(findCall(calls, { extension: '600' }, false).call.id, '1795.20');
        assert.equal(findCall(calls, { extension: '200' }, false).call.id, '1795.10');
        assert.equal(findCall(calls, { call: '1795.20' }, false).call.from, '102');
        assert.equal(findCall(calls, { call: '1795.20' }, true).error, 'No ringing call with the id 1795.20 (getCalls lists them)');
        assert.equal(findCall(calls, { extension: '999' }, false).error, 'No call of 999');
        assert.equal(findCall([], {}, true).error, 'No ringing call');
    });

    it('accepts only DTMF tones', () => {
        for (const dtmf of ['#', '1234', '*9#', '12w#', 'ABCD']) {
            assert.ok(isValidDtmf(dtmf), dtmf);
        }
        for (const dtmf of ['', '1,2', '1)Hangup', 'x', '1'.repeat(33)]) {
            assert.ok(!isValidDtmf(dtmf), dtmf);
        }
    });

    it('the dialplan lets the adapter take a call over, and AMI may start and move calls', () => {
        const passwords = { 101: 'password101' };
        const { files } = generateConfig(
            {
                amiPort: 5038,
                wssPort: 8089,
                rtpStart: 10000,
                rtpEnd: 20000,
                stunServer: '',
                externalAddress: '',
                iceDenylist: '',
                codecs: ['ulaw'],
                echoTest: true,
                testPage: false,
                subscribers: [{ extension: '101', name: 'Kitchen', kind: 'webrtc', enabled: true }],
            },
            { amiSecret: 'secret123', passwords, certPublic: '', certPrivate: '' },
        );
        const dialplan = files['extensions.conf'];
        assert.match(dialplan, new RegExp(`^\\[${AGENT_CONTEXT}\\]$`, 'm'));
        assert.match(dialplan, /^exten => answer,1,Answer\(\)$/m);
        assert.match(dialplan, /SendDTMF\(\$\{IOB_DTMF\}\)/);
        assert.match(dialplan, /Wait\(\$\{IOB_HANGUP\}\)/);
        // no device can dial into it: the subscribers are in the context iobroker
        assert.doesNotMatch(files['pjsip.conf'], new RegExp(`context=${AGENT_CONTEXT}`));
        assert.match(files['manager.conf'], /^write=.*\bcall\b.*\boriginate\b/m);
    });
});

describe('help for AI agents', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8');
    const ioPackage = JSON.parse(readFileSync(join(__dirname, '..', '..', 'io-package.json'), 'utf8'));

    it('is declared in io-package.json', () => {
        assert.equal(ioPackage.common.supportedMessages.help, true);
    });

    it('lists exactly the commands onMessage answers', () => {
        const handled = [...main.matchAll(/^ {12}case '([A-Za-z]+)':/gm)].map(match => match[1]).sort();
        assert.deepEqual(COMMANDS.map(c => c.command).sort(), handled);
    });

    it('describes every command an agent may use, with the instance', () => {
        const help = getHelp('intercom.1');
        assert.match(help, /sendTo intercom\.1/);
        for (const command of ['getSubscribers', 'getCalls', 'call', 'answer', 'transfer', 'hangup', 'decline']) {
            assert.match(help, new RegExp(`^- ${command}[ :]`, 'm'), command);
        }
        assert.ok(help.length < 20000, 'pi-agent cuts a help after 20000 characters');
        for (const command of ['call', 'answer', 'transfer', 'hangup', 'decline']) {
            assert.equal(COMMANDS.find(c => c.command === command).write, true, command);
        }
    });
});

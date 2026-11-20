"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDuration = parseDuration;
exports.listCalls = listCalls;
exports.callInfo = callInfo;
exports.findCall = findCall;
exports.isValidDtmf = isValidDtmf;
const configGenerator_1 = require("./configGenerator");
const DEVICE = /^PJSIP\/([0-9]{2,6})-/i;
const LOCAL = /^Local\/([0-9]{2,6})@/i;
const NUMBER = /^[0-9]{2,6}$/;
/** Duration of a channel: `HH:MM:SS` (Asterisk 20) or seconds */
function parseDuration(value) {
    const text = String(value ?? '').trim();
    if (/^\d+$/.test(text)) {
        return Number(text);
    }
    const parts = text.split(':').map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
        return 0;
    }
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}
function isUp(channel) {
    return channel.ChannelState === '6' || channel.ChannelStateDesc === 'Up';
}
function extensionOf(channel) {
    return DEVICE.exec(String(channel.Channel || ''))?.[1] || '';
}
function unique(list) {
    return [...new Set(list.filter(Boolean))];
}
/**
 * The calls of the channels
 *
 * @param channels events `CoreShowChannel`
 * @param names names of the subscribers, groups and of the echo test by number
 */
function listCalls(channels, names) {
    const byCall = new Map();
    for (const channel of channels) {
        if (!channel.Channel) {
            continue;
        }
        const id = channel.Linkedid || channel.Uniqueid || channel.Channel;
        const list = byCall.get(id);
        if (list) {
            list.push(channel);
        }
        else {
            byCall.set(id, [channel]);
        }
    }
    const calls = [];
    for (const [id, list] of byCall) {
        // the channel that started the call; gone when Asterisk optimized the Local channels of `call` away
        const root = list.find(c => c.Uniqueid === id);
        const devices = list.filter(c => DEVICE.test(c.Channel));
        const ringing = unique(devices.filter(c => c !== root && !isUp(c)).map(extensionOf));
        const connected = unique(devices.filter(isUp).map(extensionOf));
        let from = '';
        let to = '';
        let callerChannel = '';
        const local = root && LOCAL.exec(root.Channel);
        if (local) {
            // started with `call`: `from` rings first, the caller ID shown there names the number it gets
            from = local[1];
            to = NUMBER.test(String(root.CallerIDNum || '')) ? root.CallerIDNum : '';
        }
        else if (root && DEVICE.test(root.Channel)) {
            from = extensionOf(root);
            callerChannel = root.Channel;
            // in another context Asterisk took the call itself (`answer`)
            to = root.Context === configGenerator_1.CONTEXT && NUMBER.test(String(root.Exten || '')) ? root.Exten : '';
        }
        else {
            from = connected[0] || ringing[0] || '';
        }
        if (!to) {
            to = [...ringing, ...connected].find(ext => ext !== from) || '';
        }
        calls.push({
            id,
            from,
            fromName: names[from] || '',
            to,
            toName: names[to] || '',
            state: ringing.length || !connected.length ? 'ringing' : 'talking',
            ringing,
            connected,
            seconds: root ? parseDuration(root.Duration) : Math.max(0, ...list.map(c => parseDuration(c.Duration))),
            callerChannel,
            channels: list.map(c => c.Channel),
        });
    }
    return calls;
}
/** What `getCalls` answers: without the lines */
function callInfo(call) {
    const { callerChannel: _caller, channels: _channels, ...info } = call;
    return info;
}
/**
 * The call a message means: by `call` (its id), by `extension` (a subscriber or group in it), or the only one
 *
 * @param calls the calls going on
 * @param query `call` and/or `extension` of the message
 * @param query.call the id of the call (getCalls)
 * @param query.extension a subscriber or group in the call
 * @param ringingOnly only calls that ring (`answer`)
 */
function findCall(calls, query, ringingOnly) {
    const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    const id = text(query.call);
    const extension = text(query.extension);
    let found = ringingOnly ? calls.filter(c => c.state === 'ringing') : calls;
    if (id) {
        found = found.filter(c => c.id === id);
    }
    if (extension) {
        found = found.filter(c => c.from === extension ||
            c.to === extension ||
            c.ringing.includes(extension) ||
            c.connected.includes(extension));
    }
    const kind = ringingOnly ? 'ringing call' : 'call';
    if (!found.length) {
        if (id) {
            return { error: `No ${kind} with the id ${id} (getCalls lists them)` };
        }
        return { error: extension ? `No ${kind} of ${extension}` : `No ${kind}` };
    }
    if (found.length > 1) {
        return { error: `${found.length} ${kind}s: name one with "call" (its id from getCalls)` };
    }
    return { call: found[0] };
}
/** DTMF for `answer`: digits, `*`, `#`, A-D and `w` (half a second pause) */
function isValidDtmf(dtmf) {
    return /^[0-9*#A-Dw]{1,32}$/.test(dtmf);
}
//# sourceMappingURL=calls.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactTracker = void 0;
exports.mapDeviceState = mapDeviceState;
exports.extensionOfDevice = extensionOfDevice;
exports.ringingChannels = ringingChannels;
exports.describeSubscriber = describeSubscriber;
/**
 * Map an Asterisk device state - the constant of `DeviceStateChange` (`NOT_INUSE`) as well as the
 * text of `PJSIPShowEndpoints` (`Not in use`) - to the state of the subscriber.
 */
function mapDeviceState(state) {
    const s = String(state || '')
        .toUpperCase()
        .replace(/\s+/g, '_');
    switch (s) {
        case 'NOT_INUSE':
        case 'NOT_IN_USE':
            return 'idle';
        case 'RINGING':
        case 'RINGINUSE':
        case 'RING_IN_USE':
            return 'ringing';
        case 'INUSE':
        case 'IN_USE':
        case 'BUSY':
        case 'ONHOLD':
        case 'ON_HOLD':
            return 'inuse';
        default:
            return 'unavailable';
    }
}
/** Extension of a device name like `PJSIP/101`, or null for other technologies */
function extensionOfDevice(device) {
    const m = /^PJSIP\/([0-9]{2,6})$/i.exec(String(device || ''));
    return m ? m[1] : null;
}
/**
 * The lines that still ring a subscriber, from the events of `CoreShowChannels`. `Dial` calls every registered
 * device of the subscriber on an outgoing line of its own (application `AppDial`); answered ones are `Up`.
 *
 * @param channels events `CoreShowChannel`
 * @param extension the subscriber
 */
function ringingChannels(channels, extension) {
    const prefix = `PJSIP/${extension}-`;
    return channels
        .filter(c => String(c.Channel || '').startsWith(prefix) &&
        c.Application === 'AppDial' &&
        c.ChannelState !== '6' &&
        c.ChannelStateDesc !== 'Up')
        .map(c => c.Channel);
}
/** Keeps the contacts of all AORs, fed by `PJSIPShowContacts` and the `ContactStatus` events */
class ContactTracker {
    #aors = new Map();
    clear() {
        this.#aors.clear();
    }
    /**
     * Replace everything by the events of `PJSIPShowContacts` (`ContactList`)
     *
     * @param events events of the list action
     */
    setFromList(events) {
        this.#aors.clear();
        for (const ev of events) {
            if (ev.Event !== 'ContactList') {
                continue;
            }
            const aor = ev.Aor || ev.AOR || (ev.ObjectName || '').split(';@')[0];
            const uri = ev.Uri || ev.URI || ev.ObjectName || '';
            if (!aor || !uri) {
                continue;
            }
            this.#set(aor, uri, { status: ev.Status || 'Unknown', userAgent: ev.UserAgent || '' });
        }
    }
    /**
     * Apply a `ContactStatus` event
     *
     * @param ev the event
     * @returns the affected AOR or null
     */
    applyContactStatus(ev) {
        const aor = ev.AOR || ev.Aor;
        const uri = ev.URI || ev.Uri;
        if (!aor || !uri) {
            return null;
        }
        const status = ev.ContactStatus || 'Unknown';
        if (status === 'Removed') {
            this.#aors.get(aor)?.delete(uri);
        }
        else {
            const old = this.#aors.get(aor)?.get(uri);
            this.#set(aor, uri, {
                // "Updated" and "Created" do not tell anything about the reachability
                status: status === 'Updated' && old ? old.status : status,
                userAgent: ev.UserAgent || old?.userAgent || '',
            });
        }
        return aor;
    }
    summary(aor) {
        const contacts = [...(this.#aors.get(aor)?.values() || [])];
        const reachable = contacts.filter(c => c.status !== 'Unreachable');
        return {
            registered: reachable.length > 0,
            contacts: contacts.length,
            userAgent: (reachable[0] || contacts[0])?.userAgent || '',
        };
    }
    #set(aor, uri, info) {
        let contacts = this.#aors.get(aor);
        if (!contacts) {
            contacts = new Map();
            this.#aors.set(aor, contacts);
        }
        contacts.set(uri, info);
    }
}
exports.ContactTracker = ContactTracker;
const STATUS_WORDS = {
    en: {
        connected: 'connected',
        disconnected: 'not connected',
        unknown: 'not saved yet',
        idle: '',
        ringing: 'ringing',
        inuse: 'in a call',
        unavailable: '',
    },
    de: {
        connected: 'verbunden',
        disconnected: 'nicht verbunden',
        unknown: 'noch nicht gespeichert',
        idle: '',
        ringing: 'klingelt',
        inuse: 'im Gespräch',
        unavailable: '',
    },
};
/**
 * The status of a subscriber as one line: "connected (2) · ringing · DoorBird D2101V"
 *
 * @param summary contacts of the subscriber, null if the adapter does not know it (new row, disabled)
 * @param state device state from Asterisk
 * @param language of the system
 */
function describeSubscriber(summary, state, language) {
    const words = STATUS_WORDS[language === 'de' ? 'de' : 'en'];
    if (!summary) {
        return { text: words.unknown, style: { color: 'grey' }, icon: 'no-connection' };
    }
    if (!summary.registered) {
        return { text: words.disconnected, style: { color: '#d32f2f' }, icon: 'no-connection' };
    }
    const parts = [summary.contacts > 1 ? `${words.connected} (${summary.contacts})` : words.connected];
    if (state && words[state]) {
        parts.push(words[state]);
    }
    if (summary.userAgent) {
        parts.push(summary.userAgent.length > 40 ? `${summary.userAgent.substring(0, 39)}…` : summary.userAgent);
    }
    return { text: parts.join(' · '), style: { color: '#2e7d32' }, icon: 'connection' };
}
//# sourceMappingURL=subscriberStatus.js.map
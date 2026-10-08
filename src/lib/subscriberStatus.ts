import type { AmiMessage } from './ami';

export type SubscriberState = 'idle' | 'ringing' | 'inuse' | 'unavailable';

export interface SubscriberSummary {
    registered: boolean;
    contacts: number;
    userAgent: string;
}

interface ContactInfo {
    status: string;
    userAgent: string;
}

/**
 * Map an Asterisk device state - the constant of `DeviceStateChange` (`NOT_INUSE`) as well as the
 * text of `PJSIPShowEndpoints` (`Not in use`) - to the state of the subscriber.
 */
export function mapDeviceState(state: string): SubscriberState {
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
export function extensionOfDevice(device: string): string | null {
    const m = /^PJSIP\/([0-9]{2,6})$/i.exec(String(device || ''));
    return m ? m[1] : null;
}

/** Keeps the contacts of all AORs, fed by `PJSIPShowContacts` and the `ContactStatus` events */
export class ContactTracker {
    readonly #aors = new Map<string, Map<string, ContactInfo>>();

    clear(): void {
        this.#aors.clear();
    }

    /**
     * Replace everything by the events of `PJSIPShowContacts` (`ContactList`)
     *
     * @param events events of the list action
     */
    setFromList(events: AmiMessage[]): void {
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
    applyContactStatus(ev: AmiMessage): string | null {
        const aor = ev.AOR || ev.Aor;
        const uri = ev.URI || ev.Uri;
        if (!aor || !uri) {
            return null;
        }
        const status = ev.ContactStatus || 'Unknown';
        if (status === 'Removed') {
            this.#aors.get(aor)?.delete(uri);
        } else {
            const old = this.#aors.get(aor)?.get(uri);
            this.#set(aor, uri, {
                // "Updated" and "Created" do not tell anything about the reachability
                status: status === 'Updated' && old ? old.status : status,
                userAgent: ev.UserAgent || old?.userAgent || '',
            });
        }
        return aor;
    }

    summary(aor: string): SubscriberSummary {
        const contacts = [...(this.#aors.get(aor)?.values() || [])];
        const reachable = contacts.filter(c => c.status !== 'Unreachable');
        return {
            registered: reachable.length > 0,
            contacts: contacts.length,
            userAgent: (reachable[0] || contacts[0])?.userAgent || '',
        };
    }

    #set(aor: string, uri: string, info: ContactInfo): void {
        let contacts = this.#aors.get(aor);
        if (!contacts) {
            contacts = new Map();
            this.#aors.set(aor, contacts);
        }
        contacts.set(uri, info);
    }
}

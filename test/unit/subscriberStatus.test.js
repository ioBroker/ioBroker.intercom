const assert = require('node:assert/strict');
const { ContactTracker, mapDeviceState, extensionOfDevice } = require('../../build/lib/subscriberStatus');

describe('subscriber status', () => {
    it('maps device states', () => {
        assert.equal(mapDeviceState('NOT_INUSE'), 'idle');
        assert.equal(mapDeviceState('Not in use'), 'idle');
        assert.equal(mapDeviceState('RINGING'), 'ringing');
        assert.equal(mapDeviceState('RINGINUSE'), 'ringing');
        assert.equal(mapDeviceState('INUSE'), 'inuse');
        assert.equal(mapDeviceState('In use'), 'inuse');
        assert.equal(mapDeviceState('ONHOLD'), 'inuse');
        assert.equal(mapDeviceState('UNAVAILABLE'), 'unavailable');
        assert.equal(mapDeviceState('INVALID'), 'unavailable');
        assert.equal(mapDeviceState(''), 'unavailable');
    });

    it('extracts the extension of PJSIP devices only', () => {
        assert.equal(extensionOfDevice('PJSIP/101'), '101');
        assert.equal(extensionOfDevice('SIP/101'), null);
        assert.equal(extensionOfDevice('PJSIP/abc'), null);
    });

    it('tracks contacts from the list and from events', () => {
        const t = new ContactTracker();
        t.setFromList([
            { Event: 'ContactList', Aor: '101', Uri: 'sip:a', Status: 'Reachable', UserAgent: 'JsSIP 3.13.8' },
            { Event: 'ContactList', Aor: '101', Uri: 'sip:b', Status: 'Unreachable', UserAgent: 'Phone' },
        ]);
        assert.deepEqual(t.summary('101'), { registered: true, contacts: 2, userAgent: 'JsSIP 3.13.8' });
        assert.deepEqual(t.summary('102'), { registered: false, contacts: 0, userAgent: '' });

        assert.equal(t.applyContactStatus({ AOR: '101', URI: 'sip:a', ContactStatus: 'Removed' }), '101');
        assert.deepEqual(t.summary('101'), { registered: false, contacts: 1, userAgent: 'Phone' });

        t.applyContactStatus({ AOR: '101', URI: 'sip:b', ContactStatus: 'Reachable' });
        assert.equal(t.summary('101').registered, true);

        t.applyContactStatus({ AOR: '102', URI: 'sip:c', ContactStatus: 'Created', UserAgent: 'X' });
        t.applyContactStatus({ AOR: '102', URI: 'sip:c', ContactStatus: 'Updated' });
        assert.deepEqual(t.summary('102'), { registered: true, contacts: 1, userAgent: 'X' });

        assert.equal(t.applyContactStatus({ ContactStatus: 'Reachable' }), null);
    });
});

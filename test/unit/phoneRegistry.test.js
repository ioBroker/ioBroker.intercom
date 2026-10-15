const assert = require('node:assert/strict');

// Plain TypeScript without imports at runtime: Node.js >= 22.18 strips the types itself
const { PhoneRegistry, phoneKey } = require('../../src-shared/src/phoneRegistry.ts');

const CONFIG = { wssUrl: 'wss://pbx:8089/ws', extension: '100', password: 'secret', video: true, camera: false };

/** The part of SipPhone the registry uses */
class FakePhone {
    constructor(config) {
        this.config = config;
        this.listeners = new Set();
        this.snapshot = { call: 'none' };
        this.destroyed = false;
        this.unlocked = 0;
    }

    subscribe = listener => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = () => this.snapshot;

    unlockAudio() {
        this.unlocked++;
    }

    destroy() {
        this.destroyed = true;
    }

    setCall(call) {
        this.snapshot = { call };
        this.listeners.forEach(listener => listener());
    }
}

function createRegistry(graceMs = 0) {
    const created = [];
    const registry = new PhoneRegistry(
        config => {
            const phone = new FakePhone(config);
            created.push(phone);
            return phone;
        },
        { graceMs },
    );
    return { registry, created };
}

const WIDGET = { service: false, popup: true };
const SERVICE = { service: true, popup: true };

const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

describe('phone registry', () => {
    it('gives the same settings the same phone', () => {
        const { registry, created } = createRegistry();
        const a = registry.acquire(CONFIG, WIDGET);
        const b = registry.acquire({ ...CONFIG }, SERVICE);
        const c = registry.acquire({ ...CONFIG, extension: '101' }, WIDGET);
        assert.equal(a.phone, b.phone);
        assert.notEqual(a.phone, c.phone);
        assert.equal(created.length, 2);
        assert.equal(registry.size, 2);
        assert.notEqual(phoneKey(CONFIG), phoneKey({ ...CONFIG, video: false }));
    });

    it('destroys a phone after the grace time of the last release only', async () => {
        const { registry, created } = createRegistry(20);
        const widget = registry.acquire(CONFIG, WIDGET);
        const service = registry.acquire(CONFIG, SERVICE);
        widget.release();
        widget.release();
        await tick(30);
        assert.equal(created[0].destroyed, false, 'the service still holds it');

        service.release();
        await tick(5);
        assert.equal(created[0].destroyed, false, 'within the grace time');
        // a remounted widget gets the same phone back
        const again = registry.acquire(CONFIG, WIDGET);
        assert.equal(again.phone, created[0]);
        await tick(30);
        assert.equal(created[0].destroyed, false);

        again.release();
        await tick(30);
        assert.equal(created[0].destroyed, true);
        assert.equal(registry.size, 0);
        assert.notEqual(registry.acquire(CONFIG, WIDGET).phone, created[0]);
    });

    it('lets the service show the dialog, otherwise the first holder', () => {
        const { registry } = createRegistry();
        const first = registry.acquire(CONFIG, WIDGET);
        const second = registry.acquire(CONFIG, WIDGET);
        assert.equal(first.getDialog().owner, first.id);

        const service = registry.acquire(CONFIG, SERVICE);
        const otherService = registry.acquire(CONFIG, SERVICE);
        assert.equal(first.getDialog().owner, service.id);

        service.release();
        assert.equal(second.getDialog().owner, otherService.id);
        otherService.release();
        assert.equal(second.getDialog().owner, first.id);
        first.release();
        assert.equal(second.getDialog().owner, second.id);
    });

    it('opens the dialog for calls and keeps a minimized call minimized until the next one', () => {
        const { registry, created } = createRegistry();
        const handle = registry.acquire(CONFIG, WIDGET);
        const phone = created[0];
        let notified = 0;
        handle.subscribeDialog(() => notified++);

        assert.equal(handle.getDialog().open, false);
        phone.setCall('incoming');
        assert.equal(handle.getDialog().open, true);
        phone.setCall('incall');
        assert.equal(handle.getDialog().open, true);

        handle.closeDialog();
        assert.equal(handle.getDialog().open, false);
        phone.setCall('none');
        assert.equal(handle.getDialog().open, false);

        phone.setCall('calling');
        assert.equal(handle.getDialog().open, true, 'the next call opens it again');
        phone.setCall('none');
        assert.equal(handle.getDialog().open, false);
        assert.equal(notified, 4);
    });

    it('opens the dialog by hand and without popup only by hand', () => {
        const { registry, created } = createRegistry();
        const handle = registry.acquire(CONFIG, { service: false, popup: false });
        created[0].setCall('incoming');
        assert.equal(handle.getDialog().open, false);

        handle.showDialog();
        assert.equal(handle.getDialog().open, true);
        created[0].setCall('none');
        assert.equal(handle.getDialog().open, true, 'opened by hand: stays open after the call');
        handle.closeDialog();
        assert.equal(handle.getDialog().open, false);

        // one holder that wants the popup is enough
        registry.acquire(CONFIG, WIDGET);
        created[0].setCall('incoming');
        assert.equal(handle.getDialog().open, true);
    });

    it('keeps the dialog state stable for useSyncExternalStore', () => {
        const { registry } = createRegistry();
        const handle = registry.acquire(CONFIG, WIDGET);
        assert.equal(handle.getDialog(), handle.getDialog());
    });

    it('unlocks the audio of all phones', () => {
        const { registry, created } = createRegistry();
        registry.acquire(CONFIG, WIDGET);
        registry.acquire({ ...CONFIG, extension: '101' }, WIDGET);
        registry.unlockAudio();
        assert.deepEqual(
            created.map(phone => phone.unlocked),
            [1, 1],
        );
    });
});

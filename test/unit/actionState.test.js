const assert = require('node:assert/strict');

// Plain TypeScript without imports at runtime: Node.js >= 22.18 strips the types itself
const { createActionStates, resetSeconds } = require('../../src-shared/src/actionState.ts');

function createTimers() {
    const timers = {
        pending: new Set(),
        setTimeout: (handler, ms) => {
            const timer = { handler, ms };
            timers.pending.add(timer);
            return timer;
        },
        clearTimeout: timer => timers.pending.delete(timer),
        /** Runs all timers that are due now */
        fire: () => {
            const due = [...timers.pending];
            timers.pending.clear();
            due.forEach(timer => timer.handler());
        },
    };
    return timers;
}

function createHost() {
    const writes = [];
    return { writes, setState: (id, value) => writes.push(`${id}=${value}`) };
}

describe('State of the action button', () => {
    it('reads the reset time as vis-2 and the devices app deliver it', () => {
        assert.equal(resetSeconds(undefined), 0);
        assert.equal(resetSeconds(''), 0);
        assert.equal(resetSeconds(0), 0);
        assert.equal(resetSeconds('0'), 0);
        assert.equal(resetSeconds(-3), 0);
        assert.equal(resetSeconds('abc'), 0);
        assert.equal(resetSeconds(3), 3);
        assert.equal(resetSeconds('2'), 2);
        assert.equal(resetSeconds('1.5'), 1.5);
        assert.equal(resetSeconds('1,5'), 1.5);
    });

    it('stays true without a reset time', () => {
        const timers = createTimers();
        const host = createHost();
        createActionStates(timers).press(host, 'door.open', 0);
        assert.deepEqual(host.writes, ['door.open=true']);
        assert.equal(timers.pending.size, 0);
    });

    it('goes back to false after the reset time', () => {
        const timers = createTimers();
        const host = createHost();
        createActionStates(timers).press(host, 'door.open', 2.5);
        assert.deepEqual(host.writes, ['door.open=true']);
        assert.equal([...timers.pending][0].ms, 2500);
        timers.fire();
        assert.deepEqual(host.writes, ['door.open=true', 'door.open=false']);
    });

    it('a second press starts the time anew', () => {
        const timers = createTimers();
        const host = createHost();
        const states = createActionStates(timers);
        states.press(host, 'door.open', 3);
        const first = [...timers.pending][0];
        states.press(host, 'door.open', 3);
        // the first time was cancelled: only one reset, at the end of the second one
        assert.equal(timers.pending.size, 1);
        assert.ok(!timers.pending.has(first));
        first.handler();
        assert.deepEqual(host.writes, ['door.open=true', 'door.open=true']);
        timers.fire();
        assert.deepEqual(host.writes, ['door.open=true', 'door.open=true', 'door.open=false']);
    });

    it('a press without a reset time cancels the pending reset', () => {
        const timers = createTimers();
        const host = createHost();
        const states = createActionStates(timers);
        states.press(host, 'light', 3);
        states.press(host, 'light', 0);
        assert.equal(timers.pending.size, 0);
        assert.deepEqual(host.writes, ['light=true', 'light=true']);
    });

    it('keeps the times of different states apart', () => {
        const timers = createTimers();
        const host = createHost();
        const states = createActionStates(timers);
        states.press(host, 'door.open', 1);
        states.press(host, 'gate.open', 5);
        assert.equal(timers.pending.size, 2);
        timers.fire();
        assert.deepEqual(host.writes, ['door.open=true', 'gate.open=true', 'door.open=false', 'gate.open=false']);
    });

    it('survives a host that cannot write', async () => {
        const timers = createTimers();
        const states = createActionStates(timers);
        const throwing = {
            setState: () => {
                throw new Error('not connected');
            },
        };
        const rejecting = { setState: () => Promise.reject(new Error('permissionError')) };
        states.press(throwing, 'a', 1);
        states.press(rejecting, 'b', 1);
        timers.fire();
        // a rejection would end the test run (mocha.setup.js)
        await new Promise(resolve => setImmediate(resolve));
    });
});

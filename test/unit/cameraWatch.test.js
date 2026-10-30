const assert = require('node:assert/strict');

// Plain TypeScript without imports at runtime: Node.js >= 22.18 strips the types itself
const { createCameraWatcher, watchStateOf } = require('../../src-shared/src/cameraWatch.ts');

function createEnvironment() {
    const env = {
        viewer: 'v1',
        visible: true,
        timers: new Set(),
        visibilityHandlers: [],
        isVisible: () => env.visible,
        onVisibilityChange: handler => env.visibilityHandlers.push(handler),
        setInterval: handler => {
            const timer = { handler };
            env.timers.add(timer);
            return timer;
        },
        clearInterval: timer => env.timers.delete(timer),
        tick: () => env.timers.forEach(timer => timer.handler()),
        setVisible: visible => {
            env.visible = visible;
            env.visibilityHandlers.forEach(handler => handler());
        },
    };
    return env;
}

function createHost() {
    const writes = [];
    return { writes, setState: (id, value) => writes.push(`${id}=${value}`) };
}

describe('Camera watch', () => {
    it('finds the watch state of a picture of the snapshot proxy', () => {
        assert.equal(watchStateOf('intercom.0.cameras.door.image'), 'intercom.0.cameras.door.watch');
        assert.equal(watchStateOf(' intercom.1.cameras.a_b.image '), 'intercom.1.cameras.a_b.watch');
        assert.equal(watchStateOf('cameras.0.door.image'), '');
        assert.equal(watchStateOf('intercom.0.cameras.door.error'), '');
        assert.equal(watchStateOf(''), '');
        assert.equal(watchStateOf(undefined), '');
    });

    it('shares one lease between the widgets of a page and renews it', () => {
        const env = createEnvironment();
        const host = createHost();
        const watcher = createCameraWatcher(env);
        const id = 'intercom.0.cameras.door.watch';

        const release1 = watcher.acquire(host, id);
        const release2 = watcher.acquire(host, id);
        assert.deepEqual(host.writes, [`${id}=v1`]);
        assert.equal(env.timers.size, 1);

        env.tick();
        assert.deepEqual(host.writes, [`${id}=v1`, `${id}=v1`]);

        // the first widget goes, the second one still shows the picture
        release1();
        release1();
        assert.equal(host.writes.length, 2);
        release2();
        assert.deepEqual(host.writes.slice(2), [`${id}=-v1`]);
        assert.equal(env.timers.size, 0);
    });

    it('stops while the page is hidden', () => {
        const env = createEnvironment();
        const host = createHost();
        const watcher = createCameraWatcher(env);
        const id = 'intercom.0.cameras.door.watch';

        const release = watcher.acquire(host, id);
        env.setVisible(false);
        env.tick();
        assert.deepEqual(host.writes, [`${id}=v1`, `${id}=-v1`]);
        env.setVisible(true);
        assert.deepEqual(host.writes.slice(2), [`${id}=v1`]);
        release();

        // shown first while hidden: the lease starts when the page is visible
        env.setVisible(false);
        host.writes.length = 0;
        watcher.acquire(host, id);
        assert.deepEqual(host.writes, []);
        env.setVisible(true);
        assert.deepEqual(host.writes, [`${id}=v1`]);
    });

    it('survives a failing socket', () => {
        const env = createEnvironment();
        const watcher = createCameraWatcher(env);
        const failing = {
            setState: () => {
                throw new Error('not connected');
            },
        };
        const rejecting = { setState: () => Promise.reject(new Error('permissionError')) };
        watcher.acquire(failing, 'intercom.0.cameras.a.watch')();
        watcher.acquire(rejecting, 'intercom.0.cameras.b.watch')();
    });
});

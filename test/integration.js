const path = require('node:path');
const { tests } = require('@iobroker/testing');

// The adapter must start without Asterisk and without Docker, and without errors
tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],
    defineAdditionalTests({ suite }) {
        suite('Start without Asterisk', getHarness => {
            it('runs and writes the configuration', async function () {
                this.timeout(60000);
                const harness = getHarness();
                await harness.changeAdapterConfig('intercom', {
                    native: { dockerEnabled: false, amiPort: 15038 },
                });
                await harness.startAdapterAndWait();
                await new Promise(resolve => setTimeout(resolve, 8000));
                if (!harness.isAdapterRunning()) {
                    throw new Error('Adapter is not running');
                }
                const connection = await harness.states.getStateAsync('intercom.0.info.connection');
                if (connection && connection.val !== false) {
                    throw new Error('info.connection must be false without Asterisk');
                }
            });
        });
    },
});

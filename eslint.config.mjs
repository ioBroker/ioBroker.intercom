// ioBroker eslint template configuration file for js and ts files
import config, { reactConfig } from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: ['test/**/*', '*.config.mjs', 'build/**/*', 'admin/**/*', 'tmp/**/*'],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
    // the phone of the test page (React + MUI), runs in the browser
    ...reactConfig.map(c => ({ ...c, files: ['src-www/**/*.{ts,tsx}'] })),
];

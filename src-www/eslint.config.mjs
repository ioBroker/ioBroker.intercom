// ioBroker eslint template configuration file for the React phone (resolved from the root node_modules)
import config, { reactConfig } from '@iobroker/eslint-config';

export default [
    ...config,
    ...reactConfig,
    {
        // specify files to exclude from linting here
        ignores: ['build/', 'node_modules/', '*.config.mjs'],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
];

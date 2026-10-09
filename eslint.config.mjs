// ioBroker eslint template configuration file for js and ts files
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here. src-www has its own configuration
        ignores: ['test/**/*', '*.config.mjs', 'build/**/*', 'admin/**/*', 'tmp/**/*', 'src-www/**/*', 'tasks.mts'],
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
];

import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import { federation } from '@module-federation/vite';
import { moduleFederationShared } from '@iobroker/types-vis-2/modulefederation.vis.config';
import { readFileSync } from 'node:fs';
const pack = JSON.parse(readFileSync('./package.json').toString());

const config = {
    plugins: [
        federation({
            manifest: true,
            // must be equal to the key in common.visWidgets of io-package.json
            name: 'vis2IntercomWidgets',
            filename: 'customWidgets.js',
            exposes: {
                './Phone': './src/PhoneWidget',
                // background service, see common.visWidgets.<set>.services in io-package.json
                './PhoneService': './src/PhoneService',
                './translations': './src/translations',
            },
            remotes: {},
            shared: moduleFederationShared(pack),
            dts: false,
        }),
        react(),
        commonjs(),
    ],
    server: {
        port: 3000,
        proxy: {
            '/_socket': 'http://localhost:8082',
            '/vis.0': 'http://localhost:8082',
            '/adapter': 'http://localhost:8082',
            '/vis': 'http://localhost:8082',
            '/widgets': 'http://localhost:8082/vis',
            '/widgets.html': 'http://localhost:8082/vis',
            '/web': 'http://localhost:8082',
            '/state': 'http://localhost:8082',
        },
        fs: {
            // the phone lives in ../src-shared and ../src-www
            allow: ['..'],
        },
    },
    base: './',
    resolve: {
        tsconfigPaths: true,
        // The phone core (../src-www/src/SipPhone.ts) is shared with the test page, the phone itself
        // (../src-shared) with the plugin of the devices app. Their packages come from here, not from a folder
        // next to them.
        dedupe: [
            'react',
            'react-dom',
            '@emotion/react',
            '@emotion/styled',
            '@mui/material',
            '@mui/system',
            '@mui/icons-material',
            '@iobroker/gui-components',
        ],
    },
    build: {
        target: 'chrome89',
        outDir: './build',
        rollupOptions: {
            onwarn(warning: { code: string }, warn: (warning: { code: string }) => void): void {
                // Suppress "Module level directives cause errors when bundled" warnings
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
                    return;
                }
                warn(warning);
            },
        },
    },
};

export default config;

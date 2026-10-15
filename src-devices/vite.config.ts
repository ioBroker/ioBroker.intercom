/**
 * The plugin of the devices app: the phone tile and the background service, built into ../admin/dm-widgets.
 *
 * The phone itself is not in this project: it lives in ../src-shared (shared with the vis-2 widget set) and its
 * core in ../src-www (shared with the test page of Asterisk).
 *
 * `shared` is empty on purpose: the devices app shares nothing through Module Federation, it hands its React, MUI
 * and gui-components out on `window.__iobrokerShared__`; {@link hostShared} redirects the imports there.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import { federation } from '@module-federation/vite';
import { hostShared } from './hostShared.ts';

/**
 * @param relative path relative to `src-devices`
 */
const dir = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const config = {
    plugins: [
        hostShared([
            dir('./src'),
            dir('../src-shared/src'),
            // the stub of the base class of the devices app imports `Component` from react
            dir('./node_modules/@iobroker/dm-widgets/build'),
        ]),
        federation({
            manifest: true,
            name: 'DevicesWidgetIntercomSet',
            filename: 'customDevices.js',
            exposes: {
                './Components': './src/Components.tsx',
                './translations': './src/translations',
            },
            remotes: {},
            shared: {},
            dts: false,
        }),
        react(),
        commonjs(),
    ],
    resolve: {
        // The phone lives outside this project, so Node resolution would look for its packages next to it and
        // further up. `hostShared` catches the bare names, but `react/jsx-runtime` would go past it.
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
    server: {
        fs: {
            allow: [dir('..')],
        },
    },
    base: './',
    build: {
        // top-level await of the federation plugin
        target: 'chrome89',
        outDir: './build',
        rollupOptions: {
            onwarn(warning: { code: string }, warn: (warning: { code: string }) => void): void {
                // "Module level directives cause errors when bundled" - harmless for "use client"
                if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
                    return;
                }
                warn(warning);
            },
        },
    },
};

export default config;

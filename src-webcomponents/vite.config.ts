import react from '@vitejs/plugin-react';
import { checkManifest, getReactImportPath, REACT_SPECIFIERS, type WebComponentText } from '@iobroker/web-components';
import { readFileSync } from 'node:fs';
import type { Plugin, UserConfig } from 'vite';

// with the extension: Vite may load its config natively, without a bundler that would add it
import { DEVICES_WIDGET, ELEMENT_WORDS } from './src/constants.ts';
import { buildManifest, MANIFEST_FILE, MODULE_FILE, MODULE_PATH } from './src/manifest.ts';

/**
 * The web component `<iob-intercom-phone>`: one ES module, `admin/webcomponents/intercom-phone.js`, and its manifest
 * `intercom-phone.json` next to it (`common.webComponents`). Every host - vis-2, devices, Aura, admin - reads them from
 * `/adapter/intercom/webcomponents/`. No module federation: the host shares nothing but the socket.
 *
 * The module brings the phone of the vis-2 widget and the devices tile: the phone core with JsSIP
 * (`../src-www/src/SipPhone.ts`), the registry that shares one phone between all elements of a page, the settings
 * and the camera pictures (`../src-shared/src/`). Only the look is its own - plain React and CSS instead of MUI.
 *
 * React is not bundled: the four React imports point at `lib/esm/react-19.js`, which web and admin serve beside
 * `adapter/`. The path is relative to the module, so a path prefix of a reverse proxy stays.
 */

const LANGUAGES: ioBroker.Languages[] = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'];

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

/** The dictionary of the phone, shared by the vis-2 widget and the devices tile */
const DICTIONARY = Object.fromEntries(
    LANGUAGES.map(lang => [lang, readJson<Record<string, string>>(`../src-shared/i18n/${lang}.json`)]),
) as Record<ioBroker.Languages, Record<string, string>>;

/**
 * A word of the dictionary in every language
 *
 * @param key the key, without the prefix `intercom_`
 */
function dictionaryWord(key: string): WebComponentText {
    const text: Partial<Record<ioBroker.Languages, string>> = {};
    for (const lang of LANGUAGES) {
        if (!DICTIONARY[lang][key]) {
            throw new Error(`src-shared/i18n/${lang}.json has no "${key}"`);
        }
        text[lang] = DICTIONARY[lang][key];
    }
    return text as WebComponentText;
}

/** The words the element shows (`src/words.ts`), in every language */
function pickWords(): Record<ioBroker.Languages, Record<string, string>> {
    const picked = Object.fromEntries(LANGUAGES.map(lang => [lang, {}])) as Record<
        ioBroker.Languages,
        Record<string, string>
    >;
    for (const key of ELEMENT_WORDS) {
        const text = dictionaryWord(key) as Record<ioBroker.Languages, string>;
        for (const lang of LANGUAGES) {
            picked[lang][key] = text[lang];
        }
    }
    return picked;
}

/**
 * A text of `io-package.json`, which must be there in every language
 *
 * @param text the text
 * @param what where it is, for the error
 */
function translated(text: ioBroker.StringOrTranslated | undefined, what: string): WebComponentText {
    for (const lang of LANGUAGES) {
        if (!text || typeof text !== 'object' || !text[lang]) {
            throw new Error(`io-package.json: ${what} has no text in "${lang}"`);
        }
    }
    return text as WebComponentText;
}

/** Writes `intercom-phone.json` next to the module, checked like a host checks it */
function manifestFile(): Plugin {
    return {
        name: 'intercom-web-component-manifest',
        generateBundle() {
            let manifest;
            try {
                const ioPackage = readJson<ioBroker.AdapterObject>('../io-package.json');
                const widget = ioPackage.common.deviceWidgets?.components.find(c => c.name === DEVICES_WIDGET);
                if (!widget) {
                    throw new Error(`io-package.json has no devices widget "${DEVICES_WIDGET}"`);
                }
                manifest = buildManifest({
                    name: translated(widget.label, `the label of ${DEVICES_WIDGET}`),
                    description: translated(widget.description, `the description of ${DEVICES_WIDGET}`),
                    word: dictionaryWord,
                });
            } catch (e) {
                this.error(`${MANIFEST_FILE}: ${(e as Error).message}`);
            }
            const problem = checkManifest(manifest);
            if (problem) {
                this.error(`${MANIFEST_FILE}: ${problem}`);
            }
            if (manifest.module !== MODULE_FILE) {
                this.error(`${MANIFEST_FILE}: "module" must be "${MODULE_FILE}"`);
            }
            this.emitFile({
                type: 'asset',
                fileName: MANIFEST_FILE,
                source: `${JSON.stringify(manifest, null, 4)}\n`,
            });
        },
    };
}

const reactImport = getReactImportPath(MODULE_PATH);

const config: UserConfig = {
    plugins: [react(), manifestFile()],
    define: {
        __INTERCOM_WORDS__: JSON.stringify(pickWords()),
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
        // The phone core (../src-www/src/SipPhone.ts) imports JsSIP: take it from here, not from a folder next to it
        dedupe: ['jssip'],
    },
    build: {
        target: 'es2022',
        outDir: './build',
        emptyOutDir: true,
        lib: {
            entry: './src/index.tsx',
            formats: ['es'],
            fileName: (): string => MODULE_FILE,
        },
        rollupOptions: {
            external: [...REACT_SPECIFIERS],
            output: {
                paths: Object.fromEntries(REACT_SPECIFIERS.map(specifier => [specifier, reactImport])),
                // one file: a host imports exactly one URL
                codeSplitting: false,
                // library mode keeps whitespace for the bundler of a consumer; this module is loaded as it is
                minify: true,
            },
        },
    },
};

export default config;

/**
 * Hands the plugin React, MUI and gui-components of the devices app instead of copies from its own bundle.
 *
 * The devices app shares nothing through Module Federation: it puts its modules on `window.__iobrokerShared__`
 * (`ioBroker.devices`, `src-admin/src/WidgetsManager/pluginLoader.ts`). A plugin that simply imports `react` gets a
 * second React bundled into itself, and every hook of the phone fails on it with "Invalid hook call". So every
 * import of these packages is redirected to a small module that reads the copy of the devices app from there.
 *
 * The exported names are collected from the sources at build time: `@mui/icons-material` alone has over ten
 * thousand exports, and a list written by hand would go stale with the next import in the shared phone.
 *
 * Taken from ioBroker.alarm, where it was found out.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Packages the devices app provides on `window.__iobrokerShared__`, under these keys */
export const HOST_SHARED_PACKAGES = [
    'react',
    'react-dom',
    '@mui/material',
    '@mui/icons-material',
    '@iobroker/gui-components',
] as const;

const VIRTUAL_PREFIX = '\0intercom-host-shared:';

/**
 * Every `.ts`/`.tsx`/`.js` file under a directory, tests excluded.
 *
 * @param dir directory to walk
 */
function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            if (entry === 'node_modules') {
                continue;
            }
            files.push(...sourceFiles(path));
        } else if (/\.(tsx?|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
            files.push(path);
        }
    }
    return files;
}

/**
 * Collects, per shared package, the names imported from it across the given directories.
 *
 * Default and named imports, with and without `as`, and inline `type` specifiers. A whole `import type` is
 * skipped: erased at compile time. A namespace import (`import * as X`) is refused, it tells nothing about the
 * names used.
 *
 * @param dirs directories whose sources are scanned
 */
export function collectImportedNames(dirs: readonly string[]): Map<string, Set<string>> {
    const byPackage = new Map<string, Set<string>>();
    const importPattern = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;

    for (const dir of dirs) {
        for (const file of sourceFiles(dir)) {
            const text = readFileSync(file, 'utf8');
            for (const match of text.matchAll(importPattern)) {
                const [, typeOnly, clause = '', source = ''] = match;
                if (typeOnly || !(HOST_SHARED_PACKAGES as readonly string[]).includes(source)) {
                    continue;
                }

                const names = byPackage.get(source) ?? new Set<string>();
                byPackage.set(source, names);

                if (/\*\s+as\s+/.test(clause)) {
                    throw new Error(`${file}: "import * as" from ${source} cannot be redirected to the devices app`);
                }

                const braces = /\{([^}]*)\}/.exec(clause);
                const defaultPart = clause
                    .replace(/\{[^}]*\}/, '')
                    .replace(/,/g, '')
                    .trim();
                if (defaultPart) {
                    names.add('default');
                }

                if (braces) {
                    for (const specifier of braces[1].split(',')) {
                        const trimmed = specifier.trim();
                        if (!trimmed || trimmed.startsWith('type ')) {
                            continue;
                        }
                        names.add(trimmed.split(/\s+as\s+/)[0].trim());
                    }
                }
            }
        }
    }

    return byPackage;
}

/**
 * The Vite plugin.
 *
 * @param scanDirs every directory whose code ends up in the bundle and imports these packages
 */
export function hostShared(scanDirs: readonly string[]): Plugin {
    const used = collectImportedNames(scanDirs);

    return {
        name: 'intercom-host-shared',
        enforce: 'pre',
        resolveId(id: string) {
            return (HOST_SHARED_PACKAGES as readonly string[]).includes(id) ? VIRTUAL_PREFIX + id : null;
        },
        load(id: string) {
            if (!id.startsWith(VIRTUAL_PREFIX)) {
                return null;
            }
            const pkg = id.slice(VIRTUAL_PREFIX.length);
            const names = [...(used.get(pkg) ?? [])].filter(name => name !== 'default').sort();

            return [
                `const host = globalThis.__iobrokerShared__ && globalThis.__iobrokerShared__[${JSON.stringify(pkg)}];`,
                // loud and early: undefined components would fail far from the cause
                `if (!host) throw new Error(${JSON.stringify(`${pkg} is not provided by the devices app`)});`,
                // a namespace object has no meaningful default; the default export of React is the object itself
                'export default host.default ?? host;',
                ...names.map(name => `export const ${name} = host.${name};`),
            ].join('\n');
        },
    };
}

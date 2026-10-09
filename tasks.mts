// Copies the browser bundles into the adapter:
// - the phone of the test page (src-www) into the adapter build, from where the adapter writes it next
//   to the test page of Asterisk
// - the vis-2 widgets (src-widgets) into widgets/asterisk-docker, from where vis-2 loads them
// Runs directly with `node tasks.mts` (type stripping of Node.js >= 22.18, no build step).
//   node tasks.mts            both
//   node tasks.mts --www      only the phone
//   node tasks.mts --widgets  only the widgets
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root: string = import.meta.dirname;
const onlyWww = process.argv.includes('--www');
const onlyWidgets = process.argv.includes('--widgets');

function fail(text: string): never {
    console.error(text);
    process.exit(1);
}

if (!onlyWidgets) {
    const source: string = join(root, 'src-www', 'build', 'phone.min.js');
    const targetDir: string = join(root, 'build', 'static');
    const target: string = join(targetDir, 'phone.min.js');
    if (!existsSync(source)) {
        fail(`${source} does not exist. Run "npm run build:www" (and "npm run npm" once before)`);
    }
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(source, target);
    console.log(`Copied ${source} to ${target}`);
}

if (!onlyWww) {
    const source: string = join(root, 'src-widgets', 'build');
    const target: string = join(root, 'widgets', 'asterisk-docker');
    if (!existsSync(join(source, 'customWidgets.js'))) {
        fail(`${source}/customWidgets.js does not exist. Run "npm run build:widgets" (and "npm run npm" once before)`);
    }
    rmSync(join(root, 'widgets'), { recursive: true, force: true });
    // index.html is only the page of the development server, .vite holds build metadata
    cpSync(source, target, {
        recursive: true,
        filter: src => !src.endsWith('index.html') && !/[\\/]\.vite([\\/]|$)/.test(src),
    });
    console.log(`Copied ${source} to ${target}`);
}

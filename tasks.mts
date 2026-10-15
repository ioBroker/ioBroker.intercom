// Copies the browser bundles into the adapter:
// - the phone of the test page (src-www) into the adapter build, from where the adapter writes it next
//   to the test page of Asterisk
// - the vis-2 widgets (src-widgets) into widgets/intercom, from where vis-2 loads them
// - the plugin of the devices app (src-devices) into admin/dm-widgets, from where the devices app loads it
// Runs directly with `node tasks.mts` (type stripping of Node.js >= 22.18, no build step).
//   node tasks.mts            all
//   node tasks.mts --www      only the phone
//   node tasks.mts --widgets  only the widgets
//   node tasks.mts --devices  only the plugin of the devices app
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root: string = import.meta.dirname;
const parts = ['--www', '--widgets', '--devices'].filter(part => process.argv.includes(part));
const wanted = (part: string): boolean => !parts.length || parts.includes(part);

function fail(text: string): never {
    console.error(text);
    process.exit(1);
}

/** Copy a Vite build. index.html is only the page of the development server, .vite holds build metadata */
function copyBuild(source: string, target: string): void {
    cpSync(source, target, {
        recursive: true,
        filter: src => !src.endsWith('index.html') && !/[\\/]\.vite([\\/]|$)/.test(src),
    });
    console.log(`Copied ${source} to ${target}`);
}

if (wanted('--www')) {
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

if (wanted('--widgets')) {
    const source: string = join(root, 'src-widgets', 'build');
    if (!existsSync(join(source, 'customWidgets.js'))) {
        fail(`${source}/customWidgets.js does not exist. Run "npm run build:widgets" (and "npm run npm" once before)`);
    }
    rmSync(join(root, 'widgets'), { recursive: true, force: true });
    copyBuild(source, join(root, 'widgets', 'intercom'));
}

if (wanted('--devices')) {
    const source: string = join(root, 'src-devices', 'build');
    const target: string = join(root, 'admin', 'dm-widgets');
    if (!existsSync(join(source, 'customDevices.js'))) {
        fail(`${source}/customDevices.js does not exist. Run "npm run build:devices" (and "npm run npm" once before)`);
    }
    rmSync(target, { recursive: true, force: true });
    copyBuild(source, target);
    // the icon of the tile in the catalogue of the devices app, named by common.deviceWidgets
    copyFileSync(join(root, 'src-devices', 'img', 'intercom.svg'), join(target, 'intercom.svg'));
}

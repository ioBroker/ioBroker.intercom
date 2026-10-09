// Copies the phone bundle built in src-www into the adapter build, from where the adapter writes it
// next to the test page of Asterisk.
// Runs directly with `node tasks.mts` (type stripping of Node.js >= 22.18, no build step).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root: string = import.meta.dirname;
const source: string = join(root, 'src-www', 'build', 'phone.min.js');
const targetDir: string = join(root, 'build', 'static');
const target: string = join(targetDir, 'phone.min.js');

if (!existsSync(source)) {
    console.error(`${source} does not exist. Run "npm run build:www" (and "npm run npm" once before)`);
    process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`Copied ${source} to ${target}`);

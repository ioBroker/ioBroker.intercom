const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');

describe('vis-2 widgets', () => {
    const ioPackage = JSON.parse(readFileSync(join(root, 'io-package.json'), 'utf8'));
    const [[key, set]] = Object.entries(ioPackage.common.visWidgets);

    it('io-package.json and the module federation use the same name', () => {
        const vite = readFileSync(join(root, 'src-widgets', 'vite.config.ts'), 'utf8');
        assert.equal(set.name, key);
        assert.match(vite, new RegExp(`name: '${key}'`));
        for (const component of set.components) {
            assert.match(vite, new RegExp(`'\\./${component}': `), component);
        }
        assert.equal(set.bundlerType, 'module');
        assert.ok(ioPackage.common.restartAdapters.includes('vis-2'));
    });

    it('the built widgets are where vis-2 loads them from', () => {
        const file = join(root, 'widgets', set.url);
        assert.ok(existsSync(file), `${file} missing: run npm run build`);
        assert.equal(set.url, `${ioPackage.common.name}/customWidgets.js`);
        assert.ok(!existsSync(join(root, 'widgets', ioPackage.common.name, 'index.html')));
        const pack = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        assert.ok(pack.files.includes('widgets/'));
    });
});

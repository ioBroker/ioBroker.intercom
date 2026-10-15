const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const ioPackage = JSON.parse(readFileSync(join(root, 'io-package.json'), 'utf8'));
const pack = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('vis-2 widgets', () => {
    const [[key, set]] = Object.entries(ioPackage.common.visWidgets);

    it('io-package.json and the module federation use the same name', () => {
        const vite = readFileSync(join(root, 'src-widgets', 'vite.config.ts'), 'utf8');
        assert.equal(set.name, key);
        assert.match(vite, new RegExp(`name: '${key}'`));
        for (const component of [...set.components, ...set.services]) {
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
        assert.ok(pack.files.includes('widgets/'));
    });
});

describe('plugin of the devices app', () => {
    const plugin = ioPackage.common.deviceWidgets;
    const components = readFileSync(join(root, 'src-devices', 'src', 'Components.tsx'), 'utf8');
    const target = join(root, 'admin', 'dm-widgets');

    it('exports every component and service named in io-package.json', () => {
        const exported = /export default \{([^}]*)\}/.exec(components)?.[1].split(',').map(name => name.trim());
        for (const name of [...plugin.components.map(component => component.name), ...(plugin.services || [])]) {
            assert.ok(exported.includes(name), name);
        }
        // Not named yet: the schema of io-package.json allows no `services` in deviceWidgets
        // (additionalProperties: false), unlike in a set of visWidgets
        assert.ok(exported.includes('IntercomService'));
        for (const component of plugin.components) {
            assert.equal(Object.keys(component.label).length, 11, `${component.name}: label in all languages`);
            assert.equal(Object.keys(component.description).length, 11, `${component.name}: description`);
        }
    });

    it('the module federation exposes what the devices app loads', () => {
        const vite = readFileSync(join(root, 'src-devices', 'vite.config.ts'), 'utf8');
        assert.match(vite, new RegExp(`filename: '${plugin.url}'`));
        // the devices app always loads these two modules of a plugin
        assert.match(vite, /'\.\/Components': /);
        assert.match(vite, /'\.\/translations': /);
    });

    it('the built plugin and its icons are where the devices app loads them from', () => {
        assert.ok(existsSync(join(target, plugin.url)), `${plugin.url} missing: run npm run build`);
        assert.ok(!existsSync(join(target, 'index.html')));
        for (const component of plugin.components) {
            assert.ok(existsSync(join(target, component.icon)), component.icon);
        }
        assert.ok(pack.files.includes('admin/'));
    });
});

describe('translations of the phone', () => {
    const dir = join(root, 'src-shared', 'i18n');
    const en = Object.keys(JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')));

    it('have the same keys in all languages', () => {
        for (const lang of ['de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn']) {
            const keys = Object.keys(JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')));
            assert.deepEqual(keys, en, lang);
        }
    });

    it('cover the labels of the settings of the tile', () => {
        const tile = readFileSync(join(root, 'src-devices', 'src', 'IntercomPhoneComponent.tsx'), 'utf8');
        const used = [...tile.matchAll(/(?:label|help|text)\('([a-z_]+)'\)/g)].map(match => match[1]);
        assert.ok(used.length > 20);
        for (const key of used) {
            assert.ok(en.includes(key), key);
        }
    });
});

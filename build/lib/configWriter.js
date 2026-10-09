"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashFiles = hashFiles;
exports.writeConfigFiles = writeConfigFiles;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const configGenerator_1 = require("./configGenerator");
/** Generated file names that may be removed when they are no longer generated */
const MANAGED_PATTERN = /^(?:[a-z_]+\.conf|start\.sh|keys\/asterisk\.(?:crt|key)|static-http\/(?:test\.html|phone\.min\.js|jssip\.min\.js))$/;
const CUSTOM_PATTERN = /_custom\.conf$/;
/** Hash over the sorted file names and contents */
function hashFiles(files) {
    const hash = (0, node_crypto_1.createHash)('sha256');
    for (const name of Object.keys(files).sort()) {
        hash.update(name);
        hash.update('\0');
        hash.update(files[name]);
        hash.update('\0');
    }
    return hash.digest('hex');
}
async function listFiles(dir, base = dir) {
    const result = [];
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(dir, { withFileTypes: true });
    }
    catch {
        return result;
    }
    for (const entry of entries) {
        const full = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await listFiles(full, base)));
        }
        else if (entry.isFile()) {
            result.push((0, node_path_1.relative)(base, full).split(node_path_1.sep).join('/'));
        }
    }
    return result;
}
/**
 * Write the generated files into the directory: atomic (temp file + rename), only if the content
 * changed, secrets with mode 0600. Generated files that are not part of `files` anymore are removed,
 * `*_custom.conf` never.
 *
 * @param dir target directory
 * @param files relative file name => content
 */
async function writeConfigFiles(dir, files) {
    const changed = [];
    const removed = [];
    await node_fs_1.promises.mkdir(dir, { recursive: true });
    await node_fs_1.promises.mkdir((0, node_path_1.join)(dir, 'keys'), { recursive: true, mode: 0o700 });
    await node_fs_1.promises.mkdir((0, node_path_1.join)(dir, 'static-http'), { recursive: true });
    // written by Asterisk (bind mount), read by the adapter. Must exist before the container is created,
    // otherwise docker creates it as root
    await node_fs_1.promises.mkdir((0, node_path_1.join)(dir, 'logs'), { recursive: true });
    for (const name of Object.keys(files)) {
        const target = (0, node_path_1.join)(dir, name);
        const mode = configGenerator_1.SECRET_FILES.includes(name) ? 0o600 : name.endsWith('.sh') ? 0o755 : 0o644;
        let old = null;
        try {
            old = await node_fs_1.promises.readFile(target, 'utf8');
        }
        catch {
            // does not exist yet
        }
        if (old === files[name]) {
            // Fix the permissions anyway, somebody may have changed them
            await node_fs_1.promises.chmod(target, mode).catch(() => { });
            continue;
        }
        await node_fs_1.promises.mkdir((0, node_path_1.dirname)(target), { recursive: true });
        const tmp = `${target}.${process.pid}.tmp`;
        await node_fs_1.promises.writeFile(tmp, files[name], { mode });
        await node_fs_1.promises.chmod(tmp, mode).catch(() => { });
        await node_fs_1.promises.rename(tmp, target);
        changed.push(name);
    }
    for (const name of await listFiles(dir)) {
        if (files[name] !== undefined || CUSTOM_PATTERN.test(name) || !MANAGED_PATTERN.test(name)) {
            continue;
        }
        await node_fs_1.promises.unlink((0, node_path_1.join)(dir, name)).catch(() => { });
        removed.push(name);
    }
    return { changed, removed, hash: hashFiles(files) };
}
//# sourceMappingURL=configWriter.js.map
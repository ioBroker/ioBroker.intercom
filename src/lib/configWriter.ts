import { createHash } from 'node:crypto';
import { type Dirent, promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { SECRET_FILES } from './configGenerator';

/** Generated file names that may be removed when they are no longer generated */
const MANAGED_PATTERN =
    /^(?:[a-z_]+\.conf|start\.sh|keys\/asterisk\.(?:crt|key)|static-http\/(?:test\.html|phone\.min\.js|jssip\.min\.js))$/;
const CUSTOM_PATTERN = /_custom\.conf$/;

export interface WriteResult {
    /** Files that were written, because they were new or their content changed */
    changed: string[];
    /** Files that were removed, because they are not generated anymore */
    removed: string[];
    /** Hash over all generated files */
    hash: string;
}

/** Hash over the sorted file names and contents */
export function hashFiles(files: Record<string, string>): string {
    const hash = createHash('sha256');
    for (const name of Object.keys(files).sort()) {
        hash.update(name);
        hash.update('\0');
        hash.update(files[name]);
        hash.update('\0');
    }
    return hash.digest('hex');
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
    const result: string[] = [];
    let entries: Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return result;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...(await listFiles(full, base)));
        } else if (entry.isFile()) {
            result.push(relative(base, full).split(sep).join('/'));
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
export async function writeConfigFiles(dir: string, files: Record<string, string>): Promise<WriteResult> {
    const changed: string[] = [];
    const removed: string[] = [];

    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(join(dir, 'keys'), { recursive: true, mode: 0o700 });
    await fs.mkdir(join(dir, 'static-http'), { recursive: true });
    // written by Asterisk (bind mount), read by the adapter. Must exist before the container is created,
    // otherwise docker creates it as root
    await fs.mkdir(join(dir, 'logs'), { recursive: true });

    for (const name of Object.keys(files)) {
        const target = join(dir, name);
        const mode = SECRET_FILES.includes(name) ? 0o600 : name.endsWith('.sh') ? 0o755 : 0o644;
        let old: string | null = null;
        try {
            old = await fs.readFile(target, 'utf8');
        } catch {
            // does not exist yet
        }
        if (old === files[name]) {
            // Fix the permissions anyway, somebody may have changed them
            await fs.chmod(target, mode).catch(() => {});
            continue;
        }
        await fs.mkdir(dirname(target), { recursive: true });
        const tmp = `${target}.${process.pid}.tmp`;
        await fs.writeFile(tmp, files[name], { mode });
        await fs.chmod(tmp, mode).catch(() => {});
        await fs.rename(tmp, target);
        changed.push(name);
    }

    for (const name of await listFiles(dir)) {
        if (files[name] !== undefined || CUSTOM_PATTERN.test(name) || !MANAGED_PATTERN.test(name)) {
            continue;
        }
        await fs.unlink(join(dir, name)).catch(() => {});
        removed.push(name);
    }

    return { changed, removed, hash: hashFiles(files) };
}

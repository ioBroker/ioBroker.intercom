/**
 * Fetches the snapshot of a camera over HTTP(S), with the authentication that the browser cannot do in
 * an `<img>`: API key header (UniFi Protect), Bearer token, Basic or Digest authentication.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

export type SnapshotAuth = 'none' | 'basic' | 'apikey' | 'bearer';

export interface SnapshotRequest {
    url: string;
    auth: SnapshotAuth;
    /** User for Basic/Digest */
    user?: string;
    /** Password, API key or token */
    password?: string;
    /** Accept self-signed certificates (cameras and the UniFi console use them) */
    insecure?: boolean;
    /** ms */
    timeout?: number;
    /** Maximal size of the picture in bytes */
    maxSize?: number;
}

export interface Snapshot {
    data: Buffer;
    contentType: string;
}

interface RawResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

const MAX_REDIRECTS = 3;

/** URL without credentials and query (it may contain a token), for the log */
export function describeUrl(url: string): string {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
        return '(invalid URL)';
    }
}

/** Parameters of a `WWW-Authenticate: Digest ...` header, or null for other schemes */
export function parseDigestChallenge(header: string | string[] | undefined): Record<string, string> | null {
    const values = Array.isArray(header) ? header : header ? [header] : [];
    const digest = values.find(v => /^\s*Digest\s/i.test(v));
    if (!digest) {
        return null;
    }
    const params: Record<string, string> = {};
    const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(digest.replace(/^\s*Digest\s+/i, '')))) {
        params[m[1].toLowerCase()] = m[2] ?? m[3];
    }
    return params.nonce ? params : null;
}

const md5 = (text: string): string => createHash('md5').update(text).digest('hex');

/** `Authorization` header for HTTP Digest (RFC 7616, MD5, qop=auth or none) */
export function digestAuthorization(options: {
    user: string;
    password: string;
    method: string;
    uri: string;
    challenge: Record<string, string>;
    cnonce?: string;
    nc?: string;
}): string {
    const { user, password, method, uri, challenge } = options;
    const cnonce = options.cnonce || randomBytes(8).toString('hex');
    const nc = options.nc || '00000001';
    const qop = (challenge.qop || '')
        .split(',')
        .map(q => q.trim())
        .includes('auth')
        ? 'auth'
        : '';
    let ha1 = md5(`${user}:${challenge.realm || ''}:${password}`);
    if ((challenge.algorithm || '').toLowerCase() === 'md5-sess') {
        ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
    }
    const ha2 = md5(`${method}:${uri}`);
    const response = qop
        ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${challenge.nonce}:${ha2}`);
    const parts = [
        `username="${user}"`,
        `realm="${challenge.realm || ''}"`,
        `nonce="${challenge.nonce}"`,
        `uri="${uri}"`,
        `response="${response}"`,
    ];
    if (challenge.algorithm) {
        parts.push(`algorithm=${challenge.algorithm}`);
    }
    if (qop) {
        parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    }
    if (challenge.opaque) {
        parts.push(`opaque="${challenge.opaque}"`);
    }
    return `Digest ${parts.join(', ')}`;
}

function get(url: URL, headers: Record<string, string>, req: SnapshotRequest): Promise<RawResponse> {
    const maxSize = req.maxSize || 5 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const lib = url.protocol === 'https:' ? https : http;
        const request = lib.get(
            url,
            {
                headers: { Accept: 'image/*', ...headers },
                timeout: req.timeout || 5000,
                rejectUnauthorized: !req.insecure,
            },
            res => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > maxSize) {
                        request.destroy(new Error(`picture bigger than ${Math.round(maxSize / 1024)} kB`));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }),
                );
                res.on('error', reject);
            },
        );
        request.on('timeout', () => request.destroy(new Error('timeout')));
        request.on('error', reject);
    });
}

/**
 * Fetch one picture. Credentials in the URL (`http://user:pass@host/...`) are used for Basic/Digest.
 *
 * @param req what to fetch and how to authenticate
 */
export async function fetchSnapshot(req: SnapshotRequest): Promise<Snapshot> {
    let url = new URL(req.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('only http and https are supported');
    }
    let user = req.user || '';
    let password = req.password || '';
    if (url.username) {
        user = user || decodeURIComponent(url.username);
        password = password || decodeURIComponent(url.password);
        url.username = '';
        url.password = '';
    }
    const auth: SnapshotAuth = req.auth === 'none' && user ? 'basic' : req.auth;
    const origin = url.origin;

    const headers: Record<string, string> = {};
    if (auth === 'apikey') {
        headers['X-API-KEY'] = password;
    } else if (auth === 'bearer') {
        headers.Authorization = `Bearer ${password}`;
    } else if (auth === 'basic') {
        headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    }

    let res = await get(url, headers, req);
    for (let i = 0; i < MAX_REDIRECTS && res.status >= 300 && res.status < 400 && res.headers.location; i++) {
        url = new URL(res.headers.location, url);
        // never send the credentials to another server
        res = await get(url, url.origin === origin ? headers : {}, req);
    }
    if (res.status === 401 && auth === 'basic') {
        const challenge = parseDigestChallenge(res.headers['www-authenticate']);
        if (challenge) {
            res = await get(
                url,
                {
                    Authorization: digestAuthorization({
                        user,
                        password,
                        method: 'GET',
                        uri: `${url.pathname}${url.search}`,
                        challenge,
                    }),
                },
                req,
            );
        }
    }
    if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
    }
    const contentType = String(res.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    if (!contentType.startsWith('image/')) {
        throw new Error(`not a picture (${contentType || 'no content type'})`);
    }
    if (!res.body.length) {
        throw new Error('empty picture');
    }
    return { data: res.body, contentType };
}

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const { describeUrl, digestAuthorization, fetchSnapshot, parseDigestChallenge } = require('../../build/lib/snapshot');
const { CameraPoller, cameraId, validateCameras } = require('../../build/lib/cameras');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const md5 = text => createHash('md5').update(text).digest('hex');

/** Small camera: answers depending on the path, records the headers */
function startCamera() {
    const seen = [];
    const server = http.createServer((req, res) => {
        seen.push({ url: req.url, headers: req.headers });
        const auth = req.headers.authorization || '';
        const image = () => {
            res.writeHead(200, { 'Content-Type': 'image/jpeg' });
            res.end(JPEG);
        };
        switch (req.url) {
            case '/open.jpg':
                return image();
            case '/basic.jpg':
                if (auth === `Basic ${Buffer.from('admin:secret').toString('base64')}`) {
                    return image();
                }
                res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="cam"' });
                return res.end();
            case '/digest.jpg': {
                const m = /response="([^"]+)"/.exec(auth);
                const p = Object.fromEntries([...auth.matchAll(/(\w+)="?([^",]+)"?/g)].map(x => [x[1], x[2]]));
                if (m && p.nonce === 'abc') {
                    const ha1 = md5('admin:cam:secret');
                    const ha2 = md5(`GET:${p.uri}`);
                    if (m[1] === md5(`${ha1}:abc:${p.nc}:${p.cnonce}:auth:${ha2}`)) {
                        return image();
                    }
                }
                res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="cam", nonce="abc", qop="auth"' });
                return res.end();
            }
            case '/unifi.jpg':
                if (req.headers['x-api-key'] === 'KEY123') {
                    return image();
                }
                res.writeHead(401);
                return res.end();
            case '/redirect':
                res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/other/open.jpg` });
                return res.end();
            case '/other/open.jpg':
                return image();
            case '/page':
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end('<html></html>');
            default:
                res.writeHead(404);
                return res.end();
        }
    });
    return new Promise(resolve =>
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })),
    );
}

describe('Snapshot proxy', () => {
    let cam;
    before(async () => (cam = await startCamera()));
    after(() => cam.server.close());

    it('fetches a picture without authentication', async () => {
        const r = await fetchSnapshot({ url: `${cam.base}/open.jpg`, auth: 'none' });
        assert.equal(r.contentType, 'image/jpeg');
        assert.deepEqual(r.data, JPEG);
    });

    it('authenticates with Basic, also with the credentials in the URL', async () => {
        await fetchSnapshot({ url: `${cam.base}/basic.jpg`, auth: 'basic', user: 'admin', password: 'secret' });
        const withUrl = cam.base.replace('http://', 'http://admin:secret@');
        await fetchSnapshot({ url: `${withUrl}/basic.jpg`, auth: 'none' });
        await assert.rejects(
            fetchSnapshot({ url: `${cam.base}/basic.jpg`, auth: 'basic', user: 'admin', password: 'wrong' }),
            /HTTP 401/,
        );
    });

    it('answers a Digest challenge', async () => {
        const r = await fetchSnapshot({ url: `${cam.base}/digest.jpg`, auth: 'basic', user: 'admin', password: 'secret' });
        assert.deepEqual(r.data, JPEG);
    });

    it('sends the API key of UniFi Protect as header', async () => {
        await fetchSnapshot({ url: `${cam.base}/unifi.jpg`, auth: 'apikey', password: 'KEY123' });
        assert.equal(cam.seen.at(-1).headers['x-api-key'], 'KEY123');
    });

    it('follows redirects, rejects pages that are not pictures', async () => {
        const r = await fetchSnapshot({ url: `${cam.base}/redirect`, auth: 'none' });
        assert.deepEqual(r.data, JPEG);
        await assert.rejects(fetchSnapshot({ url: `${cam.base}/page`, auth: 'none' }), /not a picture \(text\/html\)/);
        await assert.rejects(fetchSnapshot({ url: 'ftp://x/y.jpg', auth: 'none' }), /only http and https/);
    });

    it('never writes credentials or tokens into the log text', () => {
        assert.equal(
            describeUrl('https://admin:secret@192.168.100.1/proxy/snap.jpg?token=abc'),
            'https://192.168.100.1/proxy/snap.jpg',
        );
    });

    it('builds the Digest response of RFC 7616', () => {
        const challenge = parseDigestChallenge('Digest realm="cam", nonce="n1", qop="auth,auth-int", opaque="o"');
        assert.deepEqual(challenge, { realm: 'cam', nonce: 'n1', qop: 'auth,auth-int', opaque: 'o' });
        const header = digestAuthorization({
            user: 'u',
            password: 'p',
            method: 'GET',
            uri: '/a',
            challenge,
            cnonce: 'c',
            nc: '00000001',
        });
        const expected = md5(`${md5('u:cam:p')}:n1:00000001:c:auth:${md5('GET:/a')}`);
        assert.match(header, new RegExp(`response="${expected}"`));
        assert.match(header, /opaque="o"/);
        assert.equal(parseDigestChallenge('Basic realm="x"'), null);
    });
});

describe('Cameras', () => {
    it('validates the table', () => {
        const { cameras, warnings } = validateCameras([
            { enabled: true, name: 'door', url: 'https://192.168.100.1/snap.jpg', auth: 'apikey', password: 'k' },
            { enabled: true, name: 'door', url: 'http://x/y.jpg' },
            { enabled: true, name: '', url: 'http://x/y.jpg' },
            { enabled: true, name: 'ftp', url: 'ftp://x/y.jpg' },
            { enabled: false, name: 'off', url: 'http://x/y.jpg' },
            { enabled: true, name: 'Garten 2', url: 'http://x/y.jpg', interval: 0.1, idleInterval: 0 },
            null,
        ]);
        assert.deepEqual(
            cameras.map(c => c.id),
            ['door', 'garten_2'],
        );
        assert.equal(cameras[0].insecure, true);
        assert.equal(cameras[0].interval, 1);
        assert.equal(cameras[0].idleInterval, 10);
        assert.equal(cameras[1].interval, 0.5);
        assert.equal(cameras[1].idleInterval, 0);
        assert.equal(warnings.length, 3);
        assert.equal(cameraId('Haustür'), 'haust_r');
    });

    it('reports only changed pictures and changed errors, and fetches at once when a call starts', async () => {
        const [camera] = validateCameras([{ enabled: true, name: 'door', url: 'http://x/y.jpg', idleInterval: 0 }])
            .cameras;
        let answer = { data: Buffer.from('a'), contentType: 'image/jpeg' };
        let fetches = 0;
        const images = [];
        const errors = [];
        const poller = new CameraPoller({
            cameras: [camera],
            fetch: async () => {
                fetches++;
                if (answer instanceof Error) {
                    throw answer;
                }
                return answer;
            },
            onImage: (_c, url) => images.push(url),
            onError: (_c, error) => errors.push(error),
        });
        const wait = ms => new Promise(r => setTimeout(r, ms));
        poller.start();
        await wait(30);
        // one picture at the start, then nothing without a call (idleInterval 0)
        assert.equal(fetches, 1);
        assert.deepEqual(images, [`data:image/jpeg;base64,${Buffer.from('a').toString('base64')}`]);
        assert.deepEqual(errors, ['']);

        // a call starts: at once, the same picture is not reported again
        poller.setActive(true);
        await wait(30);
        assert.equal(fetches, 2);
        assert.equal(images.length, 1);

        // the camera fails: one error, then it works again
        answer = new Error('HTTP 401');
        poller.setActive(false);
        poller.setActive(true);
        await wait(30);
        assert.deepEqual(errors, ['', 'HTTP 401']);
        answer = { data: Buffer.from('b'), contentType: 'image/jpeg' };
        await wait(1100);
        poller.stop();
        assert.deepEqual(errors, ['', 'HTTP 401', '']);
        assert.equal(images.length, 2);
    });
});

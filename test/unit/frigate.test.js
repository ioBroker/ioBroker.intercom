const assert = require('node:assert/strict');

// Plain TypeScript without imports at runtime: Node.js >= 22.18 strips the types itself
const { frigateStreamUrl, isCloud } = require('../../src-shared/src/frigate.ts');

const HTTPS_PAGE = { origin: 'https://192.168.1.5:8082', protocol: 'https:' };
const HTTP_PAGE = { origin: 'http://192.168.1.5:8081', protocol: 'http:' };

describe('frigate', () => {
    it('builds the stream URL of the web extension', () => {
        assert.equal(
            frigateStreamUrl(
                { url: 'https://192.168.1.5:8443/', route: 'frigate.0/' },
                'frigate.0',
                'Haustuer',
                { fps: 5, height: 480 },
                HTTPS_PAGE,
            ),
            'https://192.168.1.5:8443/frigate.0/Haustuer/stream.mjpeg?fps=5&height=480',
        );
    });

    it('takes the default route of the instance and a relative URL on the same origin', () => {
        assert.equal(
            frigateStreamUrl({ url: 'https://192.168.1.5:8082' }, 'frigate.1', 'garden', {}, HTTPS_PAGE),
            '/frigate.1/garden/stream.mjpeg',
        );
    });

    it('gives no stream that the page cannot load', () => {
        // an https page does not load pictures over http
        assert.equal(frigateStreamUrl({ url: 'http://192.168.1.5:8082' }, 'frigate.0', 'a', {}, HTTPS_PAGE), null);
        assert.equal(
            frigateStreamUrl({ url: 'http://192.168.1.5:8082' }, 'frigate.0', 'a', {}, HTTP_PAGE),
            'http://192.168.1.5:8082/frigate.0/a/stream.mjpeg',
        );
        // the adapter knows no web instance
        assert.equal(frigateStreamUrl({ reason: 'disabled' }, 'frigate.0', 'a', {}, HTTPS_PAGE), null);
        assert.equal(frigateStreamUrl(null, 'frigate.0', 'a', {}, HTTPS_PAGE), null);
    });

    it('detects the ioBroker cloud', () => {
        assert.ok(isCloud('iobroker.pro'));
        assert.ok(isCloud('eu.iobroker.net'));
        assert.ok(!isCloud('192.168.1.5'));
        assert.ok(!isCloud('myiobroker.pro.example.com'));
    });
});

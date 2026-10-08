const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { X509Certificate, createPrivateKey } = require('node:crypto');
const {
    generateCertificate,
    getFingerprint,
    getSubjectAltNames,
    getUncoveredHosts,
    CERT_COMMON_NAME,
} = require('../../build/lib/certificate');

// Computed with: openssl x509 -in test/fixtures/cert.pem -noout -fingerprint -sha256
const OPENSSL_FINGERPRINT =
    '8C:88:E2:AA:56:A2:F3:40:F0:48:90:83:1C:8F:CA:59:1F:6D:0C:A5:27:FF:DB:7A:10:5E:9B:4D:65:4C:91:E6';

describe('certificate', () => {
    let cert;
    before(() => {
        cert = generateCertificate(['192.168.1.10', 'iobroker.local', '192.168.1.10', ' ']);
    });

    it('fingerprint matches openssl (fixed test vector)', () => {
        const pem = readFileSync(join(__dirname, '..', 'fixtures', 'cert.pem'), 'utf8');
        assert.equal(getFingerprint(pem), OPENSSL_FINGERPRINT);
    });

    it('fingerprint has the format AB:CD:…', () => {
        assert.match(cert.certFingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
        assert.equal(cert.certFingerprint, getFingerprint(cert.certPublic));
    });

    it('can be parsed and has the right subject', () => {
        const x509 = new X509Certificate(cert.certPublic);
        assert.equal(x509.subject, `CN=${CERT_COMMON_NAME}`);
        assert.equal(x509.issuer, `CN=${CERT_COMMON_NAME}`);
        assert.equal(x509.ca, false);
    });

    it('has typed SAN entries without duplicates', () => {
        const x509 = new X509Certificate(cert.certPublic);
        assert.equal(x509.subjectAltName, 'IP Address:192.168.1.10, DNS:iobroker.local');
        assert.deepEqual(getSubjectAltNames(cert.certPublic), ['192.168.1.10', 'iobroker.local']);
    });

    it('is valid for 10 years', () => {
        const x509 = new X509Certificate(cert.certPublic);
        const from = new Date(x509.validFrom).getTime();
        const to = new Date(x509.validTo).getTime();
        const years = (to - from) / (365.25 * 24 * 3600 * 1000);
        assert.ok(years > 9.99 && years < 10.01, `validity is ${years} years`);
        assert.ok(from < Date.now());
    });

    it('private key is RSA 2048 and belongs to the certificate', () => {
        const key = createPrivateKey(cert.certPrivate);
        assert.equal(key.asymmetricKeyType, 'rsa');
        assert.equal(key.asymmetricKeyDetails.modulusLength, 2048);
        assert.equal(new X509Certificate(cert.certPublic).checkPrivateKey(key), true);
    });

    it('uses random serial numbers', () => {
        const other = generateCertificate(['10.0.0.1']);
        assert.notEqual(
            new X509Certificate(other.certPublic).serialNumber,
            new X509Certificate(cert.certPublic).serialNumber,
        );
    });

    it('reports hosts that are not in the SAN', () => {
        assert.deepEqual(getUncoveredHosts(cert.certPublic, ['192.168.1.10', '10.1.1.1']), ['10.1.1.1']);
    });

    it('requires at least one host', () => {
        assert.throws(() => generateCertificate([]));
    });
});

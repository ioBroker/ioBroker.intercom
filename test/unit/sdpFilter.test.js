const assert = require('node:assert/strict');

// Plain TypeScript without imports at runtime: Node.js >= 22.18 strips the types itself
const { filterSdp } = require('../../src-www/src/sdpFilter.ts');

const FB = ['goog-remb', 'transport-cc', 'ccm fir', 'nack', 'nack pli'];

/** Video codec with its rtcp-fb lines and its rtx, as Chrome offers it */
function video(pt, name, fmtp) {
    return [
        `a=rtpmap:${pt} ${name}/90000`,
        ...FB.map(fb => `a=rtcp-fb:${pt} ${fb}`),
        ...(fmtp ? [`a=fmtp:${pt} ${fmtp}`] : []),
        `a=rtpmap:${pt + 1} rtx/90000`,
        `a=fmtp:${pt + 1} apt=${pt}`,
    ];
}

const VIDEO = [
    [96, 'VP8', ''],
    [98, 'VP9', 'profile-id=0'],
    [100, 'VP9', 'profile-id=2'],
    [102, 'H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f'],
    [104, 'H264', 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f'],
    [106, 'H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'],
    [108, 'H264', 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f'],
    [110, 'H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f'],
    [112, 'H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f'],
    [114, 'AV1', 'level-idx=5;profile=0;tier=0'],
    [116, 'H265', 'level-id=93;profile-id=1;tier-flag=0;tx-mode=SRST'],
];

const EXTENSIONS = [
    'urn:ietf:params:rtp-hdrext:toffset',
    'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
    'urn:3gpp:video-orientation',
    'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
    'http://www.webrtc.org/experiments/rtp-hdrext/playout-delay',
    'http://www.webrtc.org/experiments/rtp-hdrext/video-content-type',
    'http://www.webrtc.org/experiments/rtp-hdrext/video-timing',
    'http://www.webrtc.org/experiments/rtp-hdrext/color-space',
    'urn:ietf:params:rtp-hdrext:sdes:mid',
    'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id',
    'urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id',
];

const SDP = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0 1',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
    'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
    'a=extmap:9 urn:ietf:params:rtp-hdrext:sdes:mid',
    'a=sendrecv',
    'a=rtpmap:111 opus/48000/2',
    'a=rtcp-fb:111 transport-cc',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
    'a=rtpmap:9 G722/8000',
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:8 PCMA/8000',
    'a=rtpmap:13 CN/8000',
    'a=rtpmap:110 telephone-event/48000',
    'a=rtpmap:126 telephone-event/8000',
    `m=video 9 UDP/TLS/RTP/SAVPF ${VIDEO.flatMap(([pt]) => [pt, pt + 1]).join(' ')}`,
    'c=IN IP4 0.0.0.0',
    'a=mid:1',
    ...EXTENSIONS.map((uri, i) => `a=extmap:${i + 2} ${uri}`),
    'a=sendrecv',
    ...VIDEO.flatMap(([pt, name, fmtp]) => video(pt, name, fmtp)),
    'a=ssrc-group:FID 1111 2222',
    'a=ssrc:1111 cname:abc',
    '',
].join('\r\n');

/** The media section of a kind */
function section(sdp, kind) {
    const lines = sdp.split('\r\n');
    const start = lines.findIndex(line => line.startsWith(`m=${kind} `));
    const end = lines.findIndex((line, i) => i > start && line.startsWith('m='));
    return lines.slice(start, end < 0 ? undefined : end);
}

const attributes = lines => lines.filter(line => line.startsWith('a=')).length;

describe('sdpFilter', () => {
    const filtered = filterSdp(SDP);

    it('keeps the audio codecs of Asterisk', () => {
        const audio = section(filtered, 'audio');
        assert.equal(audio[0], 'm=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8 110 126');
        assert.ok(!audio.some(line => /^a=(rtpmap|fmtp):(63|13) /.test(line)));
        assert.ok(audio.includes('a=fmtp:111 minptime=10;useinbandfec=1'));
    });

    it('keeps VP8, VP9 profile 0 and baseline H.264 with packetization mode 1', () => {
        const lines = section(filtered, 'video');
        assert.equal(lines[0], 'm=video 9 UDP/TLS/RTP/SAVPF 96 98 102 106');
        // no rtcp-fb or fmtp of a removed payload type is left
        for (const line of lines) {
            const pt = line.match(/^a=(?:rtpmap|fmtp|rtcp-fb):(\d+) /)?.[1];
            if (pt) {
                assert.ok(['96', '98', '102', '106'].includes(pt), line);
            }
        }
    });

    it('keeps only the header extensions Asterisk knows', () => {
        const extmaps = section(filtered, 'video').filter(line => line.startsWith('a=extmap:'));
        assert.deepEqual(extmaps, [
            'a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
            'a=extmap:5 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
            'a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:mid',
        ]);
    });

    it('fits the attribute limit of pjproject', () => {
        assert.ok(attributes(section(SDP, 'video')) > 68);
        assert.ok(attributes(section(filtered, 'video')) <= 40);
    });

    it('keeps the session part, the line ends and the other lines', () => {
        assert.ok(filtered.startsWith('v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\n'));
        assert.ok(filtered.includes('a=group:BUNDLE 0 1\r\n'));
        assert.ok(filtered.includes('a=ssrc-group:FID 1111 2222\r\n'));
        assert.ok(filtered.endsWith('a=ssrc:1111 cname:abc\r\n'));
    });

    it('leaves a media line alone that would lose all its codecs', () => {
        const sdp = 'v=0\nm=video 9 UDP/TLS/RTP/SAVPF 114\na=rtpmap:114 AV1/90000\n';
        assert.equal(filterSdp(sdp), sdp);
    });
});

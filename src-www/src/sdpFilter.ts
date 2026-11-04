/**
 * Shortens the SDP of the browser for Asterisk.
 *
 * Chrome offers on the video line VP8, VP9 in several profiles, around eight H.264 profiles, AV1, H.265, each with
 * rtx, plus red and ulpfec - every codec with five rtcp-fb lines - and a dozen header extensions. pjproject in
 * Asterisk stores only a fixed number of attributes per media line (often 68): the rest is dropped with
 * "PJ_ETOOMANY", among them rtpmap lines, and the whole offer is rejected with "PJMEDIA_SDP_EMISSINGRTPMAP".
 *
 * So only what Asterisk can pass on is sent: the codecs of the adapter (opus, G.722, G.711, VP8, H.264, VP9) and the
 * header extensions it knows. The local description of the browser is not changed: the other side picks from a
 * part of what it offers, which is always allowed.
 *
 * No imports, so the unit tests run it as it is.
 */

/** Codecs Asterisk can pass on, as in the rtpmap lines (lower case) */
const KEEP_CODECS = ['opus', 'g722', 'pcmu', 'pcma', 'telephone-event', 'vp8', 'vp9', 'h264'];

/** Header extensions Asterisk negotiates; all other ones would only be refused */
const KEEP_EXTENSIONS = [
    'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
    'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
    'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
    'urn:ietf:params:rtp-hdrext:sdes:mid',
];

/** Attributes that belong to one payload type: `a=rtpmap:96 VP8/90000` */
const PAYLOAD_ATTRIBUTE = /^a=(rtpmap|fmtp|rtcp-fb):(\d+)[\s]/;

function fmtpParams(fmtp: string | undefined): Record<string, string> {
    const params: Record<string, string> = {};
    for (const part of (fmtp || '').split(';')) {
        const [key, value] = part.split('=');
        if (key?.trim()) {
            params[key.trim().toLowerCase()] = (value || '').trim().toLowerCase();
        }
    }
    return params;
}

/** Whether a payload type of the browser is worth sending */
function keepPayload(codec: string | undefined, fmtp: string | undefined, payload: number): boolean {
    if (codec === undefined) {
        // a static payload type without rtpmap, e.g. 0 (PCMU) or 8 (PCMA)
        return payload < 96;
    }
    if (!KEEP_CODECS.includes(codec)) {
        return false;
    }
    const params = fmtpParams(fmtp);
    if (codec === 'h264') {
        // (constrained) baseline with packetization mode 1, as door intercoms send it
        return params['packetization-mode'] === '1' && (params['profile-level-id'] || '').startsWith('42');
    }
    if (codec === 'vp9') {
        return !params['profile-id'] || params['profile-id'] === '0';
    }
    return true;
}

/** One media section: `m=` line and its attributes */
function filterMedia(lines: string[]): string[] {
    const m = lines[0].split(' ');
    // m=<media> <port> <proto> <payload types...>
    if (m.length < 4 || !/^m=(audio|video)$/.test(m[0])) {
        return lines;
    }
    const codecs = new Map<number, string>();
    const fmtps = new Map<number, string>();
    for (const line of lines) {
        const rtpmap = line.match(/^a=rtpmap:(\d+) ([^/\s]+)/);
        if (rtpmap) {
            codecs.set(Number(rtpmap[1]), rtpmap[2].toLowerCase());
        }
        const fmtp = line.match(/^a=fmtp:(\d+) (.*)$/);
        if (fmtp) {
            fmtps.set(Number(fmtp[1]), fmtp[2]);
        }
    }
    const payloads = m.slice(3);
    const kept = payloads.filter(pt => keepPayload(codecs.get(Number(pt)), fmtps.get(Number(pt)), Number(pt)));
    // nothing the other side could take: better the long offer than an empty media line
    if (!kept.some(pt => codecs.get(Number(pt)) !== 'telephone-event')) {
        return lines;
    }
    const keep = new Set(kept.map(Number));

    return [
        [...m.slice(0, 3), ...kept].join(' '),
        ...lines.slice(1).filter(line => {
            const attribute = line.match(PAYLOAD_ATTRIBUTE);
            if (attribute) {
                return keep.has(Number(attribute[2]));
            }
            const extmap = line.match(/^a=extmap:\S+ (\S+)/);
            if (extmap) {
                return KEEP_EXTENSIONS.includes(extmap[1]);
            }
            return true;
        }),
    ];
}

/** The SDP without the codecs and header extensions Asterisk cannot use */
export function filterSdp(sdp: string): string {
    const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
    const lines = sdp.split(/\r?\n/);
    const sections: string[][] = [[]];
    for (const line of lines) {
        if (line.startsWith('m=')) {
            sections.push([]);
        }
        sections[sections.length - 1].push(line);
    }
    return [sections[0], ...sections.slice(1).map(filterMedia)].flat().join(eol);
}

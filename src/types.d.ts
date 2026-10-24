export type SubscriberKind = 'webrtc' | 'sip';

export interface Subscriber {
    /** Extension number, `^[0-9]{2,6}$` */
    extension: string;
    /** Display name (CallerID) */
    name: string;
    kind: SubscriberKind;
    /** Encrypted by admin (`encryptedAttributes` of the table) */
    password: string;
    enabled: boolean;
}

/** Ring group (table "Groups"): one number that rings several subscribers at once */
export interface RingGroup {
    enabled: boolean;
    /** Number of the group, `^[0-9]{2,6}$`, not used by a subscriber */
    extension: string;
    name: string;
    /** Extensions of the members, selected from the subscribers (a string with commas is also accepted) */
    members: string[] | string;
    /** Seconds until the call is given up */
    ringTime: number | string;
}

/** Camera of the snapshot proxy (table "Cameras") */
export interface CameraEntry {
    enabled: boolean;
    /** Becomes the object ID `cameras.<name>` */
    name: string;
    url: string;
    auth: 'none' | 'basic' | 'apikey' | 'bearer';
    user: string;
    /** Password, API key or token. Encrypted by admin (`encryptedAttributes` of the table) */
    password: string;
    /** Accept self-signed certificates */
    insecure: boolean;
    /** Seconds between two pictures during a call */
    interval: number | string;
    /** Seconds between two pictures without a call, 0 = none */
    idleInterval: number | string;
}

export type Codec = 'opus' | 'g722' | 'ulaw' | 'alaw';
/** Asterisk cannot transcode video: both parties need a common codec */
export type VideoCodec = 'vp8' | 'h264' | 'vp9';

export interface AsteriskAdapterConfig {
    /** Directory with the generated files. Filled with the data directory of the instance on the first start */
    configDir: string;

    /** Run Asterisk in a Docker container managed by the adapter */
    dockerEnabled: boolean;
    /** Stop the container when the instance stops */
    dockerStopOnUnload: boolean;

    amiHost: string;
    amiPort: number | string;
    /** Encrypted and protected */
    amiSecret: string;

    wssPort: number | string;
    rtpStart: number | string;
    rtpEnd: number | string;
    stunServer: string;
    /** Public address for clients outside the LAN (optional) */
    externalAddress: string;
    /** Networks that must not appear in ICE candidates, comma separated */
    iceDenylist: string;
    codecs: Codec[];
    /** Empty: audio only */
    videoCodecs: VideoCodec[];
    echoTest: boolean;
    /** What Asterisk writes into its log, forwarded to the ioBroker log */
    asteriskLogLevel: 'none' | 'errors' | 'notice' | 'verbose' | 'debug';
    /** Log every SIP message (pjsip set logger on) */
    sipTrace: boolean;
    testPage: boolean;

    certSource: 'self' | 'iobroker';
    certHosts: string[];
    certPublic: string;
    /** Encrypted and protected */
    certPrivate: string;
    certFingerprint: string;
    /** Names of certificates in `system.certificates` */
    certIobPublic: string;
    certIobPrivate: string;
    certIobChained: string;

    subscribers: Subscriber[];
    groups: RingGroup[];
    /** Snapshot proxy */
    cameras: CameraEntry[];
    /** The passwords of `subscribers` are still clear text (default subscribers of io-package.json) */
    subscribersPlain?: boolean;
}

declare global {
    namespace ioBroker {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface AdapterConfig extends AsteriskAdapterConfig {}
    }
}

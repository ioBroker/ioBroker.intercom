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

export type Codec = 'opus' | 'g722' | 'ulaw' | 'alaw';

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
    echoTest: boolean;
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
}

declare global {
    namespace ioBroker {
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        interface AdapterConfig extends AsteriskAdapterConfig {}
    }
}

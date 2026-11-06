/** Tag of the custom element; a host checks that the module defines exactly this one */
export const TAG = 'iob-intercom-phone';

/** The built module, next to its manifest */
export const MODULE_FILE = 'intercom-phone.js';

/** The manifest the build writes next to the module; `common.webComponents` names this one */
export const MANIFEST_FILE = 'intercom-phone.json';

/** Where `tasks.mts` puts the module in the admin folder; the React import is relative to it */
export const MODULE_PATH = `webcomponents/${MODULE_FILE}`;

/** The devices widget whose name and description the component takes over (`common.deviceWidgets`) */
export const DEVICES_WIDGET = 'IntercomPhoneComponent';

/**
 * The words the element shows: keys of the dictionary of the phone (`src-shared/i18n/`), picked by the build into
 * the module (`words.ts`)
 */
export const ELEMENT_WORDS = [
    'phone_widget',
    'offline',
    'connecting',
    'registered',
    'error',
    'preview',
    'editor_preview',
    'signed_in_as',
    'number',
    'call',
    'video_call',
    'hangup',
    'answer',
    'answer_video',
    'decline',
    'mute',
    'unmute',
    'camera_on',
    'camera_off',
    'camera',
    'switch_picture',
    'keypad',
    'backspace',
    'incoming',
    'incoming_video',
    'calling',
    'connected',
    'click_sound',
    'insecure',
    'no_config',
    'no_wss',
    'cert_hint',
    'accept_cert',
    'mic_denied',
    'mic_missing',
] as const;

export type WordKey = (typeof ELEMENT_WORDS)[number];

/**
 * How the element shows the phone: `auto` by the size of its box - the whole phone in a large box, a tile in a small
 * one -, `tile` always as a tile whose click opens the phone in a dialog, `phone` always as the whole phone
 */
export type PhoneLayout = 'auto' | 'tile' | 'phone';

export const LAYOUTS: PhoneLayout[] = ['auto', 'tile', 'phone'];

/**
 * The values of the settings of the manifest; a setting without a value is missing. The names are those of the
 * vis-2 widget and the devices tile, so `src-shared/src/phoneSettings.ts` reads them as they are.
 */
export type PhoneElementSettings = {
    layout?: PhoneLayout;
    title?: string;
    instance?: string;
    extension?: string;
    password?: string;
    wssUrl?: string;
    number?: string;
    numberLabel?: string;
    showKeypad?: boolean;
    popup?: boolean;
    video?: boolean;
    useCamera?: boolean;
    sendCamera?: boolean;
    cameraSource?: 'url' | 'frigate';
    cameraUrl?: string;
    cameraOid?: string;
    cameraFrigateInstance?: string;
    cameraFrigateCamera?: string;
    cameraFrigateMode?: 'snapshot' | 'stream';
    cameraRefresh?: number;
    cameraAlways?: boolean;
    camera2Source?: 'url' | 'frigate';
    camera2Url?: string;
    camera2Oid?: string;
    camera2FrigateInstance?: string;
    camera2FrigateCamera?: string;
    camera2FrigateMode?: 'snapshot' | 'stream';
    camera2Refresh?: number;
    actionLabel?: string;
    actionDtmf?: string;
    actionOid?: string;
};

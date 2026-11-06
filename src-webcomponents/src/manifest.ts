/**
 * The manifest of `<iob-intercom-phone>`. Read by the build only (`vite.config.ts`), which writes it as
 * `intercom-phone.json` next to the module - a host reads that file for its palette and its settings without loading
 * the module.
 *
 * Most words come from the native widgets: the name and the description from the devices widget in
 * `io-package.json`, the labels from `src-shared/i18n/`, which the vis-2 widget and the devices tile use as well. The
 * build reads them; only the words for what is new here live in this file.
 */
import type { WebComponentManifest, WebComponentSetting, WebComponentText } from '@iobroker/web-components';

// with the extension: `vite.config.ts` imports this file, and Vite may load its config natively
import { MODULE_FILE, TAG } from './constants.ts';

export { MANIFEST_FILE, MODULE_FILE, MODULE_PATH, TAG } from './constants.ts';

/** The words of the native widgets, read by the build */
export interface ManifestTexts {
    /**
     * `label` of the devices widget in `io-package.json`. The same name, per language, makes vis-2 and devices
     * offer the native widget instead of this component
     */
    name: WebComponentText;
    /** `description` of the devices widget in `io-package.json` */
    description: WebComponentText;
    /** A word of the phone (`src-shared/i18n/`, without the prefix `intercom_`) in every language */
    word: (key: string) => WebComponentText;
}

const LAYOUT: WebComponentText = {
    en: 'Layout',
    de: 'Darstellung',
    ru: 'Вид',
    pt: 'Layout',
    nl: 'Weergave',
    fr: 'Affichage',
    it: 'Layout',
    es: 'Diseño',
    pl: 'Układ',
    uk: 'Вигляд',
    'zh-cn': '布局',
};

const LAYOUT_HELP: WebComponentText = {
    en: 'Automatic: the whole phone in a large box, a tile in a small one. A click on the tile opens the phone',
    de: 'Automatisch: das ganze Telefon in einem großen Feld, eine Kachel in einem kleinen. Ein Klick auf die Kachel öffnet das Telefon',
    ru: 'Автоматически: весь телефон в большом поле, плитка в маленьком. Нажатие на плитку открывает телефон',
    pt: 'Automático: o telefone completo numa caixa grande, um mosaico numa pequena. Um clique no mosaico abre o telefone',
    nl: 'Automatisch: de hele telefoon in een groot vak, een tegel in een klein vak. Een klik op de tegel opent de telefoon',
    fr: 'Automatique : le téléphone complet dans une grande zone, une tuile dans une petite. Un clic sur la tuile ouvre le téléphone',
    it: 'Automatico: il telefono intero in un riquadro grande, una piastrella in uno piccolo. Un clic sulla piastrella apre il telefono',
    es: 'Automático: el teléfono completo en un recuadro grande, un mosaico en uno pequeño. Un clic en el mosaico abre el teléfono',
    pl: 'Automatycznie: cały telefon w dużym polu, kafelek w małym. Kliknięcie kafelka otwiera telefon',
    uk: 'Автоматично: весь телефон у великому полі, плитка в малому. Натискання на плитку відкриває телефон',
    'zh-cn': '自动：大区域显示完整电话，小区域显示磁贴。点击磁贴可打开电话',
};

const LAYOUT_AUTO: WebComponentText = {
    en: 'Automatic',
    de: 'Automatisch',
    ru: 'Автоматически',
    pt: 'Automático',
    nl: 'Automatisch',
    fr: 'Automatique',
    it: 'Automatico',
    es: 'Automático',
    pl: 'Automatycznie',
    uk: 'Автоматично',
    'zh-cn': '自动',
};

const LAYOUT_TILE: WebComponentText = {
    en: 'Tile',
    de: 'Kachel',
    ru: 'Плитка',
    pt: 'Mosaico',
    nl: 'Tegel',
    fr: 'Tuile',
    it: 'Piastrella',
    es: 'Mosaico',
    pl: 'Kafelek',
    uk: 'Плитка',
    'zh-cn': '磁贴',
};

/** Where the password is stored depends on the host, unlike in vis-2 (`password_tooltip`) and devices */
const PASSWORD_HELP: WebComponentText = {
    en: 'Password of the subscriber in the adapter settings. Stored with the settings of this element: everybody who can read them can read it',
    de: 'Passwort des Teilnehmers aus den Adaptereinstellungen. Wird mit den Einstellungen dieses Elements gespeichert: Wer sie lesen kann, kann es lesen',
    ru: 'Пароль абонента из настроек адаптера. Хранится вместе с настройками этого элемента: каждый, кто может их прочитать, может прочитать и его',
    pt: 'Senha do assinante nas configurações do adaptador. Guardada com as configurações deste elemento: quem as puder ler, pode lê-la',
    nl: 'Wachtwoord van de deelnemer uit de adapterinstellingen. Wordt opgeslagen met de instellingen van dit element: wie ze kan lezen, kan het lezen',
    fr: "Mot de passe de l'abonné dans les paramètres de l'adaptateur. Enregistré avec les paramètres de cet élément : quiconque peut les lire peut le lire",
    it: "Password dell'utente nelle impostazioni dell'adattatore. Salvata con le impostazioni di questo elemento: chi può leggerle può leggerla",
    es: 'Contraseña del abonado en la configuración del adaptador. Se guarda con la configuración de este elemento: quien pueda leerla puede leerla',
    pl: 'Hasło abonenta z ustawień adaptera. Jest zapisywane razem z ustawieniami tego elementu: każdy, kto ma do nich dostęp, może je odczytać',
    uk: 'Пароль абонента з налаштувань адаптера. Зберігається разом із налаштуваннями цього елемента: кожен, хто може їх прочитати, може прочитати і його',
    'zh-cn': '适配器设置中用户的密码。与此元素的设置一起保存：能读取这些设置的人都能读取它',
};

/** The devices tile offers the cameras of the instance (`selectSendTo`), which not every host can show */
const FRIGATE_CAMERA_HELP: WebComponentText = {
    en: 'Name of the camera in Frigate',
    de: 'Name der Kamera in Frigate',
    ru: 'Имя камеры в Frigate',
    pt: 'Nome da câmera no Frigate',
    nl: 'Naam van de camera in Frigate',
    fr: 'Nom de la caméra dans Frigate',
    it: 'Nome della telecamera in Frigate',
    es: 'Nombre de la cámara en Frigate',
    pl: 'Nazwa kamery we Frigate',
    uk: 'Назва камери у Frigate',
    'zh-cn': 'Frigate 中摄像头的名称',
};

/**
 * The settings of a camera: a URL or a state, or a camera of the frigate adapter - as in the devices tile
 *
 * @param word a word of the phone in every language
 * @param prefix `camera` or `camera2`
 * @param urlHelp help of the URL
 */
function cameraItems(
    word: (key: string) => WebComponentText,
    prefix: 'camera' | 'camera2',
    urlHelp: string,
): Record<string, WebComponentSetting> {
    const notUrl = `data.${prefix}Source === 'frigate'`;
    const notFrigate = `data.${prefix}Source !== 'frigate'`;
    return {
        [`${prefix}Source`]: {
            type: 'select',
            label: word('camera_source'),
            options: [
                { value: 'url', label: word('camera_source_url') },
                { value: 'frigate', label: word('camera_source_frigate') },
            ],
            default: 'url',
        },
        [`${prefix}Url`]: { type: 'text', label: word('camera_url'), help: word(urlHelp), hidden: notUrl },
        [`${prefix}Oid`]: {
            type: 'objectId',
            types: 'state',
            label: word('camera_oid'),
            help: word('camera_oid_tooltip'),
            hidden: notUrl,
        },
        [`${prefix}FrigateInstance`]: {
            type: 'instance',
            adapter: 'frigate',
            default: 'frigate.0',
            label: word('frigate_instance'),
            hidden: notFrigate,
        },
        [`${prefix}FrigateCamera`]: {
            type: 'text',
            label: word('frigate_camera'),
            help: FRIGATE_CAMERA_HELP,
            hidden: notFrigate,
        },
        [`${prefix}FrigateMode`]: {
            type: 'select',
            label: word('frigate_mode'),
            help: word('frigate_mode_tooltip'),
            options: [
                { value: 'snapshot', label: word('frigate_snapshot') },
                { value: 'stream', label: word('frigate_stream') },
            ],
            default: 'snapshot',
            hidden: notFrigate,
        },
        [`${prefix}Refresh`]: {
            type: 'number',
            label: word('camera_refresh'),
            help: word('camera_refresh_tooltip'),
            min: 0,
            max: 60,
            default: 1,
            // the stream moves by itself
            hidden: `${notUrl} && data.${prefix}FrigateMode === 'stream'`,
        },
    };
}

/**
 * The manifest with the words of the native widgets
 *
 * @param texts what the build read from `io-package.json` and the dictionary
 */
export function buildManifest(texts: ManifestTexts): WebComponentManifest {
    const { word } = texts;
    return {
        $schema: 'https://raw.githubusercontent.com/ioBroker/web-components/main/schemas/manifest.json',
        manifestVersion: 1,
        tag: TAG,
        name: texts.name,
        description: texts.description,
        // relative to this file: /adapter/intercom/intercom.svg
        icon: '../intercom.svg',
        module: MODULE_FILE,
        // a tile of a dashboard, as the 2x1 tile of the devices app: the state and the picture of the door. A box
        // from 240 x 300 px on shows the whole phone
        size: { width: 320, height: 160 },
        settings: {
            type: 'panel',
            items: {
                layout: {
                    type: 'select',
                    label: LAYOUT,
                    help: LAYOUT_HELP,
                    options: [
                        { value: 'auto', label: LAYOUT_AUTO },
                        { value: 'tile', label: LAYOUT_TILE },
                        { value: 'phone', label: word('phone_widget') },
                    ],
                    default: 'auto',
                },
                title: { type: 'text', label: word('title'), help: word('title_tooltip') },
                instance: { type: 'instance', adapter: 'intercom', default: 'intercom.0', label: word('instance') },
                extension: { type: 'text', label: word('extension'), default: '100' },
                password: { type: 'password', label: word('password'), help: PASSWORD_HELP },
                wssUrl: { type: 'text', label: word('wss_url'), help: word('wss_url_tooltip') },

                _call: { type: 'header', text: word('group_call') },
                number: { type: 'text', label: word('number'), help: word('number_tooltip') },
                numberLabel: { type: 'text', label: word('number_label') },
                showKeypad: { type: 'checkbox', label: word('show_keypad'), default: true },
                popup: { type: 'checkbox', label: word('popup'), default: true },
                video: { type: 'checkbox', label: word('video_calls'), default: true },
                useCamera: {
                    type: 'checkbox',
                    label: word('use_camera'),
                    help: word('use_camera_tooltip'),
                    default: false,
                    hidden: 'data.video === false',
                },
                sendCamera: {
                    type: 'checkbox',
                    label: word('send_camera'),
                    default: false,
                    hidden: 'data.video === false || !data.useCamera',
                },

                _camera: { type: 'header', text: word('group_camera') },
                ...cameraItems(word, 'camera', 'camera_url_tooltip'),
                cameraAlways: { type: 'checkbox', label: word('camera_always'), default: false },

                _camera2: { type: 'header', text: word('group_camera2') },
                ...cameraItems(word, 'camera2', 'camera2_url_tooltip'),

                _action: { type: 'header', text: word('group_action') },
                actionLabel: { type: 'text', label: word('action_label'), help: word('action_label_tooltip') },
                actionDtmf: { type: 'text', label: word('action_dtmf'), hidden: '!data.actionLabel' },
                actionOid: {
                    type: 'objectId',
                    types: 'state',
                    label: word('action_oid'),
                    hidden: '!data.actionLabel',
                },
            },
        },
    };
}

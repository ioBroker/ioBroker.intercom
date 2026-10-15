/**
 * The phones of this page. One registry per bundle: the widget set of vis-2 and the plugin of the devices app are
 * never loaded into the same page, and inside a bundle the widgets and the service share this module.
 */
import { SipPhone } from '../../src-www/src/SipPhone';
import { PhoneRegistry } from './phoneRegistry';

export const phones = new PhoneRegistry<SipPhone>(config => {
    const phone = new SipPhone({
        wssUrl: config.wssUrl,
        domain: new URL(config.wssUrl.replace(/^ws/, 'http')).hostname,
        video: config.video,
        camera: config.camera,
    });
    phone.login(config.extension, config.password);
    return phone;
});

// the browser plays the ring tone only after the first click or key into the page
const unlockAudio = (): void => phones.unlockAudio();
document.addEventListener('pointerdown', unlockAudio, true);
document.addEventListener('keydown', unlockAudio, true);

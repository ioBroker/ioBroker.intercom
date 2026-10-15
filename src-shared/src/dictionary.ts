/**
 * The words of the phone, for the widget set of vis-2 and for the plugin of the devices app.
 *
 * The keys carry no prefix: vis-2 adds `intercom_` itself to a set with `prefix: true`, the devices app adds
 * nothing - its translations get the prefix from {@link prefixed}. Either way the code asks for `intercom_<key>`.
 */
import en from '../i18n/en.json';
import de from '../i18n/de.json';
import ru from '../i18n/ru.json';
import pt from '../i18n/pt.json';
import nl from '../i18n/nl.json';
import fr from '../i18n/fr.json';
import it from '../i18n/it.json';
import es from '../i18n/es.json';
import pl from '../i18n/pl.json';
import uk from '../i18n/uk.json';
import zhCn from '../i18n/zh-cn.json';

import { ADAPTER } from './phoneSettings';

type Words = Record<string, string>;

export const dictionary: Record<ioBroker.Languages, Words> = { en, de, ru, pt, nl, fr, it, es, pl, uk, 'zh-cn': zhCn };

/** The dictionary with the keys as the code asks for them */
export function prefixed(): Record<ioBroker.Languages, Words> {
    const result = {} as Record<ioBroker.Languages, Words>;
    for (const [lang, words] of Object.entries(dictionary) as [ioBroker.Languages, Words][]) {
        result[lang] = Object.fromEntries(Object.entries(words).map(([key, text]) => [`${ADAPTER}_${key}`, text]));
    }
    return result;
}

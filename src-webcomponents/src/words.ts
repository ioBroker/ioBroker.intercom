/**
 * The words the element shows, picked out of the dictionary of the phone (`src-shared/i18n/`) at build time
 * (`vite.config.ts`): the whole dictionary holds the labels of the settings too, which the manifest carries. The keys
 * are those of the dictionary, without the prefix `intercom_`.
 */
import type { WordKey } from './constants';

declare const __INTERCOM_WORDS__: Partial<Record<ioBroker.Languages, Record<string, string>>>;

/**
 * A word in one language, English if it has no translation
 *
 * @param key key of the dictionary, one of `ELEMENT_WORDS`
 * @param lang the language of the system
 */
export function word(key: WordKey, lang: ioBroker.Languages): string {
    return __INTERCOM_WORDS__[lang]?.[key] || __INTERCOM_WORDS__.en?.[key] || key;
}

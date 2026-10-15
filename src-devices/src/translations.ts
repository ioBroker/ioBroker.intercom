/**
 * The words of the plugin, as the devices app loads them: it hands them to `I18n.extendTranslations` unchanged, so
 * the keys get the prefix `intercom_` here (vis-2 adds it itself).
 */
import { prefixed } from '../../src-shared/src/dictionary';

export default prefixed();

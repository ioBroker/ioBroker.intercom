import { dictionary } from '../../src-shared/src/dictionary';

// vis-2 prefixes the keys with "intercom_"
const translations = { ...dictionary, prefix: true };

export default translations;

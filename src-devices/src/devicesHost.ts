import { I18n } from '@iobroker/gui-components';
import type { IStateContext } from '@iobroker/dm-widgets';

import { ADAPTER, type PhoneHost } from '../../src-shared/src/phoneSettings';

/** Name of the tile in `common.deviceWidgets.components` */
export const PHONE_COMPONENT = 'IntercomPhoneComponent';

/** The states of ioBroker through the devices app */
export function createHost(stateContext: IStateContext): PhoneHost {
    return {
        getState: id => stateContext.getSocket().getState(id),
        setState: (id, value) => stateContext.getSocket().setState(id, value),
        subscribeState: (id, handler) => {
            const onChange = (_id: string, state: ioBroker.State): void => handler(state);
            stateContext.getState(id, onChange);
            return () => stateContext.removeState(id, onChange);
        },
        sendTo: (instance, command, data) => stateContext.getSocket().sendTo(instance, command, data),
    };
}

/** The devices app adds no prefix to the translations; see translations.ts */
export const t = (key: string): string => I18n.t(`${ADAPTER}_${key}`);

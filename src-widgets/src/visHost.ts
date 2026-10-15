import type { Connection } from '@iobroker/gui-components';

import type { PhoneHost } from '../../src-shared/src/phoneSettings';

/** Template of the phone widget in the vis-2 project */
export const PHONE_TPL = 'tplAsteriskPhone';

/** The states of ioBroker through the socket of vis-2 */
export function createHost(socket: Connection): PhoneHost {
    return {
        getState: id => socket.getState(id),
        setState: (id, value) => socket.setState(id, value),
        subscribeState: (id, handler) => {
            const onChange: ioBroker.StateChangeHandler = (_id, state) => handler(state);
            void socket.subscribeState(id, onChange);
            return () => socket.unsubscribeState(id, onChange);
        },
    };
}

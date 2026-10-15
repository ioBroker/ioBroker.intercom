/**
 * Background service of the widget set: keeps the phones of all phone widgets of the project registered,
 * whichever view is open, and shows the dialog of a call over any view.
 *
 * vis-2 renders it once in the runtime, next to the views, if it knows `common.visWidgets.<set>.services` of
 * io-package.json. The props are the contract proposed for `@iobroker/types-vis-2`. A vis-2 without services
 * leaves the phones to the widgets, online while their view is rendered ("Render always").
 */
import React, { useMemo } from 'react';
import type { Connection } from '@iobroker/gui-components';
import type VisRxWidget from '@iobroker/types-vis-2/visRxWidget';

import { PhoneService as PhoneServiceCore, type ServicePhone } from '../../src-shared/src/PhoneService';
import { ADAPTER } from '../../src-shared/src/phoneSettings';
import { createHost, PHONE_TPL } from './visHost';

/** A widget of the widget set, somewhere in the project */
export interface VisServiceWidget {
    view: string;
    id: string;
    tpl: string;
    /** As stored in the project: bindings are not resolved */
    data: Record<string, unknown>;
}

export interface VisServiceProps {
    /** The widgets of this set in all views, without the ones hidden from the user */
    widgets: VisServiceWidget[];
    socket: Connection;
}

// the I18n of vis-2 through the base class of the widgets: importing it from gui-components would bundle 600 kB
const t = (key: string): string => (window.visRxWidget as typeof VisRxWidget).t(`${ADAPTER}_${key}`);

export default function PhoneService({ widgets, socket }: VisServiceProps): React.JSX.Element {
    const host = useMemo(() => createHost(socket), [socket]);
    const phones = useMemo(
        (): ServicePhone[] =>
            widgets
                .filter(widget => widget.tpl === PHONE_TPL)
                .map(widget => ({ id: `${widget.view}/${widget.id}`, settings: widget.data })),
        [widgets],
    );
    return (
        <PhoneServiceCore
            phones={phones}
            host={host}
            t={t}
        />
    );
}

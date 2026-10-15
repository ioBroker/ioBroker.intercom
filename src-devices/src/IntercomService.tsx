/**
 * Background service of the plugin: keeps the phones of all phone tiles registered, whichever category is open,
 * and shows the dialog of a call over any of them.
 *
 * The devices app renders it once, next to the category, if it knows `common.deviceWidgets.services` of
 * io-package.json. The props are the contract proposed for `@iobroker/dm-widgets`. A devices app without services
 * leaves the phones to the tiles: online while their category is shown.
 */
import React, { useMemo } from 'react';
import type { CustomWidgetPlugin, IStateContext } from '@iobroker/dm-widgets';

import { PhoneService, type ServicePhone } from '../../src-shared/src/PhoneService';
import { ADAPTER, type PhoneSettings } from '../../src-shared/src/phoneSettings';
import { createHost, PHONE_COMPONENT, t } from './devicesHost';

export interface DevicesServiceProps {
    /** The plugin widgets of this adapter in all categories, without the ones hidden from the user */
    widgets: CustomWidgetPlugin[];
    stateContext: IStateContext;
}

export function IntercomService({ widgets, stateContext }: DevicesServiceProps): React.JSX.Element {
    const host = useMemo(() => createHost(stateContext), [stateContext]);
    const phones = useMemo(
        (): ServicePhone[] =>
            widgets
                .filter(widget => widget.pluginAdapter === ADAPTER && widget.pluginComponent === PHONE_COMPONENT)
                .map(widget => {
                    const settings = widget as unknown as PhoneSettings;
                    // the same title as the tile
                    return { id: widget.id, settings: { ...settings, title: settings.title || widget.name } };
                }),
        [widgets],
    );
    return (
        <PhoneService
            phones={phones}
            host={host}
            t={t}
        />
    );
}

export default IntercomService;

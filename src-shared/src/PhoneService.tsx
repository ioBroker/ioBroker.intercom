/**
 * Background service: keeps the phones of all phone widgets registered, whichever view or category is open, and
 * shows the dialog of a call over any of them.
 *
 * The host (vis-2 or the devices app) renders it once, next to its views, with the settings of all phone widgets
 * of the project. The widgets still acquire their phones as before and get the same ones from the registry; the
 * service only holds them, and as holder it is the one that shows the dialog (see phoneRegistry.ts). A host that
 * knows no services leaves the phones to the widgets: online while they are shown.
 */
import React, { useEffect } from 'react';

import { PhoneDialog } from './PhoneView';
import { getViewOptions, runAction, stateId, type PhoneHost, type PhoneSettings } from './phoneSettings';
import { usePhone, useStateValue } from './usePhone';

export interface ServicePhone {
    /** Unique among the phones of the service, e.g. the id of the widget */
    id: string;
    settings: PhoneSettings;
}

export interface PhoneServiceProps {
    phones: ServicePhone[];
    host: PhoneHost;
    t: (key: string) => string;
}

function ServicePhoneDialog(props: {
    settings: PhoneSettings;
    host: PhoneHost;
    t: (key: string) => string;
}): React.JSX.Element {
    const { settings, host, t } = props;
    const { handle, problem, certUrl } = usePhone(host, settings, true);
    const cameraValue = useStateValue(host, stateId(settings.cameraOid));
    const extension = String(settings.extension || '');

    useEffect(() => {
        // the widget shows it; the service has nothing to show until a call comes
        if (problem) {
            console.warn(`Phone ${extension || '?'} not started: ${t(problem)}`);
        }
    }, [problem, extension, t]);

    return (
        <PhoneDialog
            handle={handle}
            extension={extension}
            options={getViewOptions(settings, cameraValue)}
            t={t}
            problem=""
            certUrl={certUrl}
            onAction={() => runAction(host, handle?.phone || null, settings)}
        />
    );
}

export function PhoneService({ phones, host, t }: PhoneServiceProps): React.JSX.Element {
    return (
        <>
            {phones.map(phone => (
                <ServicePhoneDialog
                    key={phone.id}
                    settings={phone.settings}
                    host={host}
                    t={t}
                />
            ))}
        </>
    );
}

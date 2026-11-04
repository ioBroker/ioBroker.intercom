import React, { useEffect, useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import type { Connection } from '@iobroker/gui-components';

interface FrigateCameraSelectProps {
    socket: Connection;
    /** Instance of the frigate adapter, e.g. `frigate.0` */
    instance: string;
    value: string;
    onChange: (value: string) => void;
}

/**
 * The cameras of a frigate instance, as its own widgets of the devices app offer them (`frigate:getCameras`).
 * A name can also be typed, e.g. while the instance is not running.
 */
export function FrigateCameraSelect({
    socket,
    instance,
    value,
    onChange,
}: FrigateCameraSelectProps): React.JSX.Element {
    const [cameras, setCameras] = useState<{ instance: string; names: string[] }>({ instance: '', names: [] });

    useEffect(() => {
        let cancelled = false;
        socket
            .sendTo(instance, 'frigate:getCameras', null)
            .then((list: unknown) => {
                if (!cancelled) {
                    const names = Array.isArray(list)
                        ? list
                              .map((item: { value?: unknown }) => (typeof item?.value === 'string' ? item.value : ''))
                              .filter(Boolean)
                        : [];
                    setCameras({ instance, names });
                }
            })
            .catch(() => {
                // not running or too old: the name can still be typed
            });
        return () => {
            cancelled = true;
        };
    }, [socket, instance]);

    return (
        <Autocomplete
            freeSolo
            fullWidth
            size="small"
            options={cameras.instance === instance ? cameras.names : []}
            value={value || ''}
            onInputChange={(_event, text) => {
                // also called when the value is set from outside: only a real change goes to the project
                if (text.trim() !== (value || '')) {
                    onChange(text.trim());
                }
            }}
            renderInput={params => (
                <TextField
                    {...params}
                    variant="standard"
                />
            )}
        />
    );
}

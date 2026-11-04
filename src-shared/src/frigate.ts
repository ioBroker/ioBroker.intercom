/**
 * The cameras of the frigate adapter, the same way its own widgets for the devices app get them
 * (ioBroker.frigate/src-devices):
 *
 * - `frigate:getCameras` → `[{ value, label }]`, the cameras of the instance
 * - `snapshot` `{ camera, height }` → `{ data, contentType }` or `{ error }`, one picture over the socket
 * - `frigate:getWebUrl` `{ hostname }` → `{ url, route, reason }`, where the web extension of the adapter serves
 *   `<route><camera>/stream.mjpeg`
 *
 * No React in here, so the logic runs in the unit tests as it is.
 */

/** Answer of `frigate:getWebUrl` */
export interface FrigateWebUrl {
    url?: string;
    route?: string;
    reason?: string;
}

/**
 * Opened through the ioBroker cloud (iobroker.pro / iobroker.net): the cloud relays the socket, but not an endless
 * HTTP response like the MJPEG stream.
 */
export function isCloud(hostname: string): boolean {
    return /(^|\.)iobroker\.(pro|net)$/i.test(hostname);
}

/**
 * Address of the MJPEG stream of a camera, or `null` if the browser cannot load it
 *
 * @param answer - of `frigate:getWebUrl`
 * @param instance - of the frigate adapter, e.g. `frigate.0`: the default route of its web extension
 * @param camera - name of the camera in Frigate
 * @param params - of the stream, e.g. `fps` and `height`
 * @param page - origin and protocol of the page the picture is shown in
 * @param page.origin - e.g. `https://192.168.1.5:8082`
 * @param page.protocol - e.g. `https:`
 */
export function frigateStreamUrl(
    answer: FrigateWebUrl | null | undefined,
    instance: string,
    camera: string,
    params: Record<string, number>,
    page: { origin: string; protocol: string },
): string | null {
    let base = String(answer?.url || '').replace(/\/+$/, '');
    if (!base) {
        return null;
    }
    if (base === page.origin) {
        // relative: survives a reverse proxy
        base = '';
    } else if (page.protocol === 'https:' && base.startsWith('http:')) {
        // the phone needs HTTPS, and an https page does not load pictures over http (mixed content)
        return null;
    }
    const route = (answer?.route || `${instance}/`).replace(/^\/+/, '').replace(/\/*$/, '/');
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    return `${base}/${route}${encodeURIComponent(camera)}/stream.mjpeg${query ? `?${query}` : ''}`;
}

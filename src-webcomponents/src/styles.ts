/**
 * The styles of the shadow roots. The element fills the box of the host; it has a transparent background and
 * inherits `color` and `font`, so it follows the theme of the host. Colors come from the theme variables of the host
 * (`--iob-primary`, `--iob-success`, ...) or are mixed from `currentColor`, so they fit a light and a dark theme.
 *
 * The layout `auto` is chosen by container queries on the box: the whole phone from 240 x 300 px on, a tile below.
 * The tile shows the picture of the camera next to its state from 1.5 times as wide as high, and is one row from
 * 3 times as wide as high (like the 2x½ tile of the devices app). The layouts `tile` and `phone` stay as they are.
 */

/** The box from which `auto` shows the whole phone */
const SMALL = '((width < 240px) or (height < 300px))';
const WIDE = '(aspect-ratio >= 3 / 2)';
const ROW = '(aspect-ratio >= 3)';

/**
 * The phone as a tile: the state of the phone, a click opens the whole phone
 *
 * @param scope the class of the layout the rules apply to
 */
function tileRules(scope: string): string {
    return `
${scope} {
    flex-direction: row;
}
${scope} .head,
${scope} .sound,
${scope} .content > :not(.picture),
${scope} .picture {
    display: none;
}
${scope} .content {
    display: contents;
}
${scope} .tile-status {
    display: flex;
}
${scope} .tile-open {
    display: block;
}`;
}

/**
 * A wide tile: the picture of the camera next to the state, while a call runs or if it is always shown
 *
 * @param scope the class of the layout the rules apply to
 */
function wideRules(scope: string): string {
    return `
${scope} .picture.source {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    margin: clamp(4px, 4cqmin, 10px);
    margin-left: 0;
    border-radius: 12px;
}
${scope} .picture .switch,
${scope} .picture .pip {
    display: none;
}
${scope} .tile-status {
    --avatar: clamp(28px, 30cqh, 80px);
}`;
}

/**
 * A flat tile: one row, no picture
 *
 * @param scope the class of the layout the rules apply to
 */
function rowRules(scope: string): string {
    return `
${scope} .tile-status {
    flex-direction: row;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    --avatar: clamp(24px, 60cqh, 56px);
}
${scope} .tile-text {
    flex: 1;
}
${scope} .tile-title {
    font-size: clamp(12px, 28cqh, 16px);
}
${scope} .tile-state {
    font-size: clamp(10px, 22cqh, 13px);
    -webkit-line-clamp: 1;
}
${scope} .picture.source {
    display: none;
}`;
}

const BASE = `
:host {
    display: block;
    width: 100%;
    height: 100%;
}
.mount {
    width: 100%;
    height: 100%;
    /* the size of the box does not depend on what is in it */
    container-type: size;
    container-name: intercom;
}
.phone {
    --pad: clamp(8px, 4cqmin, 12px);
    --gap: clamp(6px, 3cqmin, 10px);
    --fab-big: clamp(44px, 15cqmin, 56px);
    --fab-small: clamp(36px, 12cqmin, 46px);
    --key-h: clamp(30px, 8cqh, 46px);
    --number-h: clamp(44px, 12cqh, 60px);
    --number-fs: clamp(20px, 7cqmin, 28px);
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}
.phone.large {
    --pad: clamp(12px, 5cqmin, 20px);
    --gap: clamp(8px, 3cqmin, 16px);
    --fab-big: clamp(56px, 16cqmin, 72px);
    --fab-small: clamp(46px, 13cqmin, 60px);
    --key-h: clamp(40px, 8cqh, 60px);
    --number-h: clamp(56px, 11cqh, 76px);
    --number-fs: clamp(26px, 9cqmin, 36px);
}
.phone.edit {
    pointer-events: none;
}
button {
    font: inherit;
    color: inherit;
    margin: 0;
    -webkit-tap-highlight-color: transparent;
}
button:focus-visible,
input:focus-visible {
    outline: 2px solid var(--iob-primary);
    outline-offset: 1px;
}
svg {
    display: block;
    fill: currentColor;
}

/* ------------------------------------------------------------------ header */
.head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--pad);
    border-bottom: 1px solid var(--iob-divider);
}
.brand {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 11px;
    /* the gradient of the app icon, the same as the primary buttons of admin 8 and the test page */
    background: linear-gradient(135deg, #48a1fa 0%, #0b76f5 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(19, 123, 248, 0.35);
}
.brand svg {
    width: 20px;
    height: 20px;
}
.title {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    font-size: 1.1em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.chip {
    --c: var(--iob-text-secondary);
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--c) 60%, transparent);
    color: var(--c);
    font-size: 0.8em;
    font-weight: 500;
    line-height: 1.6;
    white-space: nowrap;
}
.chip .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
}
.chip.success {
    --c: var(--iob-success);
}
.chip.warning {
    --c: var(--iob-warning);
}
.chip.error {
    --c: var(--iob-error);
}
/* the dialog of the host has the title: only the state stays */
.dialog .head {
    justify-content: center;
    border-bottom: 0;
    padding-bottom: 0;
}
.dialog .brand,
.dialog .title {
    display: none;
}

/* ------------------------------------------------------------------ alerts */
.alert {
    --c: var(--iob-info);
    box-sizing: border-box;
    padding: 6px 10px;
    border-radius: calc(var(--iob-border-radius) * 1.5);
    border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
    background: color-mix(in srgb, var(--c) 12%, transparent);
    font-size: 0.85em;
    line-height: 1.4;
    text-align: left;
}
.alert.warning {
    --c: var(--iob-warning);
}
.alert.error {
    --c: var(--iob-error);
}
.alert a {
    color: inherit;
    font-weight: 600;
}
.alert.sound {
    flex: none;
    width: 100%;
    border-radius: 0;
    border-width: 0 0 1px;
    cursor: pointer;
}

/* ------------------------------------------------------------------ content */
.content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: var(--pad);
}
.subtitle {
    flex: none;
    text-align: center;
    color: var(--iob-text-secondary);
    font-size: 0.85em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.panel {
    flex: none;
    border: 1px solid var(--iob-divider);
    border-radius: 16px;
    background: color-mix(in srgb, currentColor 2%, transparent);
}
.peer {
    padding: 8px 16px;
    text-align: center;
}
.peer-name {
    font-size: 1.25em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.peer-state {
    font-size: 0.85em;
    color: var(--iob-text-secondary);
}
.peer-state.connected {
    color: var(--iob-success);
}
.number {
    display: flex;
    align-items: center;
    min-height: var(--number-h);
    padding: 0 6px 0 16px;
}
.number input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--number-fs);
    font-weight: 600;
    letter-spacing: 1px;
    text-align: center;
    padding: 0 0 0 40px;
    outline: none;
}
.number input::placeholder {
    color: var(--iob-text-secondary);
    opacity: 0.7;
}
.icon-button {
    flex: none;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    color: var(--iob-text-secondary);
}
.icon-button:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
}
.icon-button.hidden {
    visibility: hidden;
}
.icon-button svg {
    width: 24px;
    height: 24px;
}

/* ------------------------------------------------------------------ picture */
.picture {
    position: relative;
    flex: 1;
    min-height: clamp(80px, 25cqh, 120px);
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid var(--iob-divider);
    display: flex;
    align-items: center;
    justify-content: center;
}
.large .picture {
    min-height: clamp(120px, 30cqh, 200px);
}
.picture.source {
    border: 0;
    background: #000;
}
.switch {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    padding: 0;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}
.switch:hover {
    background: rgba(0, 0, 0, 0.65);
}
.switch svg {
    width: 24px;
    height: 24px;
}
.pip {
    position: absolute;
    right: 10px;
    bottom: 10px;
    width: 30%;
    aspect-ratio: 4 / 3;
    border-radius: 10px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.75);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    background: #000;
}
.ring {
    position: relative;
    width: 96px;
    height: 96px;
}
.wave {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 3px solid var(--iob-success);
    animation: intercom-pulse 1.6s ease-out infinite;
}
.wave.late {
    animation-delay: 0.8s;
}
.ring-avatar {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--iob-success);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
}
.ring-avatar svg {
    width: 44px;
    height: 44px;
    animation: intercom-shake 1.2s infinite;
}
@keyframes intercom-pulse {
    from {
        transform: scale(1);
        opacity: 0.7;
    }
    to {
        transform: scale(1.8);
        opacity: 0;
    }
}
@keyframes intercom-shake {
    0%,
    50%,
    100% {
        transform: rotate(0);
    }
    5%,
    15%,
    25%,
    35%,
    45% {
        transform: rotate(-14deg);
    }
    10%,
    20%,
    30%,
    40% {
        transform: rotate(14deg);
    }
}

/* ------------------------------------------------------------------ keypad and buttons */
.keypad {
    flex: none;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(4px, 1.5cqh, 10px);
    width: 100%;
    max-width: 360px;
    margin: 0 auto;
}
.key {
    height: var(--key-h);
    padding: 0;
    border-radius: 12px;
    border: 1px solid var(--iob-divider);
    background: linear-gradient(
        180deg,
        color-mix(in srgb, currentColor 6%, transparent) 0%,
        color-mix(in srgb, currentColor 2%, transparent) 100%
    );
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
        border-color 0.15s,
        transform 0.05s;
}
.large .key {
    border-radius: 16px;
}
.key:hover {
    border-color: var(--iob-primary);
}
.key:active {
    transform: scale(0.97);
}
.digit {
    font-size: calc(var(--key-h) * 0.42);
    font-weight: 500;
    line-height: 1;
}
.letters {
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--iob-text-secondary);
    min-height: 12px;
    margin-top: 2px;
}
.spacer {
    flex: 1;
}
.buttons {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-wrap: wrap;
    gap: clamp(12px, 5cqmin, 24px);
    padding-bottom: 4px;
}
.fab {
    /* not currentColor: in a variable it is the color of the element that uses it */
    --c: color-mix(in srgb, var(--iob-text) 14%, transparent);
    --fc: inherit;
    flex: none;
    width: var(--fab-small);
    height: var(--fab-small);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--c);
    color: var(--fc);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow:
        0 3px 5px -1px rgba(0, 0, 0, 0.2),
        0 6px 10px 0 rgba(0, 0, 0, 0.14);
    transition:
        filter 0.15s,
        transform 0.05s;
}
.fab.big {
    width: var(--fab-big);
    height: var(--fab-big);
}
.fab svg {
    width: 44%;
    height: 44%;
}
.fab.success {
    --c: var(--iob-success);
    --fc: #fff;
}
.fab.error {
    --c: var(--iob-error);
    --fc: #fff;
}
.fab.primary {
    --c: var(--iob-primary);
    --fc: var(--iob-primary-contrast);
}
.fab.glow:not(:disabled) {
    box-shadow: 0 0 28px color-mix(in srgb, var(--c) 55%, transparent);
}
.fab:hover:not(:disabled) {
    filter: brightness(1.08);
}
.fab:active:not(:disabled) {
    transform: scale(0.96);
}
.fab:disabled {
    cursor: default;
    background: color-mix(in srgb, var(--iob-text) 12%, transparent);
    color: color-mix(in srgb, var(--iob-text) 38%, transparent);
    box-shadow: none;
}

/* ------------------------------------------------------------------ tile */
.tile-status {
    --avatar: clamp(28px, 30cqmin, 96px);
    display: none;
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    padding: clamp(8px, 8cqmin, 20px);
}
.avatar {
    --c: color-mix(in srgb, var(--iob-text) 30%, transparent);
    flex: none;
    width: var(--avatar);
    height: var(--avatar);
    border-radius: 50%;
    background: var(--c);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
}
.avatar svg {
    width: 55%;
    height: 55%;
}
.avatar.ready {
    --c: var(--iob-primary);
    color: var(--iob-primary-contrast);
}
.avatar.active {
    --c: var(--iob-success);
}
.avatar.bad {
    --c: var(--iob-error);
}
.avatar.ringing {
    animation: intercom-tile-pulse 1.2s ease-out infinite;
}
@keyframes intercom-tile-pulse {
    from {
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--iob-success) 60%, transparent);
    }
    to {
        box-shadow: 0 0 0 16px transparent;
    }
}
.tile-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
}
.tile-title {
    font-weight: 600;
    font-size: clamp(12px, 9cqmin, 18px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tile-state {
    font-size: clamp(10px, 7cqmin, 14px);
    color: var(--iob-text-secondary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: anywhere;
}
.tile-state.bad {
    color: var(--iob-error);
}
.tile-open {
    display: none;
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
}
.tile-open:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 4%, transparent);
}
.tile-open:disabled {
    cursor: default;
}
.tile-open:focus-visible {
    outline-offset: -2px;
}
`;

export const STYLES = `${BASE}
${tileRules('.layout-tile')}
@container intercom ${WIDE} {
${wideRules('.layout-tile')}
}
@container intercom ${ROW} {
${rowRules('.layout-tile')}
}
@container intercom ${SMALL} {
${tileRules('.layout-auto')}
}
@container intercom ${SMALL} and ${WIDE} {
${wideRules('.layout-auto')}
}
@container intercom ${SMALL} and ${ROW} {
${rowRules('.layout-auto')}
}
`;

/** The dialog of the host frames the content: it takes the room the host gives, at least the height of a phone */
export const DIALOG_STYLES = `${BASE}
.mount {
    min-height: min(560px, calc(100vh - 160px));
}
`;

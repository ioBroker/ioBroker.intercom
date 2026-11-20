"use strict";
/**
 * The answer of `help`: what the instance answers, written for an AI agent (e.g. ioBroker.pi-agent, or the MCP server
 * with `send_to`) and for script authors. Keep it in sync with `onMessage` in main.ts and the README.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMANDS = void 0;
exports.getHelp = getHelp;
/** The commands `onMessage` answers; `write`: the command does something beyond returning information */
exports.COMMANDS = [
    { command: 'help', write: false },
    { command: 'getSubscribers', write: false },
    { command: 'getCalls', write: false },
    { command: 'call', write: true },
    { command: 'answer', write: true },
    { command: 'transfer', write: true },
    { command: 'hangup', write: true },
    { command: 'decline', write: true },
    { command: 'reload', write: true },
    { command: 'getSubscriberStatus', write: false },
    { command: 'getSubscriberOptions', write: false },
    { command: 'generateCert', write: false },
    { command: 'getHostAddresses', write: false },
    { command: 'getIobFingerprint', write: false },
];
/**
 * The help text
 *
 * @param instance e.g. `intercom.0`
 */
function getHelp(instance) {
    return `ioBroker.intercom: an Asterisk telephone system for the house (door intercom, phones in the browser). The
subscribers are phones in vis, in the devices app or in an app (kind webrtc) and SIP devices such as door intercoms
(kind sip), each with an extension of 2-6 digits; one subscriber can be on several devices at once, which all ring. A
group is a number that rings several subscribers. 600 is the echo test (if enabled). There are no external lines:
only the subscribers and groups of the house can be called.

The agent has no voice in a call: it cannot talk with a caller or listen. It can see the calls, let a phone call
somebody, take a ringing call over to send tones (e.g. the code that opens the door), hand a call to another phone
and end calls.

Commands (sendTo ${instance}):
- getSubscribers: {subscribers: [{extension, name, kind, registered, devices, state}], groups: [{extension, name,
  members}], echoTest}. registered = at least one device is connected, devices = how many. state: idle, ringing,
  inuse, unavailable. echoTest = its number, "" if disabled.
- getCalls: the calls going on: {calls: [{id, from, fromName, to, toName, state, ringing, connected, seconds}]}.
  from = the caller (with call: the phone that rings first), to = the number called (a subscriber, a group or 600;
  "" after answer). state ringing = devices ring, nobody answered; talking = answered. ringing = the subscribers
  whose devices ring now, connected = the subscribers with an answered line, the caller included. seconds = since
  the call started. Empty list: nothing going on.
- call {from, to}: lets the phone "from" call "to". All devices of the subscriber "from" ring (up to 30 s); when
  somebody answers there, Asterisk calls "to" (a subscriber, a group or 600) and connects them. Use it for "call the
  door from the kitchen" or "connect me with X": "from" is the phone of the user, "to" the one to reach. The answer
  {result: "ok", text} only means that "from" rings now, not that anybody answered. Error if "from" has no connected
  device.
- answer {call?, extension?, dtmf, hangupAfter?}: Asterisk takes a ringing call over itself: the devices stop
  ringing, the caller is answered, after 1 s it gets the tones "dtmf" (digits, *, #, A-D; w = a pause of half a
  second), and after hangupAfter seconds (default 3, 1-60) Asterisk hangs up. This is how a door intercom that
  opens with a code during a call is opened without anybody going to a phone. Nobody talks with the caller.
  Answer {result: "ok", call} or {error}.
- transfer {call?, extension?, to}: the caller of a ringing or running call is handed to "to" (a subscriber or a
  group): the devices of "to" ring, the ones that rang before stop; a conversation going on ends for the other
  side. Use it to let the user take a call on the phone where they are.
- hangup {call?, extension?}: ends a call, ringing or running, for everybody in it: {result: "ok", channels}.
- decline {extension}: only the devices of this subscriber stop ringing; the call goes on if other members of a
  group still ring, otherwise the caller hears "busy": {result: "ok", channels}.
- answer, transfer and hangup name the call with "call" (the id from getCalls) or "extension" (a subscriber or group
  in the call, e.g. the door intercom or the called group), or with neither if exactly one call goes on (answer:
  one ringing call). Several calls: an error that asks for "call".
- help: this text and the list of commands with their write flag.
- reload (writes the configuration again), getSubscriberStatus, getSubscriberOptions, generateCert,
  getHostAddresses, getIobFingerprint: for the settings, not for agents.

States (${instance}.*):
- subscribers.<extension>.state (idle, ringing, inuse, unavailable), .registered (a device is connected), .contacts
  (how many), .userAgent (the device, e.g. "DoorBird D2101V" or "JsSIP" for a browser).
- info.connection: Asterisk is connected; without it no command works.
- cameras.<name>.image: the picture of a door camera as data URL (JPEG), refreshed fast during a call;
  cameras.<name>.error: why there is no picture.

How to talk to the user:
- Name subscribers and groups by their names (getSubscribers), not by their numbers.
- "Who is calling / is somebody at the door": getCalls, fromName; a sip subscriber is usually a door intercom. A
  picture: cameras.<name>.image of this adapter or a camera adapter (e.g. frigate); look at it and say who is there.
- "Answer" with nothing to send: the agent cannot talk, so offer transfer to the phone of the user instead, or call
  with "from" = the phone of the user. Which phone is the user's: ask if it is not clear from the conversation.
- call, answer, transfer, hangup and decline ring real phones, end calls or open doors: only on the user's request.
  Open a door (answer with dtmf) only when the user asks for it and only with the code the user or the
  instructions gave; never guess a code.
- A browser phone rings only while a page with it is open (registered true); a subscriber without a connected
  device cannot be called.`;
}
//# sourceMappingURL=help.js.map
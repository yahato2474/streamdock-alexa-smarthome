// Plugin entry point (launched by Stream Dock with its bundled Node.js).
const { StreamDock, log } = require('./sd');
const { createActions } = require('./actions');

const sd = new StreamDock();
const actions = createActions(sd);

const EVENTS = ['willAppear', 'willDisappear', 'didReceiveSettings', 'keyUp', 'dialRotate', 'dialUp', 'sendToPlugin'];
for (const ev of EVENTS) {
  sd.on(ev, async msg => {
    if (actions.uuids.includes(msg.action) && actions.handlers[ev]) await actions.handlers[ev](msg);
  });
}

process.on('uncaughtException', e => log('uncaught', (e && e.stack) || String(e)));
process.on('unhandledRejection', e => log('unhandled', (e && e.stack) || String(e)));

log('starting', process.version);
sd.connect();

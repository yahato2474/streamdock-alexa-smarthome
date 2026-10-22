// Minimal Stream Dock (Elgato-compatible) plugin connection.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const LOG_DIR = path.join(__dirname, '..', 'log');

function log(...args) {
  if (process.env.NODE_TEST_CONTEXT) return; // keep unit-test fakes out of the real log
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'plugin.log'), line);
  } catch (_) { /* logging must never crash the plugin */ }
  if (process.env.STREAMDOCK_ALEXA_DEBUG) process.stderr.write(line);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i].startsWith('-')) out[argv[i].slice(1)] = argv[i + 1];
  }
  return out;
}

class StreamDock {
  constructor(argv = process.argv) {
    const a = parseArgs(argv);
    this.port = a.port;
    this.uuid = a.pluginUUID;
    this.registerEvent = a.registerEvent || 'registerPlugin';
    this.info = a.info ? JSON.parse(a.info) : {};
    this.handlers = {};
    this.ws = null;
  }

  get language() {
    return (this.info.application && this.info.application.language) || 'en';
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
    return this;
  }

  connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.ws.on('open', () => {
      this.send({ event: this.registerEvent, uuid: this.uuid });
      log('registered', this.uuid);
    });
    this.ws.on('message', data => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return log('bad message'); }
      for (const fn of this.handlers[msg.event] || []) {
        Promise.resolve()
          .then(() => fn(msg))
          .catch(e => log('handler error', msg.event, (e && e.stack) || String(e)));
      }
    });
    // Stream Dock restarts the plugin process when it exits.
    this.ws.on('close', () => { log('socket closed; exiting'); process.exit(0); });
    this.ws.on('error', e => log('socket error', String(e)));
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  setTitle(context, title) { this.send({ event: 'setTitle', context, payload: { title, target: 0 } }); }
  setImage(context, image) { this.send({ event: 'setImage', context, payload: { image, target: 0 } }); }
  showOk(context) { this.send({ event: 'showOk', context }); }
  showAlert(context) { this.send({ event: 'showAlert', context }); }
  toPI(context, action, payload) { this.send({ event: 'sendToPropertyInspector', context, action, payload }); }
}

// Key images are sent as data URLs so they can change with the device state.
const imageCache = new Map();
function imageData(name) {
  if (!imageCache.has(name)) {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'images', `${name}.png`));
    imageCache.set(name, 'data:image/png;base64,' + buf.toString('base64'));
  }
  return imageCache.get(name);
}

module.exports = { StreamDock, log, imageData };

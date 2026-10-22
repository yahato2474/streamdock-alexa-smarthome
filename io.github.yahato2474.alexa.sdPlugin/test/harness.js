// Fake Stream Dock host: launches the plugin like the app does and lets tests drive events.
const { spawn } = require('child_process');
const path = require('path');
const { WebSocketServer } = require('ws');

const NODE = process.env.NODE_BIN || process.execPath;

async function startHost() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => wss.on('listening', r));
  const port = wss.address().port;
  const received = [];
  const waiters = [];
  let sock;

  const connected = new Promise(resolve => {
    wss.on('connection', ws => {
      ws.on('message', d => {
        const msg = JSON.parse(d.toString());
        if (msg.event === 'registerPlugin') { sock = ws; resolve(); return; }
        received.push(msg);
        for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
      });
    });
  });

  const info = { application: { platform: 'macos', language: 'ja' }, devices: [{ id: 'dev', name: 'AKP03EV25', type: 0 }] };
  const proc = spawn(NODE, [path.join(__dirname, '..', 'plugin', 'index.js'),
    '-port', String(port), '-pluginUUID', 'TESTPLUGIN', '-registerEvent', 'registerPlugin', '-info', JSON.stringify(info)],
  { stdio: ['ignore', 'inherit', 'inherit'] });

  await connected;
  return {
    received,
    send(msg) { sock.send(JSON.stringify(msg)); },
    waitFor(pred, ms = 8000) {
      const hit = received.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('timeout waiting for message'));
        }, ms);
        const w = { pred, resolve: m => { clearTimeout(timer); resolve(m); } };
        waiters.push(w);
      });
    },
    clear() { received.length = 0; },
    async stop() { proc.kill(); wss.close(); },
  };
}

module.exports = { startHost };

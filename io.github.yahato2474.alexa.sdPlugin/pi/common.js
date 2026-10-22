// Property Inspector connection (Elgato-compatible API used by Stream Dock).
const PI = {
  ws: null,
  uuid: null,
  action: null,
  language: 'en',
  settings: {},
  onSettings: () => {},
  onPluginMessage: () => {},

  save(patch) {
    Object.assign(PI.settings, patch);
    PI.send({ event: 'setSettings', context: PI.uuid, payload: PI.settings });
  },
  toPlugin(payload) {
    PI.send({ event: 'sendToPlugin', action: PI.action, context: PI.uuid, payload });
  },
  send(obj) {
    if (PI.ws && PI.ws.readyState === 1) PI.ws.send(JSON.stringify(obj));
  },
};

// Called by Stream Dock when the inspector opens.
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, info, actionInfo) {
  const ai = typeof actionInfo === 'string' ? JSON.parse(actionInfo) : actionInfo;
  const inf = typeof info === 'string' ? JSON.parse(info) : (info || {});
  PI.uuid = uuid;
  PI.action = ai.action;
  PI.language = (inf.application && inf.application.language) || navigator.language || 'en';
  PI.settings = (ai.payload && ai.payload.settings) || {};
  PI.ws = new WebSocket('ws://127.0.0.1:' + port);
  PI.ws.onopen = () => {
    PI.send({ event: registerEvent, uuid });
    PI.onSettings(PI.settings);
  };
  PI.ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'didReceiveSettings') {
      PI.settings = msg.payload.settings || {};
      PI.onSettings(PI.settings);
    } else if (msg.event === 'sendToPropertyInspector') {
      PI.onPluginMessage(msg.payload);
    }
  };
}
// Some Stream Dock builds call this name instead.
const connectSocket = connectElgatoStreamDeckSocket;

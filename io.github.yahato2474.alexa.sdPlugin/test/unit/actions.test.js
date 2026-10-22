// npm test — uses a fake Stream Dock, Alexa client and microphone; no network or audio devices.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Keep the real login file out of reach.
process.env.STREAMDOCK_ALEXA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sda-test-'));
const config = require('../../plugin/config');
const { createActions, kindOf, UUID } = require('../../plugin/actions');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeSd(language = 'en') {
  const sent = [];
  const rec = event => (context, payload) => sent.push({ event, context, payload });
  return {
    sent, language,
    setTitle: rec('setTitle'), setImage: rec('setImage'), showOk: rec('showOk'), showAlert: rec('showAlert'),
    toPI: (context, action, payload) => sent.push({ event: 'toPI', context, payload }),
    last(event, context) { return [...sent].reverse().find(m => m.event === event && m.context === context); },
  };
}

function fakeClient({ loggedIn = true } = {}) {
  const entities = [
    { name: 'Desk light strip', entityId: 'e1', applianceId: 'a1', types: ['LIGHT'] },
    { name: 'Desk plug', entityId: 'e2', applianceId: 'a2', types: ['SMARTPLUG'] },
    { name: 'Air conditioner', entityId: 'e3', applianceId: 'a3', types: ['THERMOSTAT'] },
    { name: 'Lights on', entityId: 'e4', applianceId: 'a4', types: ['SCENE_TRIGGER'] },
  ];
  const state = { 'Desk light strip': { power: 'OFF', brightness: 40 }, 'Desk plug': { power: 'ON' }, 'Air conditioner': {}, 'Lights on': {} };
  const calls = [];
  return {
    calls, state,
    hasLogin: () => loggedIn,
    reset() {},
    findEntity: async n => entities.find(e => e.name === n),
    entities: async () => entities,
    routines: async () => [{ name: 'Good night' }, { name: 'Good morning' }],
    echoNames: async () => ['Living room Echo'],
    state: async e => ({ ...state[e.name] }),
    setPower: async (e, on) => { calls.push(['power', e.name, on]); if (state[e.name].power !== undefined) state[e.name].power = on ? 'ON' : 'OFF'; },
    setBrightness: async (e, v) => { calls.push(['brightness', e.name, v]); state[e.name].brightness = v; state[e.name].power = 'ON'; },
    activateScene: async e => calls.push(['scene', e.name]),
    runRoutine: async n => { if (n === 'missing') throw new Error('not found'); calls.push(['routine', n]); },
    textCommand: async txt => calls.push(['text', txt]),
  };
}

function fakeMic({ available = true } = {}) {
  const m = { muted: false, toggles: 0, sounds: [] };
  return Object.assign(m, {
    available: () => available,
    micState: async () => ({ device: 'Built-in mic', muted: m.muted }),
    micToggle: async () => {
      if (!available) throw new Error('bin/micmute is missing');
      m.toggles++; m.muted = !m.muted;
      return { device: 'Built-in mic', muted: m.muted };
    },
    playMicFeedback: muted => m.sounds.push(muted),
  });
}

const ev = (event, action, context, settings, extra = {}) =>
  ({ event, action: UUID[action], context, payload: { settings, ...extra } });

function setup(opts = {}) {
  const sd = fakeSd(opts.language), c = fakeClient(opts), mic = fakeMic(opts);
  const { handlers } = createActions(sd, c, mic);
  return { sd, c, mic, handlers };
}

test('kindOf maps Alexa appliance types to icon families', () => {
  assert.strictEqual(kindOf({ types: ['LIGHT'] }), 'light');
  assert.strictEqual(kindOf({ types: ['SMARTPLUG'] }), 'plug');
  assert.strictEqual(kindOf({ types: ['TV'] }), 'remote');
  assert.strictEqual(kindOf({ types: ['SCENE_TRIGGER'] }), 'scene');
  assert.strictEqual(kindOf(null), 'power');
});

test('routine key runs the routine; unknown or unset routines alert', async () => {
  const { sd, c, handlers } = setup();
  await handlers.willAppear(ev('willAppear', 'routine', 'R', { routine: 'Good night' }));
  assert.strictEqual(sd.last('setTitle', 'R').payload, 'Good night');
  await handlers.keyUp(ev('keyUp', 'routine', 'R', { routine: 'Good night' }));
  assert.deepStrictEqual(c.calls, [['routine', 'Good night']]);
  assert.ok(sd.last('showOk', 'R'));
  await handlers.keyUp(ev('keyUp', 'routine', 'R2', { routine: 'missing' }));
  assert.ok(sd.last('showAlert', 'R2'));
  await handlers.keyUp(ev('keyUp', 'routine', 'R3', {}));
  assert.ok(sd.last('showAlert', 'R3'));
  handlers.willDisappear(ev('willDisappear', 'routine', 'R', {}));
});

test('power key shows the state and toggles it', async () => {
  const { sd, c, handlers } = setup();
  await handlers.willAppear(ev('willAppear', 'power', 'P', { device: 'Desk plug' }));
  assert.match(sd.last('setImage', 'P').payload, /^data:image\/png;base64,/);
  assert.strictEqual(sd.last('setTitle', 'P').payload, 'Desk plug');
  await handlers.keyUp(ev('keyUp', 'power', 'P', { device: 'Desk plug' }));
  await handlers.keyUp(ev('keyUp', 'power', 'P', { device: 'Desk plug' }));
  assert.deepStrictEqual(c.calls, [['power', 'Desk plug', false], ['power', 'Desk plug', true]]);
  assert.ok(sd.last('showOk', 'P'));
  handlers.willDisappear(ev('willDisappear', 'power', 'P', {}));
});

test('stateless device (IR remote) alternates on/off; fixed modes stay fixed', async () => {
  const { c, handlers } = setup();
  for (let i = 0; i < 3; i++) await handlers.keyUp(ev('keyUp', 'power', 'A', { device: 'Air conditioner' }));
  await handlers.keyUp(ev('keyUp', 'power', 'X', { device: 'Desk light strip', mode: 'on' }));
  await handlers.keyUp(ev('keyUp', 'power', 'X', { device: 'Desk light strip', mode: 'on' }));
  assert.deepStrictEqual(c.calls.map(x => x[2]), [true, false, true, true, true]);
});

test('scene (e.g. Tapo smart action) is activated, never toggled', async () => {
  const { sd, c, handlers } = setup();
  await handlers.willAppear(ev('willAppear', 'power', 'S', { device: 'Lights on' }));
  await handlers.keyUp(ev('keyUp', 'power', 'S', { device: 'Lights on' }));
  await handlers.keyUp(ev('keyUp', 'power', 'S', { device: 'Lights on' }));
  assert.deepStrictEqual(c.calls, [['scene', 'Lights on'], ['scene', 'Lights on']]);
  assert.strictEqual(sd.last('setTitle', 'S').payload, 'Lights on');
  handlers.willDisappear(ev('willDisappear', 'power', 'S', {}));
});

test('brightness knob coalesces ticks, clamps 1..100, and push toggles power by default', async () => {
  const { sd, c, mic, handlers } = setup();
  const s = { device: 'Desk light strip', step: 10 };
  await handlers.willAppear(ev('willAppear', 'brightness', 'D', s));
  for (let i = 0; i < 3; i++) handlers.dialRotate(ev('dialRotate', 'brightness', 'D', s, { ticks: 1 }));
  await sleep(600);
  assert.deepStrictEqual(c.calls, [['brightness', 'Desk light strip', 70]]);
  assert.match(sd.last('setTitle', 'D').payload, /70%/);
  for (let i = 0; i < 12; i++) handlers.dialRotate(ev('dialRotate', 'brightness', 'D', s, { ticks: 1 }));
  await sleep(600);
  assert.deepStrictEqual(c.calls[1], ['brightness', 'Desk light strip', 100]);
  handlers.dialRotate(ev('dialRotate', 'brightness', 'D', s, { ticks: -20 }));
  await sleep(600);
  assert.deepStrictEqual(c.calls[2], ['brightness', 'Desk light strip', 1]);
  await handlers.dialUp(ev('dialUp', 'brightness', 'D', s));
  assert.deepStrictEqual(c.calls[3], ['power', 'Desk light strip', false]);
  assert.strictEqual(mic.toggles, 0);
  handlers.willDisappear(ev('willDisappear', 'brightness', 'D', {}));
});

test('brightness knob push can mute the microphone instead (no Alexa call, works logged out)', async () => {
  const { sd, c, mic, handlers } = setup({ language: 'ja' });
  const s = { device: 'Desk light strip', press: 'mic' };
  await handlers.willAppear(ev('willAppear', 'brightness', 'M', s));
  await handlers.dialUp(ev('dialUp', 'brightness', 'M', s));
  assert.strictEqual(mic.muted, true);
  assert.match(sd.last('setTitle', 'M').payload, /マイクOFF/);
  await handlers.dialUp(ev('dialUp', 'brightness', 'M', s));
  assert.strictEqual(mic.muted, false);
  assert.deepStrictEqual(mic.sounds, [true, false]);
  assert.deepStrictEqual(c.calls, []);
  handlers.willDisappear(ev('willDisappear', 'brightness', 'M', {}));

  const out = setup({ loggedIn: false });
  await out.handlers.dialUp(ev('dialUp', 'brightness', 'N', s));
  assert.strictEqual(out.mic.toggles, 1);
});

test('mic mute without the helper binary alerts', async () => {
  const { sd, handlers } = setup({ available: false });
  await handlers.dialUp(ev('dialUp', 'brightness', 'Q', { device: 'Desk light strip', press: 'mic' }));
  assert.ok(sd.last('showAlert', 'Q'));
});

test('text key sends the phrase', async () => {
  const { sd, c, handlers } = setup();
  await handlers.keyUp(ev('keyUp', 'text', 'T', { text: 'turn on the fan' }));
  assert.deepStrictEqual(c.calls, [['text', 'turn on the fan']]);
  assert.ok(sd.last('showOk', 'T'));
  await handlers.keyUp(ev('keyUp', 'text', 'T2', {}));
  assert.ok(sd.last('showAlert', 'T2'));
});

test('not logged in: keys show a login prompt in the UI language and alert on press', async () => {
  for (const [language, title] of [['en', 'Log in'], ['ja', '要ログイン']]) {
    const { sd, handlers } = setup({ loggedIn: false, language });
    await handlers.willAppear(ev('willAppear', 'routine', 'L', { routine: 'Good night' }));
    assert.strictEqual(sd.last('setTitle', 'L').payload, title);
    handlers.willDisappear(ev('willDisappear', 'routine', 'L', {}));
  }
});

test('property inspector gets devices, routines, Echo devices and region', async () => {
  const { sd, handlers } = setup();
  await handlers.sendToPlugin(ev('sendToPlugin', 'power', 'P', {}, { cmd: 'lists' }));
  const m = sd.last('toPI', 'P').payload;
  assert.strictEqual(m.loggedIn, true);
  assert.deepStrictEqual(m.entities.map(e => e.kind), ['light', 'plug', 'remote', 'scene']);
  assert.deepStrictEqual(m.routines, ['Good night', 'Good morning']);
  assert.strictEqual(m.region, 'amazon.co.jp');
  assert.strictEqual(m.micAvailable, true);
});

test('regionOptions: Japan overrides the OAuth namespace host, other marketplaces do not', () => {
  assert.strictEqual(config.regionOptions('amazon.co.jp').oa2NamespaceHost, 'www.amazon.com');
  assert.strictEqual(config.regionOptions('amazon.co.jp').acceptLanguage, 'ja-JP');
  assert.strictEqual(config.regionOptions('amazon.de').oa2NamespaceHost, undefined);
  assert.strictEqual(config.regionOptions('amazon.de').alexaServiceHost, 'alexa.amazon.de');
});

test('saveCookie writes a private file and skips identical rewrites', () => {
  config.saveCookie({ a: 1 });
  const st1 = fs.statSync(config.COOKIE_FILE);
  assert.strictEqual(st1.mode & 0o777, 0o600);
  const t1 = config.lastCookieWrite();
  config.saveCookie({ a: 1 });
  assert.strictEqual(config.lastCookieWrite(), t1);
});

test.after(() => fs.unwatchFile(config.COOKIE_FILE));

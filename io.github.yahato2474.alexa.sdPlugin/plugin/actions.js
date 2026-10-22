// Stream Dock actions: power key, brightness knob, routine key and text-command key.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { AlexaClient, isScene } = require('./alexa');
const config = require('./config');
const micModule = require('./mic');
const { log, imageData } = require('./sd');
const { strings } = require('./i18n');

const PREFIX = 'io.github.yahato2474.alexa';
const UUID = {
  power: `${PREFIX}.power`,
  brightness: `${PREFIX}.brightness`,
  routine: `${PREFIX}.routine`,
  text: `${PREFIX}.text`,
};

const STATE_POLL_MS = 30000;
const DIAL_COMMIT_MS = 400;
const LOGIN_COMMAND = path.join(__dirname, '..', 'tools', 'login.command');

function kindOf(entity) {
  const t = ((entity && entity.types) || []).join(' ');
  if (/SCENE_TRIGGER/.test(t)) return 'scene';
  if (/LIGHT/.test(t)) return 'light';
  if (/SMARTPLUG|SWITCH/.test(t)) return 'plug';
  if (entity) return 'remote';
  return 'power';
}

// What pressing the brightness knob does: toggle the light's power (default) or the microphone.
const pressMode = s => s.press || 'power';

function createActions(sd, client = new AlexaClient(log), mic = micModule) {
  const t = strings(sd.language);
  const contexts = new Map(); // context -> { action, settings }
  const states = new Map(); // entity name -> { power, brightness }
  const lastSent = new Map(); // entity name -> bool, for devices that do not report state (IR remotes)
  const dialPending = new Map();
  let pollTimer = null;

  const label = (s, fallback) => (s.label && s.label.trim()) || fallback || t.notSet;
  const entityFor = settings => (settings.device ? client.findEntity(settings.device) : null);

  async function refreshState(entity) {
    try {
      const st = await client.state(entity);
      states.set(entity.name, st);
      return st;
    } catch (e) {
      log('state error', entity.name, String(e));
      return states.get(entity.name) || {};
    }
  }

  async function render(context, { query = false } = {}) {
    const entry = contexts.get(context);
    if (!entry) return;
    const { action, settings } = entry;
    if (!client.hasLogin()) {
      sd.setImage(context, imageData('login'));
      return sd.setTitle(context, t.loginRequired);
    }
    if (action === UUID.routine) {
      sd.setImage(context, imageData('routine'));
      return sd.setTitle(context, label(settings, settings.routine));
    }
    if (action === UUID.text) {
      sd.setImage(context, imageData('text'));
      return sd.setTitle(context, label(settings, settings.text));
    }

    let entity = null;
    try { entity = await entityFor(settings); } catch (e) {
      log('entity error', String(e));
      sd.setImage(context, imageData('error'));
      return sd.setTitle(context, t.connectionError);
    }
    if (!entity) {
      sd.setImage(context, imageData(action === UUID.brightness ? 'brightness' : 'power-off'));
      return sd.setTitle(context, settings.device ? `${settings.device}\n${t.notFound}` : t.notSet);
    }
    const st = query ? await refreshState(entity) : (states.get(entity.name) || await refreshState(entity));
    const on = st.power === 'ON' || (st.power === undefined && lastSent.get(entity.name) === true);

    if (action === UUID.brightness) {
      const micMuted = pressMode(settings) === 'mic' && await mic.micState().then(m => m.muted).catch(() => false);
      sd.setImage(context, imageData(micMuted ? 'mic-muted' : on ? 'light-on' : 'light-off'));
      const b = Number.isFinite(st.brightness) ? `${st.brightness}%` : '';
      return sd.setTitle(context, [label(settings, entity.name), b, micMuted ? t.micOff : ''].filter(Boolean).join('\n'));
    }
    const kind = kindOf(entity);
    sd.setImage(context, imageData(kind === 'scene' ? 'scene' : `${kind}-${on ? 'on' : 'off'}`));
    sd.setTitle(context, label(settings, entity.name));
  }

  function renderAll(opts) {
    return Promise.all([...contexts.keys()].map(c => render(c, opts).catch(e => log('render error', String(e)))));
  }

  async function pollStates() {
    const names = new Set();
    for (const { action, settings } of contexts.values()) {
      if ((action === UUID.power || action === UUID.brightness) && settings.device) names.add(settings.device);
    }
    for (const n of names) {
      const e = await client.findEntity(n).catch(() => null);
      if (e) await refreshState(e);
    }
    await renderAll();
  }

  function ensurePolling() {
    const need = [...contexts.values()].some(c => c.action === UUID.power || c.action === UUID.brightness);
    if (need && !pollTimer && client.hasLogin()) {
      pollTimer = setInterval(() => pollStates().catch(e => log('poll error', String(e))), STATE_POLL_MS);
    }
    if (!need && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function openLogin() {
    execFile('/usr/bin/open', [LOGIN_COMMAND], () => {});
  }

  // Run fn; flash OK / alert on the key and log failures.
  async function guarded(context, fn) {
    if (!client.hasLogin()) { openLogin(); return sd.showAlert(context); }
    try {
      await fn();
      sd.showOk(context);
    } catch (e) {
      log('action error', String((e && e.message) || e));
      sd.showAlert(context);
    }
  }

  async function togglePower(settings) {
    const entity = await entityFor(settings);
    if (!entity) throw new Error(`device not found: ${settings.device}`);
    if (isScene(entity)) {
      await client.activateScene(entity);
      log('scene', entity.name);
      return;
    }
    const mode = settings.mode || 'toggle';
    let on;
    if (mode === 'on') on = true;
    else if (mode === 'off') on = false;
    else {
      const st = await refreshState(entity);
      if (st.power === 'ON' || st.power === 'OFF') on = st.power !== 'ON';
      else on = lastSent.get(entity.name) !== true; // stateless device (IR remote): alternate
    }
    await client.setPower(entity, on);
    log('power', entity.name, on ? 'ON' : 'OFF');
    lastSent.set(entity.name, on);
    states.set(entity.name, { ...(states.get(entity.name) || {}), power: on ? 'ON' : 'OFF' });
    await renderAll();
    // Confirm with the real state once the device has had time to report it.
    setTimeout(() => refreshState(entity).then(() => renderAll()).catch(() => {}), 3000);
  }

  async function toggleMic(context, settings) {
    try {
      const m = await mic.micToggle();
      log('mic', m.muted ? 'muted' : 'unmuted');
      if (settings.feedbackSound !== false) mic.playMicFeedback(m.muted);
      sd.showOk(context);
      await render(context);
    } catch (e) {
      log('mic error', String((e && e.message) || e));
      sd.showAlert(context);
    }
  }

  // Pick up a login made while the plugin is running.
  fs.watchFile(config.COOKIE_FILE, { interval: 3000 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    if (Date.now() - config.lastCookieWrite() < 15000) return; // our own token refresh
    // A live session keeps working on its own tokens; only reconnect when not connected or connecting,
    // so another process refreshing the file never interrupts a running command.
    if (client.ready) return;
    log('login file changed');
    client.reset();
    ensurePolling();
    renderAll({ query: true });
  });

  const handlers = {
    willAppear(msg) {
      contexts.set(msg.context, { action: msg.action, settings: msg.payload.settings || {} });
      ensurePolling();
      return render(msg.context);
    },
    willDisappear(msg) {
      contexts.delete(msg.context);
      ensurePolling();
    },
    didReceiveSettings(msg) {
      const e = contexts.get(msg.context);
      if (e) e.settings = msg.payload.settings || {};
      return render(msg.context, { query: true });
    },
    keyUp(msg) {
      const s = msg.payload.settings || {};
      if (msg.action === UUID.power) return guarded(msg.context, () => togglePower(s));
      if (msg.action === UUID.routine) {
        return guarded(msg.context, async () => {
          if (!s.routine) throw new Error('routine not set');
          await client.runRoutine(s.routine, s.echo);
          log('routine', s.routine);
        });
      }
      if (msg.action === UUID.text) {
        return guarded(msg.context, async () => {
          if (!s.text) throw new Error('text not set');
          await client.textCommand(s.text, s.echo);
          log('text command', s.text);
        });
      }
    },
    dialRotate(msg) {
      if (msg.action !== UUID.brightness) return;
      const s = msg.payload.settings || {};
      const ticks = Number(msg.payload.ticks) || 0;
      if (!ticks) return;
      // Coalesce a quick turn into one request.
      const pend = dialPending.get(msg.context) || { ticks: 0, timer: null };
      pend.ticks += ticks;
      clearTimeout(pend.timer);
      pend.timer = setTimeout(() => {
        dialPending.delete(msg.context);
        guarded(msg.context, async () => {
          const entity = await entityFor(s);
          if (!entity) throw new Error(`device not found: ${s.device}`);
          const cur = states.get(entity.name) || await refreshState(entity);
          const base = Number.isFinite(cur.brightness) ? cur.brightness : 50;
          const target = Math.max(1, Math.min(100, base + pend.ticks * (Number(s.step) || 10)));
          await client.setBrightness(entity, target);
          log('brightness', entity.name, target);
          states.set(entity.name, { ...cur, brightness: target, power: 'ON' });
          await renderAll();
        });
      }, DIAL_COMMIT_MS);
      dialPending.set(msg.context, pend);
    },
    dialUp(msg) {
      if (msg.action !== UUID.brightness) return;
      const s = msg.payload.settings || {};
      // The microphone is local (CoreAudio) and works without an Alexa login.
      if (pressMode(s) === 'mic') return toggleMic(msg.context, s);
      return guarded(msg.context, () => togglePower({ ...s, mode: 'toggle' }));
    },
    async sendToPlugin(msg) {
      const cmd = msg.payload && msg.payload.cmd;
      if (cmd === 'login') return openLogin();
      if (cmd !== 'lists') return;
      const base = { cmd: 'lists', micAvailable: mic.available(), region: config.loadConfig().amazonPage };
      if (!client.hasLogin()) return sd.toPI(msg.context, msg.action, { ...base, loggedIn: false });
      try {
        const [entities, routines, echoes] = await Promise.all([client.entities(true), client.routines(), client.echoNames()]);
        sd.toPI(msg.context, msg.action, {
          ...base,
          loggedIn: true,
          entities: entities.map(e => ({ name: e.name, kind: kindOf(e) })),
          routines: routines.map(r => r.name),
          echoes,
        });
      } catch (e) {
        log('lists error', String(e));
        sd.toPI(msg.context, msg.action, { ...base, loggedIn: true, error: String(e.message || e) });
      }
    },
  };

  return { uuids: Object.values(UUID), handlers, client };
}

module.exports = { createActions, kindOf, UUID };

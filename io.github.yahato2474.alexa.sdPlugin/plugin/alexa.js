// Alexa client (unofficial API via alexa-remote2): smart-home devices, routines and text commands.
const AlexaRemote = require('alexa-remote2');
const config = require('./config');

// Rank of Echo device families when picking the device that runs routines / text commands.
const FAMILY_RANK = { ECHO: 0, KNIGHT: 1, ROOK: 1, FIRE_TV: 4 };

// Tapo "smart actions" and other Alexa scenes: they can only be activated, never queried.
const isScene = entity => (entity.types || []).includes('SCENE_TRIGGER');

const p = fn => new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));

class AlexaClient {
  constructor(log = () => {}) {
    this.log = log;
    this.alexa = null;
    this.ready = null;
    this.entityCache = null;
  }

  hasLogin() { return !!config.loadCookie(); }

  // Connect once; later calls share the same promise. Rejects when not logged in.
  init() {
    if (this.ready) return this.ready;
    const cookie = config.loadCookie();
    if (!cookie) return Promise.reject(new Error('Not logged in to Alexa (run tools/login.command)'));
    const alexa = new AlexaRemote();
    alexa.on('cookie', () => { if (alexa.cookieData) config.saveCookie(alexa.cookieData); });
    this.ready = new Promise((resolve, reject) => {
      alexa.init({
        ...config.regionOptions(cookie.amazonPage || undefined),
        cookie,
        formerRegistrationData: cookie,
        // With macDms the library reuses tokens younger than 24 h instead of refreshing on every start.
        macDms: cookie.macDms,
        proxyOnly: true,
        proxyOwnIp: '127.0.0.1',
        proxyPort: 3456,
        useWsMqtt: false,
        usePushConnectType: 0,
        bluetooth: false,
        // The library's debug output contains full API responses (address, phone number, tokens),
        // so only short error / rate-limit lines are kept.
        logger: (...a) => {
          const s = a.map(String).join(' ');
          if (/error|fail|rate exceeded|too many|invalid|unauthori/i.test(s) && !/Response: \{/.test(s)) {
            this.log('[alexa]', s.slice(0, 160));
          }
        },
      }, err => {
        // When the saved login no longer works the library starts its login proxy and reports it as an error.
        if (err) { this.ready = null; return reject(err); }
        this.alexa = alexa;
        resolve(alexa);
      });
    });
    return this.ready;
  }

  // Drop the session so the next call re-reads the saved login.
  reset() {
    try { this.alexa && this.alexa.stop && this.alexa.stop(); } catch (_) { /* ignore */ }
    this.alexa = null;
    this.ready = null;
    this.entityCache = null;
  }

  // Real speakers only: no multi-room groups (WHA) or the Alexa app itself (VOX).
  speakers() {
    return Object.values(this.alexa.serialNumbers || {})
      .filter(d => d.capabilities && d.capabilities.includes('VOLUME_SETTING'))
      .filter(d => !['WHA', 'VOX'].includes(d.deviceFamily));
  }

  echoSerial(preferredName) {
    const echoes = this.speakers();
    if (preferredName) {
      const hit = echoes.find(d => d.accountName === preferredName) || echoes.find(d => d.accountName.includes(preferredName));
      if (hit) return hit.serialNumber;
    }
    // Prefer an online Echo, then an online Echo Show, then any online speaker.
    const rank = d => (d.online ? 0 : 10) + (FAMILY_RANK[d.deviceFamily] ?? 5);
    const best = [...echoes].sort((a, b) => rank(a) - rank(b))[0];
    if (!best) throw new Error('No Echo device found');
    return best.serialNumber;
  }

  async echoNames() {
    await this.init();
    return this.speakers().map(d => d.accountName);
  }

  // Smart-home endpoints known to Alexa (Tapo plugs and lights, IR remotes, scenes, ...).
  async entities(force = false) {
    await this.init();
    if (this.entityCache && !force) return this.entityCache;
    const res = await p(cb => this.alexa.getSmarthomeDevices(cb));
    const out = [];
    const walk = o => {
      if (!o || typeof o !== 'object') return;
      if (o.applianceId && o.friendlyName && o.entityId) {
        out.push({
          name: o.friendlyName,
          entityId: o.entityId,
          applianceId: o.applianceId,
          manufacturer: o.manufacturerName || '',
          types: o.applianceTypes || [],
        });
        return;
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(res);
    // The same appliance can appear under several groups; de-duplicate by entityId.
    this.entityCache = [...new Map(out.map(e => [e.entityId, e])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
    return this.entityCache;
  }

  async findEntity(name) {
    const list = await this.entities();
    return list.find(e => e.name === name) || list.find(e => e.name.includes(name))
      || (await this.entities(true)).find(e => e.name === name);
  }

  async control(entity, parameters) {
    await this.init();
    const res = await p(cb => this.alexa.executeSmarthomeDeviceAction([entity.entityId], parameters, 'APPLIANCE', cb));
    // The API answers 200 even when the device rejects the request; errors come in the body.
    if (res && Array.isArray(res.errors) && res.errors.length) {
      throw new Error(`${entity.name}: ${res.errors.map(e => e.code).join(', ')}`);
    }
    return res;
  }

  setPower(entity, on) {
    return this.control(entity, { action: on ? 'turnOn' : 'turnOff' });
  }

  setBrightness(entity, pct) {
    return this.control(entity, { action: 'setBrightness', brightness: Math.max(1, Math.min(100, Math.round(pct))) });
  }

  activateScene(entity) {
    return this.control(entity, { action: 'turnOn' });
  }

  // Returns { power: 'ON'|'OFF'|undefined, brightness: number|undefined, reachable }
  async state(entity) {
    // Scenes have no state, and querying them blocks for ~30 s until Amazon times out.
    if (isScene(entity)) return {};
    await this.init();
    const res = await p(cb => this.alexa.querySmarthomeDevices([entity.applianceId], 'APPLIANCE', 5000, cb));
    const st = { power: undefined, brightness: undefined, reachable: undefined };
    const states = [];
    const walk = o => {
      if (!o || typeof o !== 'object') return;
      if (o.capabilityStates !== undefined || o.entity !== undefined) states.push(o);
      for (const v of Object.values(o)) walk(v);
    };
    walk(res);
    for (const s of states) {
      if (s.error) st.reachable = false;
      for (const raw of s.capabilityStates || []) {
        const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (c.name === 'powerState') st.power = c.value;
        if (c.name === 'brightness') st.brightness = Number(c.value);
        if (c.name === 'connectivity') st.reachable = c.value && c.value.value === 'OK';
      }
    }
    return st;
  }

  async routines() {
    await this.init();
    const list = await p(cb => this.alexa.getAutomationRoutines(2000, cb));
    return (list || []).map(r => ({
      name: (r.name && String(r.name).trim()) || routineUtterance(r) || r.automationId,
      utterance: routineUtterance(r),
      raw: r,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async runRoutine(name, echoName) {
    const list = await this.routines();
    const r = list.find(x => x.name === name) || list.find(x => x.utterance === name)
      || list.find(x => x.name.includes(name));
    if (!r) throw new Error(`Routine not found: ${name}`);
    return p(cb => this.alexa.executeAutomationRoutine(this.echoSerial(echoName), r.raw, cb));
  }

  // Sends text as if it were spoken to the Echo ("turn on the living room light", ...).
  async textCommand(text, echoName) {
    await this.init();
    return p(cb => this.alexa.sendSequenceCommand(this.echoSerial(echoName), 'textCommand', text, cb));
  }
}

function routineUtterance(r) {
  const t = (r.triggers || []).find(x => x.payload && x.payload.utterance);
  return t ? t.payload.utterance : '';
}

module.exports = { AlexaClient, isScene };

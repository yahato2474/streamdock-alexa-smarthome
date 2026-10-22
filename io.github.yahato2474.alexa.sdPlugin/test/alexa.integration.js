// End-to-end test against YOUR Alexa account: drives the real plugin through a fake Stream Dock,
// operates one dimmable light and restores its original state afterwards.
//
//   TEST_LIGHT="Desk light strip" node test/alexa.integration.js
//   optional: TEST_TEXT="turn on the desk light strip"   (sent via an Echo; the Echo may answer aloud)
//             TEST_SCENE="Lights on"                     (activates a scene; it really runs)
const assert = require('node:assert');
const { AlexaClient } = require('../plugin/alexa');
const { UUID } = require('../plugin/actions');
const { startHost } = require('./harness');

const LIGHT = process.env.TEST_LIGHT;
const TEXT = process.env.TEST_TEXT;
const SCENE = process.env.TEST_SCENE;
if (!LIGHT) {
  console.error('Set TEST_LIGHT to the Alexa name of a dimmable light (see: node tools/list.js)');
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = (event, action, context, settings, extra = {}) =>
  ({ event, action: UUID[action], context, device: 'dev', payload: { settings, ...extra } });

(async () => {
  const alexa = new AlexaClient(() => {});
  const entity = await alexa.findEntity(LIGHT);
  assert.ok(entity, `${LIGHT} not found in Alexa`);
  const original = await alexa.state(entity);
  console.log(`${LIGHT}: original`, original);

  // Poll slowly: Amazon rate-limits bursts of state queries.
  async function until(pred, what, ms = 60000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(4000)) {
      const st = await alexa.state(entity).catch(() => ({}));
      if (pred(st)) return st;
    }
    assert.fail(`timed out waiting for ${what}`);
  }
  const done = (host, ctx) => host.waitFor(m => (m.event === 'showOk' || m.event === 'showAlert') && m.context === ctx, 90000)
    .then(m => assert.strictEqual(m.event, 'showOk', `${ctx} failed`));

  const host = await startHost();
  let failed = false;
  try {
    const s = { device: LIGHT };
    host.send(ev('willAppear', 'power', 'P', s));
    await host.waitFor(m => m.event === 'setTitle' && m.context === 'P' && m.payload.title === LIGHT, 20000);
    console.log('  power key rendered ✓');

    const want = original.power === 'ON' ? 'OFF' : 'ON';
    host.send(ev('keyUp', 'power', 'P', s));
    await done(host, 'P');
    await until(st => st.power === want, `power ${want}`);
    console.log(`  power key -> ${want} ✓`);

    host.send(ev('keyUp', 'power', 'P2', { ...s, mode: 'on' }));
    await done(host, 'P2');
    await until(st => st.power === 'ON', 'power ON');
    host.send(ev('willAppear', 'brightness', 'D', { ...s, step: 10 }));
    const start = Number.isFinite(original.brightness) ? original.brightness : 50;
    const target = start > 50 ? start - 30 : start + 30;
    for (let i = 0; i < 3; i++) {
      host.send(ev('dialRotate', 'brightness', 'D', { ...s, step: 10 }, { ticks: start > 50 ? -1 : 1 }));
      await sleep(80);
    }
    await done(host, 'D');
    await until(st => st.brightness === target, `brightness ${target}`);
    console.log(`  knob 3 ticks -> ${target}% ✓`);

    host.clear();
    host.send(ev('dialUp', 'brightness', 'D', s));
    await done(host, 'D');
    await until(st => st.power === 'OFF', 'power OFF via knob push');
    console.log('  knob push -> OFF ✓');

    if (TEXT) {
      host.send(ev('keyUp', 'text', 'T', { text: TEXT }));
      await done(host, 'T');
      await until(st => st.power === 'ON', 'power ON via text', 30000);
      console.log(`  text "${TEXT}" -> ON ✓`);
    }
    if (SCENE) {
      host.send(ev('keyUp', 'power', 'S', { device: SCENE }));
      await done(host, 'S');
      console.log(`  scene "${SCENE}" activated ✓`);
    }

    host.send(ev('keyUp', 'routine', 'R', { routine: '__no_such_routine__' }));
    await host.waitFor(m => m.event === 'showAlert' && m.context === 'R', 20000);
    console.log('  unknown routine -> alert ✓');
  } catch (e) {
    failed = true;
    console.error('FAIL:', e.message);
  } finally {
    if (Number.isFinite(original.brightness) && original.brightness > 0) await alexa.setBrightness(entity, original.brightness).catch(() => {});
    await sleep(1500);
    await alexa.setPower(entity, original.power === 'ON').catch(() => {});
    await sleep(3000);
    console.log('restored:', await alexa.state(entity));
    await host.stop();
    process.exit(failed ? 1 : 0);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

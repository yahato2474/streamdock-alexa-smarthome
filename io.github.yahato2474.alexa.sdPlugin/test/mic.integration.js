// Pushes the brightness knob (press = mic) through the real plugin and checks the real microphone,
// then restores its mute state. Needs bin/micmute. No Alexa calls are required.
//   node test/mic.integration.js
const assert = require('node:assert');
const mic = require('../plugin/mic');
const { UUID } = require('../plugin/actions');
const { startHost } = require('./harness');

const ev = (event, context, settings) =>
  ({ event, action: UUID.brightness, context, device: 'dev', payload: { settings } });

(async () => {
  const original = await mic.micState();
  console.log('mic:', original);
  const host = await startHost();
  let failed = false;
  try {
    const s = { device: '__none__', press: 'mic', feedbackSound: false };
    for (const want of [!original.muted, original.muted]) {
      host.clear();
      host.send(ev('dialUp', 'K', s));
      await host.waitFor(m => m.event === 'showOk' && m.context === 'K', 10000);
      assert.strictEqual((await mic.micState()).muted, want);
      console.log(`  knob push -> mic ${want ? 'muted' : 'unmuted'} ✓`);
    }
  } catch (e) {
    failed = true;
    console.error('FAIL:', e.message);
  } finally {
    if ((await mic.micState()).muted !== original.muted) await mic.micToggle();
    console.log('restored mic:', await mic.micState());
    await host.stop();
    process.exit(failed ? 1 : 0);
  }
})();

// Prints the Alexa smart-home devices, routines and Echo devices this login can see.
//   node tools/list.js
const { AlexaClient } = require('../plugin/alexa');
const { kindOf } = require('../plugin/actions');

(async () => {
  const c = new AlexaClient(process.env.DEBUG ? console.log : () => {});
  const [ents, routines, echoes] = await Promise.all([c.entities(), c.routines(), c.echoNames()]);
  console.log(`== Devices (${ents.length})`);
  for (const e of ents) console.log(`  [${kindOf(e)}] ${e.name}  <${e.manufacturer}> ${e.types.join(',')}`);
  console.log(`== Routines (${routines.length})`);
  for (const r of routines) console.log(`  ${r.name}${r.utterance && r.utterance !== r.name ? `  ("${r.utterance}")` : ''}`);
  console.log(`== Echo devices (${echoes.length})\n  ${echoes.join('\n  ')}`);
  process.exit(0);
})().catch(e => { console.error('ERROR', e.message || e); process.exit(1); });

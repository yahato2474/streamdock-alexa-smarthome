// Idempotent patches for alexa-cookie2's login proxy (runs as npm postinstall).
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', 'alexa-cookie2', 'lib', 'proxy.js');
let src = fs.readFileSync(file, 'utf8');

const patches = [
  {
    // The OAuth extension namespace is a fixed identifier. With a regional host (amazon.co.jp) Amazon
    // silently ignores the extension and never returns openid.oa2.authorization_code, so the login
    // never completes. Allow overriding the host (plugin/config.js sets www.amazon.com for Japan).
    id: 'oa2-namespace',
    from: 'openid.ns.oa2=http%3A%2F%2Fwww.${_options.baseAmazonPage}%2Fap%2Fext%2Foauth%2F2',
    to: "openid.ns.oa2=http%3A%2F%2F${_options.oa2NamespaceHost || ('www.' + _options.baseAmazonPage)}%2Fap%2Fext%2Foauth%2F2",
  },
];

let changed = false;
for (const p of patches) {
  if (src.includes(p.to)) continue;
  if (!src.includes(p.from)) {
    console.error(`alexa-cookie2 patch "${p.id}": expected code not found (library version changed?)`);
    process.exitCode = 1;
    continue;
  }
  src = src.replace(p.from, p.to);
  changed = true;
  console.log(`alexa-cookie2 patched: ${p.id}`);
}
if (changed) fs.writeFileSync(file, src);
else if (!process.exitCode) console.log('alexa-cookie2 already patched');

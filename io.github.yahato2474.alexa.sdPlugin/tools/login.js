// One-time Amazon login. Starts a local login proxy on http://127.0.0.1:3456/; you sign in to Amazon
// yourself in the browser and the resulting Alexa token is saved to ~/.config/streamdock-alexa/alexa.json.
//   node tools/login.js [--region amazon.co.jp]
const readline = require('readline');
const { execFile } = require('child_process');
const AlexaRemote = require('alexa-remote2');
const config = require('../plugin/config');

const PORT = 3456;
const URL = `http://127.0.0.1:${PORT}/`;

function argRegion() {
  const i = process.argv.indexOf('--region');
  return i > 0 ? process.argv[i + 1] : null;
}

async function askRegion(current) {
  const regions = Object.keys(config.REGIONS);
  if (!process.stdin.isTTY) return current;
  console.log('Amazon のドメイン / Amazon marketplace:');
  regions.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}) ${r}${r === current ? '  (current)' : ''}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(r => rl.question(`番号 / number [${regions.indexOf(current) + 1}]: `, r));
  rl.close();
  const n = Number(answer.trim());
  return n >= 1 && n <= regions.length ? regions[n - 1] : current;
}

(async () => {
  const cfg = config.loadConfig();
  const region = argRegion() || await askRegion(cfg.amazonPage);
  if (!config.REGIONS[region]) {
    console.error(`Unknown marketplace: ${region}. Use one of: ${Object.keys(config.REGIONS).join(', ')}`);
    process.exit(1);
  }
  config.saveConfig({ ...cfg, amazonPage: region });

  const alexa = new AlexaRemote();
  let opened = false;
  const openBrowser = () => {
    if (opened) return;
    opened = true;
    console.log(`\nブラウザで ${URL} を開き、${region} にログインしてください（パスキーではなくパスワードで）。`);
    console.log(`Open ${URL} in your browser and sign in to ${region} (use your password, not a passkey).`);
    if (!process.env.NO_OPEN) execFile('/usr/bin/open', [URL], () => {});
  };

  alexa.on('cookie', () => {
    if (!alexa.cookieData) return;
    config.saveCookie({ ...alexa.cookieData, amazonPage: region });
    console.log(`\n✅ Saved: ${config.COOKIE_FILE}`);
  });

  alexa.init({
    ...config.regionOptions(region),
    proxyOnly: true,
    proxyOwnIp: '127.0.0.1',
    proxyPort: PORT,
    proxyLogLevel: 'warn',
    useWsMqtt: false,
    usePushConnectType: 0,
    bluetooth: false,
    logger: msg => { if (String(msg).includes(`listening on port ${PORT}`)) openBrowser(); },
  }, err => {
    // alexa-remote2 reports "please open the proxy" as an error, then calls back again after login.
    if (err && /Please open/i.test(String(err.message || err))) return openBrowser();
    if (err) {
      console.error('Login failed:', err.message || err);
      process.exit(1);
    }
    const names = Object.values(alexa.serialNumbers || {}).map(d => d.accountName);
    console.log(`Alexa に接続しました / Connected. Devices: ${names.length}`);
    console.log('このウィンドウは閉じてかまいません / You can close this window.');
    setTimeout(() => process.exit(0), 1000);
  });
})();

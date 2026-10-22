// Where the login is stored and which Amazon marketplace it belongs to.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = process.env.STREAMDOCK_ALEXA_DIR || path.join(os.homedir(), '.config', 'streamdock-alexa');
const COOKIE_FILE = path.join(CONFIG_DIR, 'alexa.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Marketplaces supported by the Alexa app. [Accept-Language, login page language]
const REGIONS = {
  'amazon.co.jp': ['ja-JP', 'ja_JP'],
  'amazon.com': ['en-US', 'en_US'],
  'amazon.ca': ['en-CA', 'en_CA'],
  'amazon.co.uk': ['en-GB', 'en_GB'],
  'amazon.de': ['de-DE', 'de_DE'],
  'amazon.fr': ['fr-FR', 'fr_FR'],
  'amazon.it': ['it-IT', 'it_IT'],
  'amazon.es': ['es-ES', 'es_ES'],
  'amazon.com.au': ['en-AU', 'en_AU'],
  'amazon.in': ['en-IN', 'en_IN'],
  'amazon.com.br': ['pt-BR', 'pt_BR'],
  'amazon.com.mx': ['es-MX', 'es_MX'],
};

// On amazon.co.jp the OAuth extension is silently ignored unless its namespace uses www.amazon.com
// (see tools/patch-alexa-cookie.js). Other marketplaces keep the library's default.
const OA2_NAMESPACE_HOST = { 'amazon.co.jp': 'www.amazon.com' };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writePrivate(file, data) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, data, { mode: 0o600 });
}

function loadConfig() {
  return { amazonPage: 'amazon.co.jp', ...(readJson(CONFIG_FILE) || {}) };
}

function saveConfig(cfg) {
  writePrivate(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function regionOptions(amazonPage = loadConfig().amazonPage) {
  const [acceptLanguage, proxyLanguage] = REGIONS[amazonPage] || ['en-US', 'en_US'];
  return {
    amazonPage,
    baseAmazonPage: amazonPage,
    alexaServiceHost: `alexa.${amazonPage}`,
    acceptLanguage,
    amazonPageProxyLanguage: proxyLanguage,
    // Name shown under "Your devices" on Amazon, so the login can be found and revoked later.
    deviceAppName: 'StreamDock Alexa',
    ...(OA2_NAMESPACE_HOST[amazonPage] ? { oa2NamespaceHost: OA2_NAMESPACE_HOST[amazonPage] } : {}),
  };
}

function loadCookie() {
  return readJson(COOKIE_FILE);
}

let lastWritten = 0;
function saveCookie(data) {
  const json = JSON.stringify(data);
  // alexa-remote2 emits "cookie" on every start even when nothing changed; avoid needless rewrites.
  try { if (fs.readFileSync(COOKIE_FILE, 'utf8') === json) return; } catch (_) { /* first save */ }
  lastWritten = Date.now();
  writePrivate(COOKIE_FILE, json);
}

module.exports = {
  CONFIG_DIR, COOKIE_FILE, CONFIG_FILE, REGIONS,
  loadConfig, saveConfig, regionOptions, loadCookie, saveCookie,
  lastCookieWrite: () => lastWritten,
};

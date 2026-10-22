// Generates the plugin's key images from simple hand-made SVG glyphs.
// usage: node assets/make-icons.js   (needs rsvg-convert: brew install librsvg)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVG_DIR = path.join(__dirname, 'svg');
const OUT = path.join(ROOT, 'io.github.yahato2474.alexa.sdPlugin', 'images');

const C = {
  on: ['#4A3A10', '#FFD34D'],
  off: ['#262626', '#6E6E6E'],
  alexa: ['#0B3B4F', '#4FD1FF'],
  error: ['#5A1E1E', '#FF8A8A'],
  login: ['#5A3A10', '#FFB86B'],
  plain: ['#202830', '#9FD3FF'],
};

// Glyphs are drawn in a 64x64 box. "fg" / "bg" are replaced by the palette colours.
const S = 'stroke="fg" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const G = {
  power: `<path ${S} d="M21 17 A22 22 0 1 0 43 17"/><path ${S} d="M32 6 V32"/>`,
  bulb: `<circle cx="32" cy="25" r="18" fill="fg"/><rect x="24" y="36" width="16" height="10" rx="2" fill="fg"/>
         <path ${S} d="M25 52 H39 M28 59 H36"/>`,
  plug: `<path ${S} d="M25 22 V8 M39 22 V8 M32 46 V60"/><rect x="15" y="20" width="34" height="27" rx="7" fill="fg"/>`,
  remote: `<rect x="19" y="4" width="26" height="56" rx="9" ${S}/><circle cx="32" cy="18" r="5" fill="fg"/>
           <circle cx="26.5" cy="34" r="3.2" fill="fg"/><circle cx="37.5" cy="34" r="3.2" fill="fg"/>
           <circle cx="26.5" cy="45" r="3.2" fill="fg"/><circle cx="37.5" cy="45" r="3.2" fill="fg"/>`,
  scene: `<path fill="fg" d="M27 12 L32 30 L50 35 L32 40 L27 58 L22 40 L4 35 L22 30 Z"/>
          <path fill="fg" d="M50 2 L52.6 9.4 L60 12 L52.6 14.6 L50 22 L47.4 14.6 L40 12 L47.4 9.4 Z"/>`,
  routine: `<circle cx="32" cy="32" r="26" ${S}/><path fill="fg" d="M26 19 L47 32 L26 45 Z"/>`,
  text: `<path fill="fg" d="M10 8 H54 A7 7 0 0 1 61 15 V39 A7 7 0 0 1 54 46 H29 L16 57 V46 H10 A7 7 0 0 1 3 39 V15 A7 7 0 0 1 10 8 Z"/>
         <path stroke="bg" stroke-width="5" stroke-linecap="round" d="M15 21 H49 M15 33 H38"/>`,
  sun: `<circle cx="32" cy="32" r="12" fill="fg"/>` +
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      const p = r => [32 + r * Math.cos(a), 32 + r * Math.sin(a)].map(v => v.toFixed(1)).join(' ');
      return `<path ${S} d="M${p(20)} L${p(28)}"/>`;
    }).join(''),
  micOff: `<rect x="23" y="4" width="18" height="32" rx="9" fill="fg"/><path ${S} d="M15 28 A17 17 0 0 0 49 28 M32 45 V56 M23 58 H41"/>
           <path stroke="bg" stroke-width="13" stroke-linecap="round" d="M9 6 L55 58"/><path ${S} d="M9 6 L55 58"/>`,
  login: `<circle cx="25" cy="18" r="11" fill="fg"/><path fill="fg" d="M5 56 A20 18 0 0 1 45 56 Z"/>
          <path ${S} d="M54 10 V36"/><circle cx="54" cy="49" r="4.5" fill="fg"/>`,
  error: `<path ${S} d="M32 6 L60 56 H4 Z"/><path ${S} d="M32 24 V38"/><circle cx="32" cy="47" r="4" fill="fg"/>`,
  home: `<path ${S} d="M6 31 L32 8 L58 31"/><path ${S} d="M14 26 V56 H50 V26"/><circle cx="32" cy="40" r="7" fill="fg"/>`,
};

// name -> [glyph, palette, centred?]  centred=false leaves room for the key title at the bottom.
const ICONS = {
  'power-on': ['power', 'on'], 'power-off': ['power', 'off'],
  'light-on': ['bulb', 'on'], 'light-off': ['bulb', 'off'],
  'plug-on': ['plug', 'on'], 'plug-off': ['plug', 'off'],
  'remote-on': ['remote', 'on'], 'remote-off': ['remote', 'off'],
  scene: ['scene', 'alexa'],
  routine: ['routine', 'alexa'],
  text: ['text', 'alexa'],
  brightness: ['sun', 'on'],
  'mic-muted': ['micOff', 'error'],
  login: ['login', 'login'],
  error: ['error', 'error'],
  // Action-list icons (centred, no title underneath).
  'action-power': ['power', 'on', true],
  'action-brightness': ['sun', 'on', true],
  'action-routine': ['routine', 'alexa', true],
  'action-text': ['text', 'alexa', true],
  plugin: ['home', 'plain', true],
};

function svg(glyph, [bg, fg], centred, transparent = false) {
  const g = G[glyph].replace(/"fg"/g, `"${fg}"`).replace(/"bg"/g, `"${bg}"`);
  const y = centred ? 40 : 28;
  const back = transparent ? '' : `<rect width="144" height="144" rx="26" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144" width="144" height="144">${back}` +
    `<g transform="translate(40 ${y})">${g}</g></svg>\n`;
}

fs.mkdirSync(SVG_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const all = { ...ICONS, category: ['home', ['#000000', '#FFFFFF'], true, true] };
for (const [name, [glyph, pal, centred, transparent]] of Object.entries(all)) {
  const file = path.join(SVG_DIR, `${name}.svg`);
  fs.writeFileSync(file, svg(glyph, typeof pal === 'string' ? C[pal] : pal, !!centred, !!transparent));
  const size = name === 'category' ? 28 : 72;
  execFileSync('rsvg-convert', ['-w', String(size * 2), '-h', String(size * 2), file, '-o', path.join(OUT, `${name}.png`)]);
  execFileSync('rsvg-convert', ['-w', String(size * 4), '-h', String(size * 4), file, '-o', path.join(OUT, `${name}@2x.png`)]);
}
console.log(`wrote ${Object.keys(all).length} icons to ${path.relative(ROOT, OUT)}`);

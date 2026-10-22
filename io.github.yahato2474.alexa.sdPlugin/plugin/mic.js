// Optional microphone mute for the brightness knob, via bin/micmute (CoreAudio, built by install.sh).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MICMUTE = path.join(__dirname, '..', 'bin', 'micmute');

function run(args) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MICMUTE)) return reject(new Error('bin/micmute is missing (run install.sh with Xcode Command Line Tools)'));
    execFile(MICMUTE, args, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(JSON.parse(stdout));
    });
  });
}

// Each returns { device, muted, method } for the default input device.
const micState = () => run(['get']);
const micToggle = () => run(['toggle']);

function playMicFeedback(muted) {
  const sound = muted ? 'Bottle' : 'Tink';
  execFile('/usr/bin/afplay', ['-v', '0.5', `/System/Library/Sounds/${sound}.aiff`], () => {});
}

module.exports = { micState, micToggle, playMicFeedback, available: () => fs.existsSync(MICMUTE) };

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidates = [
  path.join(os.homedir(), '.config', 'terminal-messenger'),
  path.join(os.homedir(), 'Library', 'Application Support', 'terminal-messenger'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-messenger')
];

for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    fs.rmSync(candidate, { recursive: true, force: true });
    console.log(`Removed ${candidate}`);
  }
}

/* eslint-disable */
// Merge `import { Directive } from '@angular/core'` no import existente do core.
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.store.ts')) out.push(p);
  }
  return out;
}

const files = walk('src/app/features');
let n = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes("import { Directive } from '@angular/core';")) continue;
  const m = s.match(/import \{([^}]+)\} from '@angular\/core';/);
  if (!m || m[0].includes('Directive')) continue;
  s = s.replace(m[0], `import {${m[1].replace(/\s+$/, '')}, Directive } from '@angular/core';`);
  s = s.replace(/\nimport \{ Directive \} from '@angular\/core';/, '');
  fs.writeFileSync(f, s);
  n++;
}
console.log('merged', n);

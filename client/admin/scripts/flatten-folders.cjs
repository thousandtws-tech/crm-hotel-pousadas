/* eslint-disable */
// Reverte organize-folders.cjs: sobe arquivos de features/<feat>/<x>/
// para features/<feat>/ e reescreve imports relativos.
// Uso: node scripts/flatten-folders.cjs

const fs = require('fs');
const path = require('path');

const FEAT = path.resolve(__dirname, '../src/app/features');
const SRC = path.resolve(__dirname, '../src');
const posix = (p) => p.split(path.sep).join('/');

// 1. Descobre subpastas dentro de features/<feat>/ e move arquivos pra cima
const moveMap = new Map(); // abs sem ext -> abs sem ext
const moves = [];

for (const feat of fs.readdirSync(FEAT, { withFileTypes: true })) {
  if (!feat.isDirectory()) continue;
  const featDir = path.join(FEAT, feat.name);
  for (const sub of fs.readdirSync(featDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subDir = path.join(featDir, sub.name);
    for (const f of fs.readdirSync(subDir)) {
      const from = path.join(subDir, f);
      const to = path.join(featDir, f);
      moves.push({ from, to });
      moveMap.set(posix(from).replace(/\.[^.]+$/, ''), posix(to).replace(/\.[^.]+$/, ''));
    }
  }
}

for (const m of moves) fs.renameSync(m.from, m.to);
// remove subpastas agora vazias
for (const feat of fs.readdirSync(FEAT, { withFileTypes: true })) {
  if (!feat.isDirectory()) continue;
  const featDir = path.join(FEAT, feat.name);
  for (const sub of fs.readdirSync(featDir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const subDir = path.join(featDir, sub.name);
    if (fs.readdirSync(subDir).length === 0) fs.rmdirSync(subDir);
  }
}

// 2. Reescreve imports relativos
const movedFrom = new Map(); // newAbs -> oldDir
for (const m of moves) movedFrom.set(posix(m.to), posix(path.dirname(m.from)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const rel = /(from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
let rewrote = 0;

for (const file of walk(SRC)) {
  let src = fs.readFileSync(file, 'utf8');
  const thisDir = posix(path.dirname(file));
  let changed = false;
  src = src.replace(rel, (m, pre, spec) => {
    // diretorio onde o specifier era valido ANTES do move
    const oldDir = movedFrom.get(posix(file)) || thisDir;
    const oldAbs = posix(path.resolve(oldDir, spec));
    const targetAbs = moveMap.get(oldAbs) || oldAbs;
    let newSpec = posix(path.relative(thisDir, targetAbs));
    if (!newSpec.startsWith('.')) newSpec = './' + newSpec;
    if (newSpec === spec) return m;
    changed = true;
    return `${pre}'${newSpec}'`;
  });
  if (changed) { fs.writeFileSync(file, src); rewrote++; }
}

console.log(`moved: ${moves.length}, rewrote: ${rewrote}`);

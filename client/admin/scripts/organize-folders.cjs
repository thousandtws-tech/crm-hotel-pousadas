/* eslint-disable */
// Move cada x.component.* + x.store.ts (+ spec/const associados) para
// subpasta propria: features/<feat>/<x>/...
// e reescreve imports relativos em todo src/.
// Uso: node scripts/organize-folders.cjs

const fs = require('fs');
const path = require('path');

const FEAT = path.resolve(__dirname, '../src/app/features');
const SRC = path.resolve(__dirname, '../src');

const posix = (p) => p.split(path.sep).join('/');

// ---------- 1. Descobre componentes e arquivos associados ----------
const features = fs.readdirSync(FEAT, { withFileTypes: true }).filter((d) => d.isDirectory());
const moveMap = new Map(); // abs sem ext -> abs sem ext
const moves = []; // {from, to}

for (const f of features) {
  const dir = path.join(FEAT, f.name);
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.component.ts'));
  for (const comp of files) {
    const prefix = comp.replace(/\.component\.ts$/, '');
    const destDir = path.join(dir, prefix);
    const candidates = [
      `${prefix}.component.ts`, `${prefix}.component.html`, `${prefix}.component.css`,
      `${prefix}.component.spec.ts`, `${prefix}.store.ts`, `${prefix}.store.spec.ts`,
      `${prefix}.const.ts`, `${prefix}.models.ts`, `${prefix}.utils.ts`,
    ];
    for (const c of candidates) {
      const src = path.join(dir, c);
      if (fs.existsSync(src)) {
        const dst = path.join(destDir, c);
        moves.push({ from: src, to: dst });
        moveMap.set(posix(src).replace(/\.[^.]+$/, ''), posix(dst).replace(/\.[^.]+$/, ''));
      }
    }
  }
}

// ---------- 2. Move ----------
const dirCache = new Map();
for (const m of moves) {
  const d = path.dirname(m.to);
  if (!dirCache.has(d)) { fs.mkdirSync(d, { recursive: true }); dirCache.set(d, true); }
  fs.renameSync(m.from, m.to);
}
// remove dirs vazios deixados para trás? (feat root continua com arquivos soltos — ok)

// ---------- 3. Reescreve imports relativos ----------
const fileNewDir = new Map();
for (const m of moves) fileNewDir.set(posix(m.from), posix(path.dirname(m.to)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const allTs = walk(SRC);
const rel = /(from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
let rewrote = 0;

for (const file of allTs) {
  let src = fs.readFileSync(file, 'utf8');
  const thisDir = posix(path.dirname(file));
  // descobre o caminho ANTIGO deste arquivo (para resolver specifiers antigos)
  let oldDir = thisDir;
  for (const [oldAbs, newAbsDir] of fileNewDir) {
    // file está na nova localização; procura no moveMap a entrada cujo .to == file
  }
  // inverte: acha o from cujo to == file
  let changed = false;
  src = src.replace(rel, (m, pre, spec) => {
    // diretório de onde o specifier era válido ANTES do move
    // = dir atual se arquivo não moveu; senão, dir antigo
    let origDir = thisDir;
    for (const mv of moves) {
      if (posix(mv.to) === posix(file)) { origDir = posix(path.dirname(mv.from)); break; }
    }
    const oldAbs = posix(path.resolve(origDir, spec));
    const newAbs = moveMap.get(oldAbs);
    const targetAbs = newAbs || oldAbs;
    let newSpec = posix(path.relative(thisDir, targetAbs));
    if (!newSpec.startsWith('.')) newSpec = './' + newSpec;
    if (newSpec === spec) return m;
    changed = true;
    return `${pre}'${newSpec}'`;
  });
  if (changed) { fs.writeFileSync(file, src); rewrote++; }
}

console.log(`moved: ${moves.length} files, rewrote imports in ${rewrote} files`);

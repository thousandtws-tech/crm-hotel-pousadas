/* eslint-disable */
// Extrai template/styles inline de x.component.ts para
// x.component.html / x.component.css (templateUrl/styleUrl).
// Uso: node scripts/extract-views.cjs <arquivo> [--apply]

const fs = require('fs');
const path = require('path');

// Encontra a posição final de um literal `...` começando em `start` (o `).
function tplEnd(src, start) {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i;
    i++;
  }
  return -1;
}

// Desescapa sequências de template literal para o conteúdo real do arquivo.
function unescapeTpl(s) {
  return s
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\');
}

function extract(file) {
  const src = fs.readFileSync(file, 'utf8');
  const base = file.replace(/\.component\.ts$/, '');
  let out = src;
  const ops = [];

  // --- template: `...` -------------------------------------------------
  const tIdx = out.search(/\btemplate\s*:\s*`/);
  if (tIdx >= 0) {
    const tickStart = out.indexOf('`', tIdx);
    const tickEnd = tplEnd(out, tickStart);
    const content = unescapeTpl(out.slice(tickStart + 1, tickEnd)).replace(/^\r?\n/, '').replace(/[ \t]+$/g, (m) => m);
    fs.writeFileSync(`${base}.component.html`, content.trim() + '\n');
    const prefix = out.slice(0, tIdx);
    const suffix = out.slice(tickEnd + 1);
    out = `${prefix}templateUrl: './${path.basename(base)}.component.html'${suffix}`;
    ops.push('html');
  }

  // --- styles: `...` ou styles: [`...`, ...] ----------------------------
  const sIdx = out.search(/\bstyles\s*:/);
  if (sIdx >= 0) {
    const after = out.slice(sIdx);
    const colon = after.indexOf(':');
    const rest = after.slice(colon + 1).trimStart();
    if (rest.startsWith('`')) {
      const absTick = out.indexOf('`', out.indexOf(':', sIdx));
      const tickEnd = tplEnd(out, absTick);
      const content = unescapeTpl(out.slice(absTick + 1, tickEnd));
      fs.writeFileSync(`${base}.component.css`, content.trim() + '\n');
      out = `${out.slice(0, sIdx)}styleUrl: './${path.basename(base)}.component.css'${out.slice(tickEnd + 1)}`;
      ops.push('css');
    } else if (rest.startsWith('[')) {
      // styles: [`...`] — extrai cada literal
      const arrStart = out.indexOf('[', out.indexOf(':', sIdx));
      // fim do array = primeiro ] após os literais (conteúdo pode conter ]?)
      let i = arrStart + 1;
      const chunks = [];
      while (i < out.length) {
        if (out[i] === '`') {
          const e = tplEnd(out, i);
          chunks.push(unescapeTpl(out.slice(i + 1, e)));
          i = e + 1;
        } else if (out[i] === ']') break;
        else i++;
      }
      fs.writeFileSync(`${base}.component.css`, chunks.map((c) => c.trim()).join('\n\n') + '\n');
      out = `${out.slice(0, sIdx)}styleUrls: ['./${path.basename(base)}.component.css']${out.slice(i + 1)}`;
      ops.push('css[]');
    }
  }

  fs.writeFileSync(file, out);
  return ops;
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const f of targets) {
  try {
    const ops = extract(f);
    console.log(`OK ${f} [${ops.join(',')}]`);
  } catch (e) {
    console.log(`ERR ${f}: ${e.message}`);
  }
}

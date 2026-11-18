/* eslint-disable */
// Split mecânico: X.component.ts -> X.component.ts (UI) + X.store.ts (lógica).
// Uso: node scripts/split-components.cjs <arquivo> [--apply]
// Sem --apply, mostra o plano (dry-run).

const fs = require('fs');
const path = require('path');

// Balanceia o '({ ... })' do decorador respeitando strings, comentários
// e interpolações ${} dentro de template literals.
function findEnd(src, startIdx) {
  const open = src.indexOf('(', startIdx);
  let i = open;
  const stack = []; // o '(' inicial é empilhado pelo próprio loop
  let mode = 'code';
  const modeStack = [];
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'line') {
      if (c === '\n') mode = modeStack.pop() || 'code';
    } else if (mode === 'block') {
      if (c === '*' && n === '/') {
        mode = modeStack.pop() || 'code';
        i++;
      }
    } else if (mode === 'squote') {
      if (c === '\\') i++;
      else if (c === "'") mode = modeStack.pop() || 'code';
    } else if (mode === 'dquote') {
      if (c === '\\') i++;
      else if (c === '"') mode = modeStack.pop() || 'code';
    } else if (mode === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') mode = modeStack.pop() || 'code';
      else if (c === '$' && n === '{') {
        modeStack.push('tpl');
        mode = 'code';
        stack.push('{');
        i++;
      }
    } else {
      if (c === '/' && n === '/') {
        modeStack.push(mode);
        mode = 'line';
        i++;
      } else if (c === '/' && n === '*') {
        modeStack.push(mode);
        mode = 'block';
        i++;
      } else if (c === "'") {
        modeStack.push(mode);
        mode = 'squote';
      } else if (c === '"') {
        modeStack.push(mode);
        mode = 'dquote';
      } else if (c === '`') {
        modeStack.push(mode);
        mode = 'tpl';
      } else if (c === '(' || c === '{' || c === '[') stack.push(c);
      else if (c === ')' || c === '}' || c === ']') {
        stack.pop();
        if (modeStack.length && stack.length && stack[stack.length - 1] !== '{') {
          // nada
        }
        if (stack.length === 0) return i + 1;
        // Se fechou um '{' que abriu interpolação, volta pro modo tpl
        // (a pilha de modos já cuida: quando '{' de ${ é fechado, o
        // topo da modeStack é 'tpl').
        if (stack.length && c === '}' && stack[stack.length - 1] !== '{') {
          // noop — a interpolação fecha quando stack retira o '{' dela
        }
      }
      // Se acabou de fechar o '{' de uma interpolação, retorna ao tpl
      if (mode === 'code' && c === '}' && modeStack.length && modeStack[modeStack.length - 1] === 'tpl' && stack.length && stack[stack.length - 1] !== '{') {
        mode = modeStack.pop();
      }
    }
    i++;
  }
  return -1;
}

function parseImports(importsBlock) {
  // Devolve lista de {stmt, names:[{local, imported}], from}
  const re = /import\s+([^'";]+?)\s+from\s+['"][^'"]+['"];?/gs;
  const out = [];
  let m;
  while ((m = re.exec(importsBlock))) {
    const isType = /^\s*import\s+type\b/.test(m[0]);
    const clause = m[1].trim().replace(/^type\s+/, '');
    const names = [];
    if (clause.startsWith('{')) {
      const inner = clause.slice(1, clause.lastIndexOf('}'));
      for (const part of inner.split(',')) {
        const p = part.trim();
        if (!p) continue;
        const clean = p.replace(/^type\s+/, '');
        const as = clean.split(/\s+as\s+/);
        names.push({ local: as[1] ? as[1].trim() : as[0].trim(), imported: as[0].trim() });
      }
    } else if (clause.startsWith('*')) {
      const as = clause.split(/\s+as\s+/);
      names.push({ local: as[1].trim(), imported: '*' });
    } else if (clause.includes(',')) {
      const [def, rest] = clause.split(/,(.+)/);
      names.push({ local: def.trim(), imported: 'default' });
      const inner = rest.trim().slice(1, rest.trim().lastIndexOf('}'));
      for (const part of inner.split(',')) {
        const p = part.trim();
        if (!p) continue;
        const clean = p.replace(/^type\s+/, '');
        const as = clean.split(/\s+as\s+/);
        names.push({ local: as[1] ? as[1].trim() : as[0].trim(), imported: as[0].trim() });
      }
    } else {
      names.push({ local: clause, imported: 'default' });
    }
    out.push({ stmt: m[0], names, isType });
  }
  return out;
}

function usedNames(text, names) {
  const used = new Set();
  for (const { local } of names) {
    if (new RegExp(`\\b${local.replace(/[$]/g, '\\$')}\\b`).test(text)) used.add(local);
  }
  return used;
}

function rebuildImport(stmt, names, keep, isType) {
  const kept = names.filter((n) => keep.has(n.local));
  if (!kept.length) return null;
  const from = stmt.match(/from\s+['"][^'"]+['"]/)[0];
  const kw = isType ? 'import type' : 'import';
  const parts = kept.map((n) => {
    if (n.imported === '*') return `* as ${n.local}`;
    if (n.imported === 'default') return n.local;
    return n.imported === n.local ? n.imported : `${n.imported} as ${n.local}`;
  });
  const hasDefault = kept.some((n) => n.imported === 'default');
  const hasStar = kept.some((n) => n.imported === '*');
  const named = kept.filter((n) => n.imported !== 'default' && n.imported !== '*');
  if (hasStar) return `${kw} ${parts.join(', ')} ${from};`;
  if (hasDefault && named.length)
    return `${kw} ${kept.find((n) => n.imported === 'default').local}, { ${named
      .map((n) => (n.imported === n.local ? n.imported : `${n.imported} as ${n.local}`))
      .join(', ')} } ${from};`;
  if (hasDefault) return `${kw} ${parts.join(', ')} ${from};`;
  return `${kw} { ${parts.join(', ')} } ${from};`;
}

function pascal(s) {
  return s
    .split(/[-_.]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function split(file) {
  const src = fs.readFileSync(file, 'utf8');
  const decIdx = src.indexOf('@Component');
  if (decIdx < 0) return { skip: 'sem @Component' };
  const decEnd = findEnd(src, decIdx);
  if (decEnd < 0) return { skip: 'decorador não balanceado' };

  const classRe = /export\s+class\s+(\w+)(\s+extends\s+[\w.]+)?(\s+implements\s+[^{]+)?\s*\{/;
  const classMatch = src.slice(decEnd).match(classRe);
  if (!classMatch) return { skip: 'classe não encontrada após decorador' };
  const classStart = decEnd + classMatch.index;
  const className = classMatch[1];
  const implementsClause = classMatch[3] || '';

  // imports = tudo antes do primeiro código não-import
  const head = src.slice(0, decIdx);
  const imports = parseImports(head);
  let importsEnd = 0;
  for (const im of imports) {
    const idx = head.indexOf(im.stmt, importsEnd);
    if (idx >= 0) importsEnd = idx + im.stmt.length;
  }
  const importBlock = src.slice(0, importsEnd);
  const topLevel = src.slice(importsEnd, decIdx); // consts/tipos/fns entre imports e decorador
  const decorator = src.slice(decIdx, decEnd);
  let classBody = src.slice(classMatch.index + classStart + classMatch[0].length);

  // input()/output()/model()/viewChild()/... são detectados pelo
  // compilador Angular na CLASSE decorada — ficam no componente; o
  // store os enxerga via `declare` (type-only, zero runtime).
  const ioDecls = []; // {decl, name, typeExpr}
  const ioRe =
    /^[ \t]*((?:public|protected|private)\s+)?(readonly\s+)?(\w+)\s*=\s*(input|output|model|viewChild|viewChildren|contentChild|contentChildren)(\.\w+)?(<.*>)?\(([^;]*)\)\s*;[ \t]*$/gm;
  classBody = classBody.replace(ioRe, (full, vis, ro, name, fn, sub, gen, callArgs) => {
    // input/output/model formam a API pública (binding externo) —
    // ficam públicos; queries de template (viewChild...) protegidas.
    const ehApi = fn === 'input' || fn === 'output' || fn === 'model';
    const visTrim = ehApi ? '' : `${(vis || '').trim().replace('private', 'protected') || 'protected'} `;
    const decl = `  ${visTrim}override readonly ${name} = ${fn}${sub || ''}${gen || ''}(${callArgs.trim()});`;
    let type = 'unknown';
    const g = (gen || '').replace(/^</, '').replace(/>$/, '');
    if (fn === 'input') type = `InputSignal<${g || 'unknown'}>`;
    else if (fn === 'output') type = `OutputEmitterRef<${g || 'void'}>`;
    else if (fn === 'model') type = `ModelSignal<${g || 'unknown'}>`;
    else if (fn === 'viewChild' || fn === 'contentChild') type = `Signal<${g || 'unknown'} | undefined>`;
    else type = `Signal<${g || 'unknown'}[]>`;
    ioDecls.push({ decl, name, type });
    return '';
  });

  // quais nomes importados cada parte usa (a linha da declaração —
  // extends/implements — também conta para o store)
  const allNames = imports.flatMap((i) => i.names);
  const storeText =
    topLevel +
    '\n' +
    classMatch[0] +
    '\n' +
    classBody +
    '\n' +
    ioDecls.map((d) => d.type).join('\n');
  const storeUsed = usedNames(storeText, allNames);
  const compUsed = usedNames(
    decorator + '\n' + ioDecls.map((d) => d.decl).join('\n'),
    allNames,
  );
  compUsed.add('Component'); // o decorador em si
  compUsed.delete(className);

  const storeName = className.replace(/Component$/, 'Store') || className + 'Store';
  const base = path.basename(file).replace(/\.component\.ts$/, '');
  const dir = path.dirname(file);
  const storeFile = path.join(dir, `${base}.store.ts`);

  // imports do store: usados no corpo e não-Component
  const storeImports = [];
  for (const im of imports) {
    const rebuilt = rebuildImport(
      im.stmt,
      im.names,
      new Set([...storeUsed].filter((n) => n !== 'Component')),
      im.isType,
    );
    if (rebuilt) storeImports.push(rebuilt);
  }
  // imports do componente: usados no decorador
  const compImports = [];
  for (const im of imports) {
    const rebuilt = rebuildImport(im.stmt, im.names, compUsed, im.isType);
    if (rebuilt) compImports.push(rebuilt);
  }
  if (!compImports.some((s) => s.includes('Component'))) {
    compImports.unshift(`import { Component } from '@angular/core';`);
  }
  compImports.push(`import { ${storeName} } from './${base}.store';`);

  const headerStore =
    `// Lógica e estado de ${base} — separada da camada de UI (${base}.component.ts).\n` +
    `// O componente herda os membros; templates e comportamento não mudam.\n`;
  const headerComp =
    `// UI de ${base} — template, estilos e bindings. A lógica vive em ${base}.store.ts.\n`;

  // `declare` dos campos io/query — enxergados pelos métodos do store;
  // a implementação real fica na classe do componente.
  const typeImports = new Set();
  const ioDeclLines = ioDecls.map((d) => {
    for (const t of ['InputSignal', 'OutputEmitterRef', 'ModelSignal', 'Signal']) {
      if (d.type.includes(t)) typeImports.add(t);
    }
    // declare protected no base: a impl pública (input/output) amplia,
    // a protegida (viewChild) casa exato — ambas satisfazem.
    return `  declare protected readonly ${d.name}: ${d.type};`;
  });
  if (typeImports.size) {
    storeImports.push(
      `import type { ${[...typeImports].sort().join(', ')} } from '@angular/core';`,
    );
  }

  // Classe-base com recursos Angular (inject, hooks, signals) exige
  // decorador explícito — @Directive() é o padrão para base de componente.
  const needsDirective =
    /\b(inject|signal|computed|effect|input|output|model|viewChild|linkedSignal)\s*(<[^>]*>)?\s*\(/.test(
      storeText,
    ) || /implements\s+[^{]*(OnInit|OnDestroy|AfterViewInit|DoCheck)/.test(classMatch[0]);
  const storeImportsFinal = [...storeImports];
  if (needsDirective && !storeUsed.has('Directive')) {
    storeImportsFinal.push(`import { Directive } from '@angular/core';`);
  }
  const directiveDecorator = needsDirective ? '@Directive()\n' : '';

  const storeSrc =
    headerStore +
    storeImportsFinal.join('\n') +
    '\n' +
    topLevel +
    directiveDecorator +
    `export abstract class ${storeName}${implementsClause} {` +
    (ioDeclLines.length ? '\n' + ioDeclLines.join('\n') + '\n' : '') +
    classBody;

  const ioBody = ioDecls.length ? '\n' + ioDecls.map((d) => d.decl).join('\n') + '\n' : '';
  const compSrc =
    headerComp +
    compImports.join('\n') +
    '\n\n' +
    decorator +
    `\nexport class ${className} extends ${storeName} {${ioBody}}\n`;

  return { storeFile, storeSrc, compSrc, className, storeName };
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
for (const f of targets) {
  const res = split(f);
  if (res.skip) {
    console.log(`SKIP ${f}: ${res.skip}`);
    continue;
  }
  if (!apply) {
    console.log(`PLAN ${f} -> ${res.storeFile} (${res.className} extends ${res.storeName})`);
    continue;
  }
  fs.writeFileSync(res.storeFile, res.storeSrc);
  fs.writeFileSync(f, res.compSrc);
  console.log(`OK   ${f} + ${res.storeFile}`);
}

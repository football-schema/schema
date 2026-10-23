#!/usr/bin/env node
// Self-checks for the schema, zero dependencies:
//   1. the schema is closed: every type it names resolves, every field is documented
//   2. class-diagram.svg and docs/class-diagram.mmd match the schema
//   3. the examples conform to the schema and its rules
//   4. derived values for the reference match are what history recorded
//
//   node tools/check.js

import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadSchema, loadGraph, score, halfTimeScore, result } from './model.js';
import { validate } from './validate.js';

const root = new URL('..', import.meta.url);
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log(`  ✗ ${msg}`); } return cond; };

// 1 ---------------------------------------------------------------------
console.log('schema');
const S = await loadSchema();
for (const n of S.nodes) {
  if (n['@type'] === 'Module') continue;
  ok(n.module && S.byId.get(n.module)?.['@type'] === 'Module', `${n['@id']}: module ${n.module} is not a Module`);
  if (n.subClassOf) ok(S.byId.has(n.subClassOf), `${n['@id']}: subClassOf ${n.subClassOf} does not resolve`);
  for (const f of [...(n.fields ?? []), ...(n.derived ?? [])]) {
    for (const k of ['partType', 'refType', 'itemType'])
      if (f[k]) ok(S.byId.get(f[k])?.['@type']?.endsWith('Class'), `${n.label}.${f.label}: ${k} ${f[k]} is not a class`);
    if (f.enumType) ok(S.enums.has(f.enumType), `${n.label}.${f.label}: enumType ${f.enumType} is not an Enumeration`);
    ok(f.comment, `${n.label}.${f.label}: missing comment`);
  }
}
console.log(`  ${S.classes.size} classes, ${S.enums.size} enumerations`);

// 2 ---------------------------------------------------------------------
console.log('diagram');
const files = ['class-diagram.svg', 'docs/class-diagram.mmd'];
const read = () => Promise.all(files.map((f) => readFile(new URL(f, root), 'utf8')));
const before = await read();
execFileSync(process.execPath, [new URL('gen-class-diagram.js', import.meta.url).pathname], { stdio: 'ignore' });
ok((await read()).every((x, i) => x === before[i]), 'diagram was stale (now regenerated — commit it)');

// 3 ---------------------------------------------------------------------
console.log('examples');
const dir = new URL('examples/', root);
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.jsonld'))) {
  const g = await loadGraph(new URL(file, dir));
  for (const p of validate(S, g, { rel: (iri) => iri.replace(root.href, '') })) ok(false, p);
  console.log(`  ${file}: ${g.nodes.length} nodes`);
}

// 4 ---------------------------------------------------------------------
console.log('derivations');
const ex = await loadGraph(new URL('2012-05-13-mci-qpr.jsonld', dir));
const m = ex.nodes.find((n) => n['@type'] === 'Match');
const s = score(m), ht = halfTimeScore(m);
ok(s.home === 3 && s.away === 2, `MCI–QPR /homeScore–/awayScore = ${s.home}–${s.away}, expected 3–2`);
ok(ht.home === 1 && ht.away === 0, `MCI–QPR /halfTimeScore = ${ht.home}–${ht.away}, expected 1–0`);
ok(result(m) === 'homeWin', `MCI–QPR /result = ${result(m)}, expected homeWin`);
ok(score({ ...m, events: [{ '@type': 'Goal', club: m.awayTeam, kind: 'ownGoal' }] }).home === 1, 'own goal is credited to the opponent');
ok(score({ homeTeam: 'h', awayTeam: 'a', fullTime: { home: 2, away: 1 } }).home === 2, 'reported score stands in without an event log');

console.log(failures ? `\n${failures} failure(s)` : '\nall checks pass');
process.exit(failures ? 1 : 0);

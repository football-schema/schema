#!/usr/bin/env node
// Self-checks for the schema, zero dependencies:
//   1. the schema is closed: every type it names resolves, every field is documented
//   2. class-diagram.svg and docs/class-diagram.mmd match the schema
//   3. the examples, each with the documents it links to, conform to the schema and its rules
//   4. derived values for the reference match are what history recorded
//
//   node tools/check.js

import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadSchema, loadGraph, loadLinked, score, halfTimeScore, result, standing, forecastScore, zoneChance, notFinishing } from './model.js';
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
  const g = await loadLinked(new URL(file, dir));
  for (const p of validate(S, g, { rel: (iri) => iri.replace(root.href, '') })) ok(false, p);
  console.log(`  ${file}: ${g.nodes.length} nodes in ${g.files.length} document${g.files.length > 1 ? 's' : ''}`);
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
const dg = await loadGraph(new URL('2023-24-deductions.jsonld', dir));
const season = dg.nodes.find((n) => n['@type'] === 'Season'), eve = season.clubs[0];
ok(standing(eve, [], undefined, { deductions: season.deductions }).points === -8, 'Everton 2023/24: two deductions, 8 points off');
ok(standing(eve, [], undefined, { deductions: season.deductions, venue: 'home' }).points === 0, 'deductions stay out of the home table');

// forecasts: scoring once the match is played, zone chances, and the rules
const fg = await loadLinked(new URL('2012-05-13-forecast.jsonld', dir));
const fc = fg.nodes.find((n) => n['@type'] === 'MatchForecast'), sc = forecastScore(fc, fg.byId.get(fc.fixture));
ok(Math.abs(sc.logLoss + Math.log(0.81)) < 1e-9 && Math.abs(sc.rps - (0.19 ** 2 + 0.06 ** 2) / 2) < 1e-9, `MCI–QPR forecast scored: log loss ${sc.logLoss}, rps ${sc.rps}`);
ok(forecastScore(fc, { ...fg.byId.get(fc.fixture), status: 'scheduled' }) === null, 'an unplayed match has no forecast score');
const zones = { zones: [{ from: 1, to: 4, kind: 'championsLeague' }, { from: 18, to: 20, kind: 'relegation' }] };
const proj = { positions: Array.from({ length: 20 }, (_, i) => (i < 4 ? 0.1 : i >= 17 ? 0.2 : 0)) };
ok(Math.abs(zoneChance(proj, zones, 'championsLeague') - 0.4) < 1e-9 && Math.abs(zoneChance(proj, zones, 'relegation') - 0.6) < 1e-9, 'zone chances add up the places in each zone');
ok(Math.abs(notFinishing({ positions: [0.5, 0.45] }) - 0.05) < 1e-9 && notFinishing(proj) === 0, 'what the positions leave short of 1 is the chance of not finishing');
const late = { ...fg, nodes: fg.nodes.map((n) => (n === fc ? { ...n, issued: '2012-05-13T15:00:00Z', homeWin: 0.9 } : n)) };
const lateProblems = validate(S, late);
ok(lateProblems.some((p) => p.includes('issued-after-kickoff')) && lateProblems.some((p) => p.includes('outcomes-dont-add-up')), 'a late forecast, and chances that do not add up, are caught');

console.log(failures ? `\n${failures} failure(s)` : '\nall checks pass');
process.exit(failures ? 1 : 0);

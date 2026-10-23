#!/usr/bin/env node
// Print every derived value for the matches in one or more JSON-LD files:
// score, half-time score, result, the event timeline and the league table.
//
//   node tools/derive.js examples/*.jsonld

import { loadGraph, score, halfTimeScore, result, clock, standing, classify } from './model.js';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: derive.js <file.jsonld>...'); process.exit(1); }

const all = new Map(), matches = [];
for (const f of files) {
  const g = await loadGraph(f);
  for (const [id, n] of g.byId) all.set(id, n);
  matches.push(...g.nodes.filter((n) => n['@type'] === 'Match'));
}
const name = (id) => all.get(id)?.knownAs ?? all.get(id)?.shortName ?? all.get(id)?.name ?? id;

for (const m of matches) {
  const s = score(m), ht = halfTimeScore(m);
  console.log(`\n${m.kickoff.slice(0, 10)}  MW${m.matchweek}  ${name(m.homeTeam)} ${s.home}–${s.away} ${name(m.awayTeam)}  (HT ${ht.home}–${ht.away})  /result = ${result(m)}`);
  for (const e of m.events ?? []) {
    const what = e['@type'] === 'Goal' ? `⚽ ${name(e.scorer)}${e.assist ? ` (assist ${name(e.assist)})` : ''}${e.kind !== 'openPlay' ? ` [${e.kind}]` : ''}`
      : e['@type'] === 'Card' ? `${e.colour === 'yellow' ? '🟨' : '🟥'} ${name(e.player)}`
      : `🔁 ${name(e.playerOn)} for ${name(e.playerOff)}`;
    console.log(`  ${clock(e).padStart(7)}  ${name(e.club).padEnd(10)} ${what}`);
  }
}

const clubs = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))];
console.log('\n  #  club         P  W  D  L  GF GA  GD  Pts  form');
for (const r of classify(clubs.map((c) => standing(c, matches)))) {
  console.log(`  ${r.position}  ${name(r.club).padEnd(10)} ${[r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]
    .map((n) => String(n).padStart(2)).join(' ')} ${String(r.goalDifference).padStart(3)}  ${String(r.points).padStart(3)}  ${r.form}`);
}

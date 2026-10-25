// Validate instance data against the schema: every node conforms to its
// class, references resolve to the right types, the Premier League rules
// (MatchRules, SeasonRules) hold, and so do the ForecastRules. Used by this repo's own checks and by any
// project that publishes data in this vocabulary.
//
//   import { loadSchema, loadDir } from 'football-schema/model.js';
//   import { validate } from 'football-schema/validate.js';
//   const problems = validate(await loadSchema(), await loadDir('data/'));

import { goalScore } from './model.js';

const META = new Set(['@id', '@type', 'comment', 'label', 'seeAlso']);

// returns a list of problems as strings; empty when the graph is valid
export function validate(S, g, { rel = (iri) => iri } = {}) {
  const problems = [];
  const ok = (cond, msg) => { if (!cond) problems.push(msg); return cond; };

  function conform(node, where) {
    const type = node['@type'];
    if (!ok(S.classes.has(type), `${where}: unknown @type ${type}`)) return;
    ok(S.classes.get(type)['@type'] !== 'AbstractClass', `${where}: ${type} is abstract`);
    const fields = new Map([...S.annotations, ...S.fieldsOf(type)].map((f) => [f.label, f]));
    for (const [k, v] of Object.entries(node)) {
      if (META.has(k)) continue;
      const f = fields.get(k);
      if (!ok(f, `${where}: ${type} has no field "${k}"`)) continue;
      if (f.enumType) ok(S.enums.get(f.enumType).members.some((m) => m.name === v), `${where}.${k}: "${v}" is not a ${f.enumType}`);
      if (f.refType) for (const id of [].concat(v)) {
        const target = g.byId.get(id);
        if (ok(target, `${where}.${k}: ${rel(id)} does not resolve`))
          ok(S.isA(target['@type'], S.byId.get(f.refType).label), `${where}.${k}: ${rel(id)} is a ${target['@type']}, expected ${f.refType}`);
      }
      // a part is embedded, or linked by IRI to a node in another file
      if (f.partType) [].concat(v).forEach((part, i) => {
        const node_ = typeof part === 'string' ? g.byId.get(part) : part;
        if (!ok(node_, `${where}.${k}[${i}]: ${part} does not resolve`)) return;
        if (typeof part !== 'string') conform(part, `${where}.${k}[${i}]`);
        ok(S.isA(node_['@type'], S.byId.get(f.partType).label), `${where}.${k}[${i}]: expected ${f.partType}`);
      });
      if (f.valueType === 'int') ok(Number.isInteger(v), `${where}.${k}: expected int`);
      if (f.valueType === 'decimal') ok(typeof v === 'number' && Number.isFinite(v), `${where}.${k}: expected a number`);
      if (f.valueType === 'decimal[]') ok([].concat(v).every((x) => typeof x === 'number' && Number.isFinite(x)), `${where}.${k}: expected numbers`);
      if (f.valueType === 'iri') ok([].concat(v).every((x) => typeof x === 'string' && URL.canParse(x)), `${where}.${k}: expected IRIs`);
      if (f.valueType === 'string[]') ok([].concat(v).every((x) => typeof x === 'string'), `${where}.${k}: expected strings`);
      if (f.valueType === 'hexColour[]') ok([].concat(v).every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${where}.${k}: expected #rrggbb colours`);
    }
  }

  for (const n of g.nodes) conform(n, rel(n['@id'] ?? g.url ?? ''));

  // fb:MatchRules that data alone can check
  for (const m of g.nodes.filter((n) => n['@type'] === 'Match')) {
    const where = rel(m['@id']);
    ok(m.homeTeam !== m.awayTeam, `${where}: same-team`);
    for (const e of m.events ?? []) ok([m.homeTeam, m.awayTeam].includes(e.club), `${where}: event club ${rel(e.club)} is not playing`);
    const subs = (c) => (m.events ?? []).filter((e) => e['@type'] === 'Substitution' && e.club === c && !e.concussion).length;
    ok(subs(m.homeTeam) <= 5 && subs(m.awayTeam) <= 5, `${where}: too-many-substitutions`);
    if (m.fullTime && (m.events ?? []).some((e) => e['@type'] === 'Goal')) {
      const s = goalScore(m);
      ok(s.home === m.fullTime.home && s.away === m.fullTime.away, `${where}: score-mismatch (events ${s.home}–${s.away}, reported ${m.fullTime.home}–${m.fullTime.away})`);
    }
  }

  // fb:SeasonRules, once a season's fixture list is in
  const seasons = [];
  for (const comp of g.nodes.filter((n) => n['@type'] === 'Competition')) {
    for (const season of (comp.seasons ?? []).map((id) => g.byId.get(id)).filter(Boolean)) {
      const where = rel(season['@id']);
      const partial = season.coverage === 'partial';
      if (comp.clubsPerSeason && !partial) ok(season.clubs.length === comp.clubsPerSeason, `${where}: ${season.clubs.length} clubs, ${comp.name} has ${comp.clubsPerSeason}`);
      const tlas = season.clubs.map((c) => g.byId.get(c)?.tla);
      ok(new Set(tlas).size === tlas.length, `${where}: duplicate club tla`);
      for (const d of [].concat(season.deductions ?? []).map((x) => (typeof x === 'string' ? g.byId.get(x) : x)).filter(Boolean)) {
        ok(season.clubs.includes(d.club), `${where}: deduction for ${rel(d.club)}, which is not in the season`);
        ok(Number.isInteger(d.points) && d.points > 0, `${where}: a deduction must take off a positive whole number of points`);
      }
      const matches = (season.matches ?? []).map((id) => g.byId.get(id));
      if (!ok(matches.every(Boolean), `${where}: a linked match does not resolve`) || !matches.length) continue;
      const n = season.clubs.length;
      const pairs = new Set(matches.map((m) => `${m.homeTeam} ${m.awayTeam}`));
      if (!partial) ok(matches.length === n * (n - 1) && pairs.size === matches.length, `${where}: bad-fixture-list (${matches.length} matches, ${pairs.size} distinct pairings, expected ${n * (n - 1)})`);
      for (const m of matches) ok(season.clubs.includes(m.homeTeam) && season.clubs.includes(m.awayTeam), `${rel(m['@id'])}: team-not-entered`);
      const weeks = Map.groupBy(matches, (m) => m.matchweek);
      if (!partial) for (const [w, list] of weeks) ok(list.length === n / 2, `${where}: bad-matchweek ${w} has ${list.length} matches`);
      const finished = matches.filter((m) => m.status === 'finished');
      ok(finished.every((m) => m.fullTime || (m.events ?? []).length), `${where}: a finished match has no score`);
      if (season.resultsAsOf) ok(finished.every((m) => m.kickoff.slice(0, 10) <= season.resultsAsOf), `${where}: a result is newer than resultsAsOf`);
      seasons.push({ label: season.label, matches: matches.length, weeks: weeks.size, finished: finished.length, partial });
    }
  }

  // fb:ForecastRules
  const chance = (x) => typeof x === 'number' && x >= 0 && x <= 1;
  for (const f of g.nodes.filter((n) => n['@type'] === 'MatchForecast')) {
    const where = rel(f['@id'] ?? f.fixture);
    const all = [f.homeWin, f.draw, f.awayWin, f.bothTeamsScore, ...[].concat(f.goalLines ?? []).map((l) => l.over), ...[].concat(f.scores ?? []).map((s) => s.chance)];
    ok(all.every((x) => x === undefined || chance(x)), `${where}: bad-chance`);
    ok(Math.abs(f.homeWin + f.draw + f.awayWin - 1) <= 0.01, `${where}: outcomes-dont-add-up (${f.homeWin} + ${f.draw} + ${f.awayWin})`);
    const m = g.byId.get(f.fixture);
    if (m) ok(f.issued < m.kickoff, `${where}: issued-after-kickoff (${f.issued}, kick-off ${m.kickoff})`);
  }
  for (const p of g.nodes.filter((n) => n['@type'] === 'SeasonProjection')) {
    const where = rel(p['@id'] ?? p.club), season = g.byId.get(p.season), pos = [].concat(p.positions ?? []);
    ok(pos.every(chance), `${where}: bad-chance`);
    ok(Math.abs(pos.reduce((a, b) => a + b, 0) - 1) <= 0.01 && (!season || pos.length === season.clubs.length), `${where}: positions-dont-add-up (${pos.length} places)`);
  }
  return Object.assign(problems, { seasons });
}

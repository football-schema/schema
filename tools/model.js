// Load the schema and implement its derivations, so tools and tests compute
// scores and tables exactly as schema/*.jsonld describes them. Instance data
// is plain JSON-LD: nodes in @graph, references as relative IRIs ("#stadium",
// "../clubs/ARS.jsonld#this") resolved against the file they appear in.

import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('..', import.meta.url);
export const MODULES = ['core', 'match', 'table', 'premier-league'];

export async function loadSchema() {
  const nodes = [];
  for (const name of MODULES) {
    const doc = JSON.parse(await readFile(new URL(`schema/${name}.jsonld`, root), 'utf8'));
    nodes.push(...doc['@graph'].map((n) => ({ ...n, _module: name })));
  }
  const byId = new Map(nodes.map((n) => [n['@id'], n]));
  const classes = new Map(nodes
    .filter((n) => n['@type'] === 'EntityClass' || n['@type'] === 'AbstractClass')
    .map((n) => [n.label, n]));
  const enums = new Map(nodes.filter((n) => n['@type'] === 'Enumeration').map((n) => [n['@id'], n]));
  // fields of a class including those inherited through subClassOf
  const fieldsOf = (label) => {
    const c = classes.get(label);
    if (!c) return [];
    const parent = c.subClassOf && byId.get(c.subClassOf);
    return [...(parent ? fieldsOf(parent.label) : []), ...(c.fields ?? [])];
  };
  const isA = (label, ancestor) => {
    for (let c = classes.get(label); c; c = c.subClassOf && byId.get(c.subClassOf))
      if (c.label === ancestor) return true;
    return false;
  };
  return { nodes, byId, classes, enums, fieldsOf, isA };
}

// terms the context types as @id: their string values are IRIs, not literals
const context = JSON.parse(await readFile(new URL('context.jsonld', root), 'utf8'))['@context'];
const ID_TERMS = new Set(Object.entries(context).filter(([, v]) => v?.['@type'] === '@id').map(([k]) => k));

// Load one JSON-LD file, rewriting every @id and IRI-valued property to an
// absolute IRI. byId indexes embedded nodes (events, lineups) as well.
export async function loadGraph(path) {
  const base = path instanceof URL ? path : pathToFileURL(resolve(path));
  const doc = JSON.parse(await readFile(base, 'utf8'));
  const abs = (iri) => new URL(iri, base).href;
  const absolutize = (node) => {
    const out = { ...node };
    if (out['@id'] !== undefined) out['@id'] = abs(out['@id']);
    for (const [k, v] of Object.entries(out)) {
      if (k.startsWith('@')) continue;
      out[k] = [].concat(v).map((x) => (typeof x === 'object' && x !== null ? absolutize(x) : ID_TERMS.has(k) ? abs(x) : x));
      if (!Array.isArray(v)) out[k] = out[k][0];
    }
    return out;
  };
  const nodes = (doc['@graph'] ?? [doc]).map(absolutize);
  const byId = new Map();
  const index = (n) => {
    if (n['@id']) byId.set(n['@id'], n);
    for (const v of Object.values(n)) for (const x of [].concat(v)) if (typeof x === 'object' && x !== null) index(x);
  };
  nodes.forEach(index);
  return { url: base.href, nodes, byId };
}

// Load every .jsonld file under a directory into one graph, so links
// between files resolve.
export async function loadDir(dir) {
  const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.jsonld')).sort();
  const graph = { files: [], nodes: [], byId: new Map() };
  for (const f of files) {
    const g = await loadGraph(resolve(dir, f));
    graph.files.push({ file: f, ...g });
    graph.nodes.push(...g.nodes);
    for (const [id, n] of g.byId) graph.byId.set(id, n);
  }
  return graph;
}

// ---- match derivations (schema/match.jsonld) ----

const opponent = (m, club) => (club === m.homeTeam ? m.awayTeam : m.homeTeam);
export const creditedTo = (m, g) => (g.kind === 'ownGoal' ? opponent(m, g.club) : g.club);
export const clock = (e) => (e.addedTime ? `${e.minute}+${e.addedTime}'` : `${e.minute}'`);

const hasGoalLog = (m) => (m.events ?? []).some((e) => e['@type'] === 'Goal');
export const goalScore = (m, events = m.events ?? []) => {
  const goals = events.filter((e) => e['@type'] === 'Goal');
  return {
    home: goals.filter((g) => creditedTo(m, g) === m.homeTeam).length,
    away: goals.filter((g) => creditedTo(m, g) === m.awayTeam).length,
  };
};
// the event log wins; a reported score stands in when there is none
export const score = (m) => (hasGoalLog(m) || !m.fullTime ? goalScore(m) : { home: m.fullTime.home, away: m.fullTime.away });
export const halfTimeScore = (m) => (hasGoalLog(m) || !m.halfTime
  ? goalScore(m, (m.events ?? []).filter((e) => e.period === 'firstHalf'))
  : { home: m.halfTime.home, away: m.halfTime.away });
export function result(m) {
  if (m.status !== 'finished') return null;
  const { home, away } = score(m);
  return home > away ? 'homeWin' : home < away ? 'awayWin' : 'draw';
}

// ---- table derivations (schema/table.jsonld + premier-league rules) ----

// venue 'home' or 'away' restricts to those games (the Home and Away tables);
// last n keeps only the club's most recent n games (the Form table)
export function standing(club, matches, rules = { pointsForWin: 3, pointsForDraw: 1 }, { venue, last } = {}) {
  let games = matches
    .filter((m) => m.status === 'finished' && (m.homeTeam === club || m.awayTeam === club))
    .filter((m) => !venue || (venue === 'home' ? m.homeTeam === club : m.awayTeam === club))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (last) games = games.slice(-last);
  const s = { club, played: games.length, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, form: [] };
  for (const m of games) {
    const { home, away } = score(m);
    const [gf, ga] = m.homeTeam === club ? [home, away] : [away, home];
    s.goalsFor += gf; s.goalsAgainst += ga;
    const r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    s[{ W: 'won', D: 'drawn', L: 'lost' }[r]]++;
    s.form.push(r);
  }
  s.form = s.form.slice(-5).join('');
  s.goalDifference = s.goalsFor - s.goalsAgainst;
  s.points = s.won * rules.pointsForWin + s.drawn * rules.pointsForDraw;
  return s;
}

// fb:ClassificationRules, in order (head-to-head and play-off omitted:
// they need the full fixture list between the tied clubs)
export function classify(standings) {
  return [...standings]
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor)
    .map((s, i) => ({ position: i + 1, ...s }));
}

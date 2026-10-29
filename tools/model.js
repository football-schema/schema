// Load the schema and implement its derivations, so tools and tests compute
// scores and tables exactly as schema/*.jsonld describes them. Instance data
// is plain JSON-LD: nodes in @graph, references as relative IRIs ("#stadium",
// "../clubs/ARS.jsonld#this") resolved against the file they appear in, read
// from disk or over HTTP. Runs in Node and, unbundled, in the browser:
//   import { loadLinked } from 'https://football-schema.github.io/schema/tools/model.js';

// Node's file system where there is one; in a browser everything is fetched
const node = typeof process !== 'undefined' && !!process.versions?.node;
const { readFile, readdir } = node ? await import('node:fs/promises') : {};
const { pathToFileURL } = node ? await import('node:url') : {};
const { resolve } = node ? await import('node:path') : {};

const root = new URL('..', import.meta.url);
const readJson = async (url) => (url.protocol === 'file:' ? JSON.parse(await readFile(url, 'utf8')) : (await fetch(url)).json());
export const MODULES = ['core', 'match', 'table', 'premier-league', 'catalogue', 'forecast'];

export async function loadSchema() {
  const nodes = [];
  for (const name of MODULES) {
    const doc = await readJson(new URL(`schema/${name}.jsonld`, root));
    nodes.push(...doc['@graph'].map((n) => ({ ...n, _module: name })));
  }
  const byId = new Map(nodes.map((n) => [n['@id'], n]));
  const classes = new Map(nodes
    .filter((n) => n['@type'] === 'EntityClass' || n['@type'] === 'AbstractClass')
    .map((n) => [n.label, n]));
  const enums = new Map(nodes.filter((n) => n['@type'] === 'Enumeration').map((n) => [n['@id'], n]));
  // fields every node may carry, whatever its class (fb:Annotations)
  const annotations = nodes.filter((n) => n['@type'] === 'Annotations').flatMap((n) => n.fields ?? []);
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
  return { nodes, byId, classes, enums, annotations, fieldsOf, isA };
}

// terms the context types as @id: their string values are IRIs, not literals
const context = (await readJson(new URL('context.jsonld', root)))['@context'];
const ID_TERMS = new Set(Object.entries(context).filter(([, v]) => v?.['@type'] === '@id').map(([k]) => k));

// a path, a file: or http(s): IRI, or a URL -> a URL (in a browser, a path is relative to the page)
const toUrl = (p) => (p instanceof URL ? p : /^(https?|file):/.test(p) ? new URL(p) : node ? pathToFileURL(resolve(p)) : new URL(p, location.href));
async function readDoc(url) {
  if (url.protocol === 'file:') return JSON.parse(await readFile(url, 'utf8'));
  const res = await fetch(url, { headers: { accept: 'application/ld+json, application/json;q=0.9' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url.href}: HTTP ${res.status}`);
  return res.json();
}

// Load one JSON-LD document, from disk or the web, rewriting every @id and
// IRI-valued property to an absolute IRI. byId indexes embedded nodes
// (events, lineups) as well.
export async function loadGraph(path) {
  const base = toUrl(path);
  const doc = await readDoc(base);
  const abs = (iri) => new URL(iri, base).href;
  const absolutize = (node) => {
    const out = { ...node };
    if (out['@id'] !== undefined) out['@id'] = abs(out['@id']);
    for (const [k, v] of Object.entries(out)) {
      if (k.startsWith('@')) continue;
      out[k] = [].concat(v).map((x) => (typeof x === 'object' && x !== null ? absolutize(x) : ID_TERMS.has(k) && typeof x === 'string' ? abs(x) : x));
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

// Load a document and every document it links to through `follow` terms, so a
// consumer needs one address: a Dataset, or a Season. Each document is read
// once; IRIs are followed to the document, not the fragment. Up to `parallel`
// documents are in flight at once; the result lists them in breadth-first order
// from the start, whatever order they arrived in. A document that can't be read
// fails the load, unless `onError(error, url)` is given: then it is skipped and
// listed in `errors` (the start document always fails the load).
//   const g = await loadLinked('https://example.org/data/dataset.jsonld');
export const FOLLOW = ['seasons', 'competitions', 'includes', 'matches', 'clubs', 'promoted', 'deductions', 'homeGround', 'venue', 'referee', 'fixture', 'club', 'season', 'squad', 'player'];
export async function loadLinked(start, { follow = FOLLOW, limit = 1000, parallel = 8, onError } = {}) {
  const first = toUrl(start).href;
  const docs = new Map(), errors = [];
  const linksOf = (g) => {
    const out = [];
    const walk = (n) => {
      for (const [k, v] of Object.entries(n)) for (const x of [].concat(v)) {
        if (typeof x === 'object' && x !== null) walk(x);
        else if (follow.includes(k) && typeof x === 'string') out.push(x.split('#')[0]);
      }
    };
    g.nodes.forEach(walk);
    return out.filter(Boolean);
  };
  const seen = new Set([first]), queue = [first];
  await new Promise((done, fail) => {
    let active = 0, failed = false;
    const pump = () => {
      if (failed) return;
      if (!queue.length && !active) return done();
      while (active < parallel && queue.length) {
        const url = queue.shift();
        active++;
        loadGraph(url).then((g) => {
          docs.set(url, g);
          for (const u of linksOf(g)) if (!seen.has(u)) {
            seen.add(u);
            if (seen.size > limit) throw new Error(`loadLinked: more than ${limit} documents from ${start}`);
            queue.push(u);
          }
        }, (e) => {
          if (!onError || url === first) throw e;
          errors.push({ url, error: e });
          onError(e, url);
        }).then(() => { active--; pump(); }, (e) => { failed = true; fail(e); });
      }
    };
    pump();
  });
  // breadth-first from the start, as the documents link to each other
  const graph = { files: [], nodes: [], byId: new Map(), errors };
  const order = [first], placed = new Set(order);
  for (let i = 0; i < order.length; i++) {
    const g = docs.get(order[i]);
    if (!g) continue;
    graph.files.push(g);
    graph.nodes.push(...g.nodes);
    for (const [id, n] of g.byId) graph.byId.set(id, n);
    for (const u of linksOf(g)) if (!placed.has(u)) { placed.add(u); order.push(u); }
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
// last n keeps only the club's most recent n games (the Form table);
// deductions (fb:PointsDeduction) count in the overall table only
export function standing(club, matches, rules = { pointsForWin: 3, pointsForDraw: 1 }, { venue, last, deductions = [] } = {}) {
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
  s.deducted = venue || last ? 0 : deductions.filter((d) => d.club === club).reduce((t, d) => t + d.points, 0);
  s.points = s.won * rules.pointsForWin + s.drawn * rules.pointsForDraw - s.deducted;
  return s;
}

// fb:ClassificationRules, in order (head-to-head and play-off omitted:
// they need the full fixture list between the tied clubs)
export function classify(standings) {
  return [...standings]
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor)
    .map((s, i) => ({ position: i + 1, ...s }));
}

// ---- forecast derivations (schema/forecast.jsonld) ----

// a finished match's forecast, scored: log loss and ranked probability score (lower is better)
export function forecastScore(f, m) {
  const r = result(m);
  if (!r) return null;
  const p = { homeWin: f.homeWin, draw: f.draw, awayWin: f.awayWin }[r];
  const [h, d] = [r === 'homeWin' ? 1 : 0, r === 'draw' ? 1 : 0];
  return { logLoss: -Math.log(p), rps: ((f.homeWin - h) ** 2 + (f.homeWin + f.draw - h - d) ** 2) / 2 };
}
// a projection's chance of finishing in the competition's zones of one kind
export const zoneChance = (projection, competition, kind) => (competition.zones ?? []).filter((z) => z.kind === kind)
  .reduce((t, z) => t + projection.positions.slice(z.from - 1, z.to).reduce((a, b) => a + b, 0), 0);
// the chance a club doesn't finish in the table at all (the positions add up to less than 1)
export const notFinishing = (projection) => Math.max(0, 1 - projection.positions.reduce((a, b) => a + b, 0));

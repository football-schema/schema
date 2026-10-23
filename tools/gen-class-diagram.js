#!/usr/bin/env node
// Generate the data-model class diagram FROM the schema, so it can never
// drift. Emits Mermaid (for the README, which GitHub renders inline) and a
// zero-dependency SVG (for the site). Box content and every edge are
// schema-derived; only the layout is hand-placed.
//
//   node tools/gen-class-diagram.js
//     -> writes docs/class-diagram.mmd and class-diagram.svg
//     -> prints the Mermaid block to stdout for the README
//
// Edges:  partType   -> composition  (filled diamond at the whole)
//         subClassOf -> generalization (hollow triangle at the parent)
//         refType    -> association, drawn only when listed in DRAWN_REFS;
//                       otherwise shown as a typed attribute (blue)
//         derived itemType -> derived association (dashed, /name)

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const MODULES = ['core', 'match', 'table'];
const nodes = [];
for (const name of MODULES) {
  const doc = JSON.parse(await readFile(new URL(`schema/${name}.jsonld`, root), 'utf8'));
  nodes.push(...doc['@graph']);
}
const classes = new Map(nodes
  .filter((n) => n['@type'] === 'EntityClass' || n['@type'] === 'AbstractClass')
  .map((n) => [n['@id'], n]));
const enums = new Set(nodes.filter((n) => n['@type'] === 'Enumeration').map((n) => n['@id']));
const short = (id) => id.replace(/^fb:/, '');

// associations drawn as lines; every other reference stays an attribute
const DRAWN_REFS = new Set(['fb:Season#clubs', 'fb:Club#homeGround']);

function model(node) {
  const attrs = [], edges = [];
  const id = node['@id'];
  for (const f of node.fields ?? []) {
    if (f.partType) edges.push({ kind: 'part', to: f.partType, mult: f.multiplicity, label: f.label });
    else if (f.refType && DRAWN_REFS.has(`${id}#${f.label}`))
      edges.push({ kind: 'ref', to: f.refType, mult: f.multiplicity, label: f.label });
    else if (f.refType) attrs.push({ name: f.label, type: short(f.refType) + (f.multiplicity?.endsWith('*') ? '[]' : ''), kind: 'ref', opt: f.multiplicity?.startsWith('0') });
    else if (f.enumType) attrs.push({ name: f.label, type: short(f.enumType), kind: 'enum', opt: !!f.optional });
    else attrs.push({ name: f.label, type: f.valueType, kind: 'value', opt: !!f.optional });
  }
  const derived = [];
  for (const d of node.derived ?? []) {
    if (d.itemType && classes.has(d.itemType)) edges.push({ kind: 'derived', to: d.itemType, mult: '0..*', label: '/' + d.label });
    else derived.push(d.label);
  }
  if (node.subClassOf) edges.push({ kind: 'isa', to: node.subClassOf });
  return { id, label: node.label, abstract: node['@type'] === 'AbstractClass', attrs, derived, edges };
}
const models = [...classes.values()].map(model);

// ---- Mermaid ----
function mermaid() {
  const L = ['classDiagram', '  direction TB'];
  for (const m of models) {
    L.push(`  class ${m.label} {`);
    if (m.abstract) L.push('    <<abstract>>');
    for (const a of m.attrs) L.push(`    +${a.type}${a.opt ? '?' : ''} ${a.name}`);
    for (const d of m.derived) L.push(`    +${d}() derived`); // computed, not stored
    L.push('  }');
  }
  for (const m of models) for (const e of m.edges) {
    const to = short(e.to);
    if (e.kind === 'part') L.push(`  ${m.label} "1" *-- "${e.mult}" ${to} : ${e.label}`);
    else if (e.kind === 'ref') L.push(`  ${m.label} --> "${e.mult}" ${to} : ${e.label}`);
    else if (e.kind === 'derived') L.push(`  ${m.label} ..> "${e.mult}" ${to} : ${e.label}`);
    else if (e.kind === 'isa') L.push(`  ${to} <|-- ${m.label}`);
  }
  return L.join('\n');
}

// ---- SVG (curated layout; box content and edges schema-derived). Styles are
// inlined as presentation attributes so the file renders identically in
// browsers and in basic SVG rasterizers (no <style> dependency). ----
const COL = [20, 320, 620, 920, 1220];
const POS = {
  'fb:Stadium':      { x: COL[0], y: 40 },
  'fb:Competition':  { x: COL[1], y: 40 },
  'fb:Club':         { x: COL[0], y: 420 },
  'fb:Season':       { x: COL[1], y: 420 },
  'fb:Standing':     { x: COL[2], y: 420 },
  'fb:Person':       { x: COL[3], y: 420 },
  'fb:Registration': { x: COL[0], y: 710 },
  'fb:Match':        { x: COL[1], y: 710 },
  'fb:Player':       { x: COL[2], y: 710 },
  'fb:Manager':      { x: COL[3], y: 710 },
  'fb:Referee':      { x: COL[4], y: 710 },
  'fb:Lineup':       { x: COL[1], y: 1060 },
  'fb:MatchEvent':   { x: COL[3], y: 1060 },
  'fb:Appearance':   { x: COL[1], y: 1260 },
  'fb:Goal':         { x: COL[2], y: 1310 },
  'fb:Card':         { x: COL[3], y: 1310 },
  'fb:Substitution': { x: COL[4], y: 1310 },
};
const WIDTH = 1470, W = 230, HEAD = 34, LINE = 23, PAD = 10, CHW = 7.6; // monospace advance at 12.5px
const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const SANS = 'system-ui, sans-serif';
const C = { bg: '#ffffff', panel: '#f6f8fa', border: '#d0d7de', fg: '#1f2328', muted: '#57606a',
  brand: '#37003c', value: '#c4004b', ref: '#0969da', enum: '#1a7f37', derived: '#8250df', edge: '#8c959f' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// wrap "/a /b /c" so long derived lists never spill past the box
function derivedLines(m) {
  const lines = [];
  let cur = '';
  for (const d of m.derived.map((d) => '/' + d)) {
    if (cur && (cur.length + 1 + d.length) * CHW > W - 28) { lines.push(cur); cur = d; }
    else cur = cur ? `${cur} ${d}` : d;
  }
  if (cur) lines.push(cur);
  return lines;
}
const boxH = (m) => HEAD + PAD + (m.attrs.length + derivedLines(m).length) * LINE + PAD;

function svg() {
  const box = new Map(models.map((m) => [m.id, { m, ...POS[m.id], h: boxH(m) }]));
  for (const [id, b] of box) if (b.x === undefined) throw new Error(`no layout position for ${id}`);
  const out = [], boxes = [];

  for (const { m, x, y, h } of box.values()) {
    let yy = y + HEAD + PAD + 15;
    const rows = m.attrs.map((a) => {
      const t = `<text x="${x + 14}" y="${yy}" font-family="${MONO}" font-size="12.5" fill="${C.fg}">${esc(a.name)}`
        + `<tspan fill="${C[a.kind]}">: ${esc(a.type)}${a.opt ? '?' : ''}</tspan></text>`;
      yy += LINE; return t;
    });
    for (const line of derivedLines(m)) {
      rows.push(`<text x="${x + 14}" y="${yy}" font-family="${MONO}" font-size="12.5" font-style="italic" fill="${C.derived}">${esc(line)}</text>`);
      yy += LINE;
    }
    const title = m.abstract
      ? `<text x="${x + W / 2}" y="${y + 23}" font-family="${SANS}" font-weight="700" font-style="italic" font-size="15" fill="${C.fg}" text-anchor="middle">${esc(m.label)}</text>`
      : `<text x="${x + W / 2}" y="${y + 23}" font-family="${SANS}" font-weight="700" font-size="15" fill="${C.fg}" text-anchor="middle">${esc(m.label)}</text>`;
    boxes.push(`<g>
    <rect x="${x}" y="${y}" width="${W}" height="${h}" rx="10" fill="${C.panel}" stroke="${m.abstract ? C.muted : C.border}" stroke-width="1"${m.abstract ? ' stroke-dasharray="5 3"' : ''}/>
    <line x1="${x}" y1="${y + HEAD}" x2="${x + W}" y2="${y + HEAD}" stroke="${C.border}"/>
    ${title}
    ${rows.join('\n    ')}
  </g>`);
  }

  // Route every edge. Boxes side by side (overlapping rows) get a straight
  // horizontal line; otherwise an orthogonal elbow from the bottom of the
  // upper box to the top of the lower one. Ports on a shared side are spread
  // evenly so parallel edges never overlap.
  const edges = [];
  for (const { m } of box.values()) for (const e of m.edges) {
    const a = box.get(m.id), b = box.get(e.to);
    if (!b) continue;
    // generalization runs child -> parent: the parent is the "upper" end
    const [from, to] = e.kind === 'isa' ? [b, a] : [a, b];
    const sideBySide = from.y < to.y + to.h && to.y < from.y + from.h;
    edges.push({ e, from, to, sideBySide, down: from.y < to.y });
  }
  const ports = new Map(); // "boxId:side" -> edges using it
  const use = (bx, side, edge) => {
    const k = `${bx.m.id}:${side}`;
    if (!ports.has(k)) ports.set(k, []);
    ports.get(k).push(edge);
  };
  for (const ed of edges) {
    if (ed.sideBySide) continue;
    // all generalization edges into one parent share a single port
    if (ed.e.kind === 'isa') { if (!ports.has(`${ed.from.m.id}:isa`)) use(ed.from, 'bottom', { isa: ed.from.m.id }); ports.set(`${ed.from.m.id}:isa`, true); }
    else use(ed.from, ed.down ? 'bottom' : 'top', ed);
    use(ed.to, ed.down ? 'top' : 'bottom', ed);
  }
  const portX = (bx, side, key) => {
    const list = ports.get(`${bx.m.id}:${side}`) ?? [key];
    const list2 = list.map((k) => (k.isa ? k.isa : k));
    const i = Math.max(0, list2.indexOf(key));
    return bx.x + (W * (i + 1)) / (list2.length + 1);
  };

  const label = (x, y, s, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-family="${MONO}" font-size="11.5" fill="${C.muted}" text-anchor="${anchor}">${esc(s)}</text>`;
  const isaTargets = new Set();

  for (const ed of edges) {
    const { e, from, to } = ed;
    const dash = e.kind === 'derived' ? ' stroke-dasharray="6 4"' : '';
    const stroke = e.kind === 'derived' ? C.derived : C.edge;
    if (ed.sideBySide) {
      const top = Math.max(from.y, to.y) + HEAD, bot = Math.min(from.y + from.h, to.y + to.h);
      const yy = Math.round(top + (bot - top) / 2);
      const leftToRight = from.x < to.x;
      const x1 = leftToRight ? from.x + W : from.x, x2 = leftToRight ? to.x : to.x + W;
      const dir = leftToRight ? 1 : -1;
      if (e.kind === 'part') out.push(`<path d="M${x1},${yy} l${9 * dir},-7 l${9 * dir},7 l${-9 * dir},7 z" fill="${C.fg}"/>`);
      out.push(`<path d="M${x1 + (e.kind === 'part' ? 18 * dir : 0)},${yy} L${x2},${yy}" fill="none" stroke="${stroke}" stroke-width="1.4"${dash}/>`);
      if (e.kind !== 'part') out.push(`<path d="M${x2 - 9 * dir},${yy - 5} L${x2},${yy} L${x2 - 9 * dir},${yy + 5}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`);
      const mid = (x1 + x2) / 2;
      out.push(label(mid, yy - 7, e.label, 'middle'));
      out.push(label(x2 - (leftToRight ? 4 : -4), yy + 16, e.mult, leftToRight ? 'end' : 'start'));
      continue;
    }
    if (e.kind === 'isa') {
      // one hollow triangle under the parent; children elbow into its apex
      const px = portX(from, 'bottom', from.m.id), py = from.y + from.h;
      const cx = portX(to, 'top', ed), cy = to.y;
      const midY = Math.round(py + 14 + (cy - py - 14) / 2);
      out.push(`<path d="M${cx},${cy} L${cx},${midY} L${px},${midY} L${px},${py + 14}" fill="none" stroke="${C.edge}" stroke-width="1.4"/>`);
      if (!isaTargets.has(from.m.id)) {
        isaTargets.add(from.m.id);
        out.push(`<path d="M${px},${py} l8,14 l-16,0 z" fill="${C.bg}" stroke="${C.edge}" stroke-width="1.4"/>`);
      }
      continue;
    }
    // s = +1 when the edge runs downward, -1 when the target sits above
    const s = ed.down ? 1 : -1;
    const px = portX(from, ed.down ? 'bottom' : 'top', ed), py = ed.down ? from.y + from.h : from.y;
    const cx = portX(to, ed.down ? 'top' : 'bottom', ed), cy = ed.down ? to.y : to.y + to.h;
    const midY = Math.round(py + (cy - py) / 2);
    const start = e.kind === 'part' ? py + 18 * s : py;
    out.push(`<path d="M${px},${start} L${px},${midY} L${cx},${midY} L${cx},${cy}" fill="none" stroke="${stroke}" stroke-width="1.4"${dash}/>`);
    if (e.kind === 'part') out.push(`<path d="M${px},${py} l7,${9 * s} l-7,${9 * s} l-7,${-9 * s} z" fill="${C.fg}"/>`);
    else out.push(`<path d="M${cx - 5},${cy - 9 * s} L${cx},${cy} L${cx + 5},${cy - 9 * s}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`);
    if (e.kind === 'part') out.push(label(px + 10, py + 14 * s + (s < 0 ? 4 : 0), '1'));
    out.push(label(cx + 8, cy - 6 * s + (s < 0 ? 4 : 0), e.mult));
    // label on the horizontal run when it is long enough, else beside the vertical
    const room = Math.abs(px - cx) > e.label.length * 7 + 24;
    if (room) out.push(label((px + cx) / 2, midY - 6, e.label, 'middle'));
    else out.push(label(cx - 8, Math.round((midY + cy) / 2) + 4, e.label, 'end'));
  }

  const H = Math.max(...[...box.values()].map((b) => b.y + b.h)) + 70;
  const legend = [
    ['◆', C.fg, 'composition'], ['△', C.edge, 'generalization'], ['→', C.edge, 'association'],
    ['⇢', C.derived, '/derived (computed, not stored)'],
    [': type', C.value, 'value'], [': Class', C.ref, 'reference'], [': Enum', C.enum, 'enumeration'],
  ];
  let lx = 20;
  const legendSvg = legend.map(([sym, col, txt]) => {
    const s = `<text x="${lx}" y="${H - 20}" font-family="${MONO}" font-size="12" fill="${col}">${esc(sym)}</text>`
      + `<text x="${lx + sym.length * 7.4 + 6}" y="${H - 20}" font-family="${MONO}" font-size="12" fill="${C.muted}">${esc(txt)}</text>`;
    lx += (sym.length + txt.length) * 7.4 + 34;
    return s;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${H}" viewBox="0 0 ${WIDTH} ${H}">
  <rect width="${WIDTH}" height="${H}" fill="${C.bg}"/>
  <rect width="${WIDTH}" height="8" fill="${C.brand}"/>
  ${out.join('\n  ')}
  ${boxes.join('\n  ')}
  ${legendSvg.join('\n  ')}
  <text x="${WIDTH - 16}" y="${H - 20}" text-anchor="end" font-family="${MONO}" font-size="12" fill="${C.muted}">generated from schema/{core,match,table}.jsonld</text>
</svg>`;
}

const mmd = mermaid();
await mkdir(new URL('docs/', root), { recursive: true });
await writeFile(new URL('docs/class-diagram.mmd', root), mmd + '\n');
await writeFile(new URL('class-diagram.svg', root), svg() + '\n');
console.log('```mermaid\n' + mmd + '\n```');

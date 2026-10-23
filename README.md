# Football Schema

A canonical, machine-readable model of association football in JSON-LD —
competitions, seasons, clubs, matches and league tables — with the Premier
League as the reference competition. Modelled on
[Bitcoin Schema](https://bitcoin-desktop.github.io/schema/): one schema, many
projections (site, UML diagram, validator, table calculator).

**Record the events; derive everything else.** A match stores its goals, cards
and substitutions. The score, half-time score, result, minutes played and
every number in the league table are *derived* fields (`/name` in the
diagram), so a scoreline can never disagree with its goals.

## Modules

| module | layer | contents |
|---|---|---|
| [`core`](schema/core.jsonld) | domain | Competition, Season, Club, Registration, Stadium, Person → Player / Manager / Referee |
| [`match`](schema/match.jsonld) | event | Match, Lineup, Appearance, MatchEvent → Goal / Card / Substitution, status and kind enums |
| [`table`](schema/table.jsonld) | projection | Standing — every column derived from finished matches |
| [`premier-league`](schema/premier-league.jsonld) | competition | Premier League rules: tie-break order, match and squad rules |

Another league reuses `core`, `match` and `table` and adds its own module like `premier-league`.

## Data

The schema only describes what things are; the actual competitions, seasons and clubs are data in
[`data/`](data/), one document per thing, linked by relative IRIs:

```
data/
  competitions/premier-league.jsonld   #this: the Premier League → links its seasons
  seasons/2026-27.jsonld               #this: the 2026/27 season → links its 20 clubs
  clubs/ARS.jsonld …                   #this: the club, #stadium: its home ground
```

## Fixtures and results

All 380 fixtures of 2026/27 live in `data/matches/2026-27/mw01.jsonld … mw38.jsonld`, linked from the
season. They are imported from [openfootball](https://github.com/openfootball/football.json) (CC0)
by [`tools/import-openfootball.js`](tools/import-openfootball.js), which maps team names to the club
files and converts UK kick-off times to UTC. openfootball reports scores, not goals, so these
matches carry a reported `fullTime` / `halfTime` `Score`; when a match also has an event log the
`scoreMatchesEvents` rule makes the two agree. The season's `resultsAsOf` records how fresh the
results are, and `npm test` checks the fixture list is a complete double round-robin.

While openfootball lags, results can be entered by hand in
[`sources/manual-results-2026-27.json`](sources/manual-results-2026-27.json), each with the
published sources it was checked against (the match page links them). They only fill gaps: if
openfootball later reports a different score, the import stops and names the match.

Re-run `npm run import` when the source updates; it rewrites the matchweek files and the site.

**football-data.org (optional).** With an API token in `FOOTBALL_DATA_TOKEN` or a git-ignored
`.env.local`, `npm run football-data` fetches this season's matches into
`sources/football-data-2026-27.json` (selected fields only, never the token) and re-imports.
That adds half-time scores, referees (`data/people/referees.jsonld`), broadcast-picked kick-off
times and results openfootball has not published yet. Every score must agree across sources or
the import stops. Their terms require the line "Football data provided by the Football-Data.org
API", which the footer shows whenever their data is used, and say the data may not be referenced
after cancelling: delete the sources file and re-run `npm run import` and nothing from
football-data.org remains in `data/` or the site.

openfootball lists every match of an unpicked round at one placeholder time. The importer marks
such rounds `timeConfirmed: false` (except the final round, which really is simultaneous), and the
site shows "TBC" instead of a time.

Head-to-head records come from `data/history/<tier>/<season>.jsonld`: league matches between two
clubs in today's league, from openfootball (CC0). The Premier League from 2010/11 comes from
football.json ([`tools/import-history.js`](tools/import-history.js)). The Premier League from
1992/93 and the second to fourth tiers from 2000/01 come from the openfootball/england text files
([`tools/import-england.js`](tools/import-england.js); play-offs and cancelled matches are
skipped). `npm run history` refreshes both. Matches involving clubs we have no file for are left
out, and no venue is recorded because grounds change. Known source issue: some 1990s archive
dates are a day out (the 1999 Boxing Day round is dated 25 December). Scores are unaffected.

## Site

The presentation layer, generated as static HTML from `data/` by [`tools/gen-site.js`](tools/gen-site.js)
(builders in `tools/site/`, hand-written CSS and JS in `assets/`):

- [`fixtures/`](fixtures/) — the league hub, with tabs: **Summary** (followed clubs, the current and last matchweek,
  the full table), **Results** and **Fixtures** (by day, with a day
  strip), **Matchweeks**, and **Table** (overall, home, away, last-five form, half time, and over/under with both-teams-scored;
  European and relegation zones from the competition's `zones`). A club filter works on every match tab.
  Every row opens a match page (`fixtures/2026-27/ars-lee/`) with tabs: **Summary** (each side's
  last five results going in, or current form labelled as such for matches more than a week past
  the latest result; match facts; the other leg; previous and next match for both clubs),
  **Head to head** (record and every meeting since 2010/11, filterable to this ground) and
  **Table** (overall / home / away / form with both clubs highlighted). Pages carry schema.org
  `SportsEvent` data and canonical URLs. Set `homepage` in `package.json` to the published address to make
  them absolute and to emit `og:url` / `og:image`; until then links are relative. Kick-offs show in the viewer's time zone, and
  played matches without an imported result are flagged rather than shown as upcoming.
- [`clubs/`](clubs/) — a league board (clubs in table order with position, points and form) and one
  page per club in its colours: home and away records, the next match with the record against that
  opponent, every result and fixture, the full table (overall, home, away, form, half time), the
  season so far (runs, biggest win and defeat, clean sheets), a position chart, the league record
  against every other current club, and `fixtures.ics` to add all fixtures to a calendar.
- [`records/`](records/) — this season's biggest wins and highest-scoring matches, leaders (goals,
  clean sheets, home and away, current runs), a referee table, and records between today's clubs
  across the archive, including the all-time Premier League mini-league between them.

Each match also has a share-preview image (`card.png`, 1200×630, referenced by `og:image`) drawn by
[`tools/gen-cards.js`](tools/gen-cards.js). It needs `rsvg-convert` (librsvg), and uses ImageMagick
when present to shrink each card to about 20 KB. A card is only re-rendered when its SVG changes.
Fonts (Barlow Condensed, Inter; SIL Open Font License) are self-hosted in `assets/fonts/`.

Shields are drawn from each club's `colours` and `kitPattern`, not official crests. The pages work
without JavaScript; `assets/scores.js` adds the tabs and navigation, local kick-off times, a
light/dark switch, and followed clubs (stored only in the viewer's browser).

## Daily refresh

[`tools/refresh.sh`](tools/refresh.sh) fetches football-data.org (when a token is set) and
openfootball, keeping the last good copy if either fetch fails, then imports, rebuilds the site and
share cards, runs the checks, and commits locally only if the data changed. A score that disagrees
between sources stops it before anything is committed. It runs from cron each morning:

```
30 7 * * * /home/melvin/bots/tmp/epl/tools/refresh.sh >> /home/melvin/bots/tmp/epl/logs/refresh.log 2>&1
```

## Tools

```
npm run diagram   # regenerate class-diagram.svg + docs/class-diagram.mmd
npm run site      # regenerate fixtures/ and clubs/ from data/, then the share cards
npm run import    # pull fixtures and results from openfootball, then rebuild the site
npm run history   # pull past seasons for head-to-head, then rebuild the site
npm run derive    # scores, timelines and the table for examples/
npm test          # schema closure, diagram + site freshness, data conformance, derivations
```

Zero dependencies; Node 20+. The site is `index.html`, rendered client-side from `schema/*.jsonld`.

The namespace `https://football-schema.github.io/schema/` in `context.jsonld` is a placeholder — change it to wherever this is published.

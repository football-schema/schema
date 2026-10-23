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

Re-run `npm run import` when the source updates; it rewrites the matchweek files and the site.

## Site

The presentation layer, generated as static HTML from `data/` by [`tools/gen-site.js`](tools/gen-site.js)
(builders in `tools/site/`, hand-written CSS and JS in `assets/`):

- [`fixtures/`](fixtures/) — a scoreboard: one matchweek at a time grouped by day, a club filter,
  and the league table computed from the results. Kick-offs show in the viewer's time zone, and
  played matches without an imported result are flagged rather than shown as upcoming.
- [`clubs/`](clubs/) — a league page and one page per club in its colours, with position, form,
  latest results and next fixtures.

Shields are drawn from club colours, not official crests. The pages work without JavaScript;
`assets/scores.js` only adds navigation and local times.

## Tools

```
npm run diagram   # regenerate class-diagram.svg + docs/class-diagram.mmd
npm run site      # regenerate fixtures/ and clubs/ from data/
npm run import    # pull fixtures and results from openfootball, then rebuild the site
npm run derive    # scores, timelines and the table for examples/
npm test          # schema closure, diagram + site freshness, data conformance, derivations
```

Zero dependencies; Node 20+. The site is `index.html`, rendered client-side from `schema/*.jsonld`.

The namespace `https://football-schema.github.io/schema/` in `context.jsonld` is a placeholder — change it to wherever this is published.

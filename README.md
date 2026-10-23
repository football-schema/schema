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

## Site

[`clubs/`](clubs/) is the presentation layer: a league page and one page per club
(`clubs/arsenal/`, `clubs/manchester-city/`, …) in the club's colours, generated as static
HTML from `data/` by [`tools/gen-site.js`](tools/gen-site.js). Shields are drawn from club
colours, not official crests. The schema pages stay plain; they are the reference, this is
what people read.

A club is described once and outlives any one season. `npm test` loads `data/` as one linked
graph and checks every link resolves, every node conforms to the schema, and each season has
the competition's `clubsPerSeason` (20) clubs with unique codes.

## Tools

```
npm run diagram   # regenerate class-diagram.svg + docs/class-diagram.mmd
npm run site      # regenerate clubs/ from data/
npm run derive    # scores, timelines and the table for examples/
npm test          # schema closure, diagram + site freshness, data conformance, derivations
```

Zero dependencies; Node 20+. The site is `index.html`, rendered client-side from `schema/*.jsonld`.

The namespace `https://football-schema.github.io/schema/` in `context.jsonld` is a placeholder — change it to wherever this is published.

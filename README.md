# Football Schema

A canonical, machine-readable model of association football in JSON-LD: competitions,
seasons, clubs, grounds, people, matches and league tables, with the Premier League as the
reference competition. Modelled on [Bitcoin Schema](https://bitcoin-desktop.github.io/schema/):
one schema, many projections.

**Record the events; derive everything else.** A match records what happened (or, when a source
gives only the score, a reported `fullTime`). The score, the result, minutes played and every
number in a league table are derived fields (`/name` in the diagram), defined in the schema and
implemented once in [`tools/model.js`](tools/model.js).

## Modules

| module | layer | contents |
|---|---|---|
| [`core`](schema/core.jsonld) | domain | Competition (with TableZones), Season, Club, Registration, Stadium, Person → Player / Manager / Referee |
| [`match`](schema/match.jsonld) | event | Match, Score, Lineup, Appearance, MatchEvent → Goal / Card / Substitution; status, period, goal and card enums |
| [`table`](schema/table.jsonld) | projection | Standing: every column derived from finished matches |
| [`premier-league`](schema/premier-league.jsonld) | competition | Premier League rules: tie-break order, match, squad and season rules |

Another league reuses `core`, `match` and `table` and adds its own rules module.

## Data model

Generated from the schema by [`tools/gen-class-diagram.js`](tools/gen-class-diagram.js)
(also as [class-diagram.svg](class-diagram.svg)).

```mermaid
classDiagram
  direction TB
  class Competition {
    +string name
    +code country
    +CompetitionFormat format
    +int? tier
    +gYear founded
    +int? clubsPerSeason
    +int? relegationPlaces
    +int? pointsForWin
    +int? pointsForDraw
    +matchesPerClub() derived
    +currentSeason() derived
  }
  class Season {
    +string label
    +date startDate
    +date endDate
    +Club[]? promoted
    +date? resultsAsOf
    +champion() derived
  }
  class Club {
    +string name
    +string shortName
    +code tla
    +gYear founded
    +string? nickname
    +hexColour[]? colours
    +KitPattern? kitPattern
  }
  class Registration {
    +Player player
    +Season season
    +int shirtNumber
    +bool homegrown
  }
  class Stadium {
    +string name
    +string city
    +int? capacity
    +decimal? latitude
    +decimal? longitude
  }
  class Person {
    <<abstract>>
    +string name
    +string? knownAs
    +date dateOfBirth
    +code nationality
    +age() derived
  }
  class Player {
    +Position position
    +Foot preferredFoot
  }
  class Manager {
    +Club? club
  }
  class Referee {
    +bool fifaBadge
  }
  class TableZone {
    +int from
    +int to
    +ZoneKind kind
  }
  class Match {
    +dateTime kickoff
    +bool? timeConfirmed
    +int matchweek
    +MatchStatus status
    +int? attendance
    +Club homeTeam
    +Club awayTeam
    +Stadium venue
    +Referee? referee
    +homeScore() derived
    +awayScore() derived
    +result() derived
    +halfTimeScore() derived
  }
  class Lineup {
    +Club club
    +string formation
    +Manager manager
  }
  class Appearance {
    +Player player
    +int shirtNumber
    +bool starter
    +bool captain
    +minutesPlayed() derived
  }
  class MatchEvent {
    <<abstract>>
    +int minute
    +int? addedTime
    +Period period
    +Club club
    +clock() derived
  }
  class Goal {
    +Player scorer
    +Player? assist
    +GoalKind kind
    +creditedTo() derived
  }
  class Card {
    +Person player
    +CardColour colour
  }
  class Substitution {
    +Player playerOff
    +Player playerOn
    +bool concussion
  }
  class Score {
    +int home
    +int away
  }
  class Standing {
    +Club club
    +Season season
    +played() derived
    +won() derived
    +drawn() derived
    +lost() derived
    +goalsFor() derived
    +goalsAgainst() derived
    +goalDifference() derived
    +points() derived
    +position() derived
    +form() derived
  }
  Competition "1" *-- "0..*" TableZone : zones
  Competition "1" *-- "1..*" Season : seasons
  Season --> "2..*" Club : clubs
  Season "1" *-- "0..*" Match : matches
  Season ..> "0..*" Standing : /table
  Club --> "1" Stadium : homeGround
  Club "1" *-- "0..*" Registration : squad
  Person <|-- Player
  Person <|-- Manager
  Person <|-- Referee
  Match "1" *-- "0..2" Lineup : lineups
  Match "1" *-- "0..*" MatchEvent : events
  Match "1" *-- "0..1" Score : fullTime
  Match "1" *-- "0..1" Score : halfTime
  Match "1" *-- "0..1" Score : currentScore
  Lineup "1" *-- "11..20" Appearance : appearances
  MatchEvent <|-- Goal
  MatchEvent <|-- Card
  MatchEvent <|-- Substitution
```

## Using it

Data in this vocabulary is JSON-LD with this repo's [`context.jsonld`](context.jsonld):

```json
{ "@context": "https://football-schema.github.io/schema/context.jsonld",
  "@graph": [ { "@id": "#this", "@type": "Club", "name": "Arsenal Football Club", "tla": "ARS", … } ] }
```

The package exports a loader, the derivations and a validator:

```js
import { loadSchema, loadDir, score, standing, classify } from 'football-schema/model.js';
import { validate } from 'football-schema/validate.js';

const problems = validate(await loadSchema(), await loadDir('data/'));   // [] when valid
```

`validate` checks every node against its class, that references resolve to the right types, and the
Premier League's match and season rules (for example a complete double round-robin).

[`examples/2012-05-13-mci-qpr.jsonld`](examples/2012-05-13-mci-qpr.jsonld) is a worked example:
Manchester City 3–2 QPR, recorded as events only; `npm run derive` computes its score and table.

## Tools

```
npm run diagram   # regenerate class-diagram.svg + docs/class-diagram.mmd
npm run derive    # derived values for the examples
npm test          # schema closure, diagram freshness, examples, derivations
```

Zero dependencies; Node 20+. `index.html` is the schema reference, rendered from `schema/*.jsonld`.
Terms are named in the `urn:football:` namespace (so `Match` is `urn:football:Match`); the context and
this reference are published at <https://football-schema.github.io/schema/>.

Built on it: **matchday**, a Premier League scores site (a separate project).

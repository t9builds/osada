# Osada agent guide

Osada is a kudos game played in Slack: players thank colleagues with `/dekuju`, which gives them their team's
resource, and spend received resources on roads, settlements and cities on a shared hex map. TypeScript on Bun,
Slack via Bolt, Postgres via Drizzle. The spec is [issue #1](https://github.com/t9builds/osada/issues/1).

Never use the names, art or trademarks of the board game whose mechanics Osada borrows – not in code, copy or docs.

## Working principles

Ship the smallest correct change. Keep unrelated cleanup out of the change you were asked for. Find the module that
owns the behavior and follow its closest existing analogue.

## Where code goes

| Folder | Owns |
|---|---|
| `engine/` | Pure game rules, no I/O: board geometry and labels, seeded map generation, legality, costs, scoring, longest road, harvest, week keys |
| `game/` | The game service (`service.ts`): every command and query, transactions and invariants. `repository.ts` is its data access; `types.ts` its events, rejections and views |
| `db/` | Drizzle schema and opening the database (Postgres via Bun SQL, PGlite for tests and local play) |
| `render/` | Map as SVG, PNG and a read-only web page |
| `slack/` | The thin Slack adapter: parses payloads, calls the service, renders Block Kit. All Czech copy lives in `slack/copy.ts`, `slack/views.ts` and `copy/` |
| `web/` | HTTP routes next to Slack's: signed map links, the map image/page, `/cron/tick`, `/healthz` |
| `scheduler/` | The weekly tick, shared by the in-process timer and the cron endpoint |

Game rules live in `engine/` and `game/`, never in `slack/`. The Slack layer maps events to messages and rejection
reasons to Czech copy. Only `game/` touches the database.

## Conventions

- Files are kebab-case. Tests sit next to their subject as `name.test.ts`.
- Each module opens with a comment saying what it is for. Other comments give the reason behind non-obvious code.
- Players are Slack user ids; the service treats them as opaque strings.
- User-facing text is Czech and gender-neutral (no "dostal/a"): rephrase instead.
- A function over Biome's cognitive-complexity limit is split, not suppressed.
- Schema changes: edit `src/db/schema.ts`, then `bun run db:generate` and commit the new migration in `drizzle/`.

## Verify

Run `bun run check` before you commit: types, Biome lint and format, and tests. `bun run format` fixes formatting
and import order.

Test external behaviour through the highest seam: game service commands and queries on PGlite with a fake clock
(`game/test-kit.ts`), never table contents or private helpers. Slack handlers are tested with payload fixtures in
`slack/fixtures/` and the fake client in `slack/test-slack.ts`. No live Slack in tests.

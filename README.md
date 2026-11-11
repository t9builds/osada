# Osada

A kudos game for Slack. The only way resources enter the game is by thanking a colleague: thank someone with
`/dekuju @kolega za co` and they receive one unit of your team's resource. Players spend what they receive on roads,
settlements and cities on a shared hex map, and their team scores the points. Every building needs several
*different* resources, so you can't build from your own team's resource alone. Helping across teams is how you win.

All player-facing text is in Czech.

## How it plays

- Every **team** produces one **resource**. Each player gets a weekly **allowance** (3, or 5 on teams of up to 3
  active players) of their team's resource that they can only give away, always with a written reason. Unused
  allowance expires at Monday 00:00 (Europe/Prague).
- You can thank the same person once a week, never yourself. Every thanks is posted in the thanks channel, and the
  recipient gets a DM.
- Received resources go into your **inventory**. Spend them with `/stavet`:
  - **road**: 2 different resources, 1 point. It must touch your team's network.
  - **settlement**: 3 different resources, 3 points. It goes on your team's roads, and never right next to another settlement.
  - **city**: 4 different resources (capped at the number of resources in play). It upgrades your settlement, for 6 points in total.
- Every week, settlements harvest 1 and cities 2 of each adjacent tile's resource. Deserts yield nothing.
- Trade with others (`/smena`) or with the bank at 3:1 (`/smena banka`). Open offers expire at the weekly rollover.
- The team with the longest continuous road (at least 5) gets +2 points. A season lasts 6 weeks, and the team with
  the most points wins. Then the map resets.
- App Home shows your team, inventory, allowance, buildings, the map, the scoreboard and recent thanks.
- `/osada pomoc` explains the rules in Czech. `/osada stav`, `/osada mapa` and `/osada historie` show your status,
  the map link and past winners. `/osada odhlasit` and `/osada prihlasit` opt you out and back in.

## Install into Slack

You need [Bun](https://bun.sh) 1.4 or later. Production also needs Postgres. Locally, Osada runs on an embedded
PGlite database.

### 1. Create the Slack app from the manifest

1. Open <https://api.slack.com/apps> and choose **Create New App → From a manifest**.
2. Pick your workspace, paste the contents of [`slack-manifest.yaml`](slack-manifest.yaml) (YAML tab) and create
   the app. The manifest declares the slash commands (`/dekuju`, `/stavet`, `/smena`, `/osada`, `/osada-admin`),
   the **Poděkovat** message shortcut, App Home, interactivity, and the bot scopes `commands`, `chat:write`,
   `chat:write.public`, `users:read`, `usergroups:read` and `im:write`.
3. Choose **Install to Workspace** and allow it.

### 2. Collect the tokens

| What | Where in the app settings | Env var |
|---|---|---|
| Bot User OAuth Token (`xoxb-…`) | OAuth & Permissions | `SLACK_BOT_TOKEN` |
| Signing Secret | Basic Information → App Credentials | `SLACK_SIGNING_SECRET` |
| App-Level Token (`xapp-…`), for local Socket Mode only | Basic Information → App-Level Tokens → Generate, scope `connections:write` | `SLACK_APP_TOKEN` |

Find the Slack user IDs of the game admins: open a profile, then **⋮ → Copy member ID**.

### 3. Set the environment variables

```sh
cp .env.example .env
```

| Variable | Required | Meaning |
|---|---|---|
| `SLACK_BOT_TOKEN` | yes | The bot token |
| `SLACK_APP_TOKEN` | dev | When set, the app runs in Socket Mode and needs no public URL |
| `SLACK_SIGNING_SECRET` | prod | Verifies Slack's HTTP requests (HTTP mode) |
| `OSADA_ADMINS` | yes | Comma-separated user IDs allowed to use `/osada-admin` |
| `DATABASE_URL` | prod | `postgres://…`. When empty, a PGlite database is kept in `PGLITE_DIR` (default `.pglite`) |
| `PUBLIC_URL` | for maps | Public base URL of the app. Slack fetches map images from it; without it, messages have no map image |
| `MAP_SECRET` | no | Signs map links (defaults to the signing secret) |
| `CRON_SECRET` | prod | Bearer token for `POST /cron/tick`; the endpoint is off without it |
| `INTERNAL_SCHEDULER` | no | `true`/`false`: run the weekly tick in-process. Defaults to `true` in Socket Mode, `false` in HTTP mode |
| `PORT` | no | HTTP port (default 3000; the Docker image uses 8080) |

### 4. Run locally with Socket Mode

```sh
bun install
bun run dev        # Bun loads .env automatically
```

You should see `Osada running on port 3000 (Socket Mode)`. Database migrations run on start.

Slack fetches map images from the internet, so a local app shows no map unless you expose it. For example, run
`cloudflared tunnel --url http://localhost:3000` and set `PUBLIC_URL` to the tunnel URL.

### 5. Set up the game in Slack

Run these as one of the `OSADA_ADMINS` (`/osada-admin pomoc` lists every admin command):

```text
/osada-admin tym "Engineering" #d94f30 ruda
/osada-admin tym "Design" #3b7dd8 vlna
/osada-admin tym "Sales" #e0b020 obilí
/osada-admin hrac @jana Engineering
/osada-admin skupina @design-team Design
/osada-admin kanal diky #osada
/osada-admin kanal smena #osada-smeny
/osada-admin kanal digest #osada
/osada-admin sezona start 6
```

- You need 3–6 teams, each with a different resource: `ruda`, `vlna`, `obilí`, `dřevo`, `cihly` or `sklo`.
- The app can post to public channels without being invited. Invite it to private channels (`/invite @Osada`).
- Tune the balance with `/osada-admin nastav <klíč> <hodnota>`. The keys are `prideleni`,
  `prideleni-maly-tym`, `maly-tym`, `casova-zona`, `cena-cesta`, `cena-osada`, `cena-mesto`, `delka-sezony` and
  `banka`.
- `/osada-admin dar @kolega 2 ruda Výhra v kvízu` grants resources (as a quiz prize, say). `/osada-admin audit`
  shows the ledger of every resource movement.

### 6. Deploy with Docker

The image is a single container: Bolt's HTTP receiver handles `/slack/events`, next to the app's own routes
(`/map/…`, `/cron/tick`, `/healthz`).

```sh
docker build -t osada .
docker run -p 8080:8080 \
  -e SLACK_BOT_TOKEN=xoxb-… \
  -e SLACK_SIGNING_SECRET=… \
  -e OSADA_ADMINS=U0123ABC \
  -e DATABASE_URL=postgres://user:pass@host:5432/osada \
  -e PUBLIC_URL=https://osada.example.com \
  -e CRON_SECRET=$(openssl rand -hex 24) \
  osada
```

Then switch the Slack app to HTTP mode. In the app settings, open **App Manifest**, set
`socket_mode_enabled: false`, and replace every `https://osada.example.com` with your `PUBLIC_URL`. Slack verifies
the Event Subscriptions URL when you save.

The weekly rollover pays the harvest, expires offers, posts the digest and ends the season after its last week. It
only acts once a new week has started, so calling it often is safe:

- **Cloud Run**: deploy the image (`gcloud run deploy osada --image … --port 8080 --set-env-vars …`). Then create a
  Cloud Scheduler HTTP job that runs hourly, sends `POST https://<service-url>/cron/tick` and adds the header
  `Authorization: Bearer <CRON_SECRET>`. Cloud Run scales to zero, so don't rely on `INTERNAL_SCHEDULER` there.
- **Always-on host** (a VM or a container with one replica): set `INTERNAL_SCHEDULER=true` instead.

## Development

```sh
bun run check        # typecheck, Biome lint, tests
bun run format       # fix formatting and import order
bun run db:generate  # create a migration after editing src/db/schema.ts
```

Tests run against in-process PGlite, so they need no Docker. See [AGENTS.md](AGENTS.md) for the code layout and
conventions.

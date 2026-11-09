# BacklogMatters

Local-first product backlog management for project managers. It organizes backlogs; it does not replace Jira or Trello.

- **Structure:** projects, each with epics and stories, tasks and bugs.
- **Prioritization:** drag-to-rank, plus a suggested order from MoSCoW (Must, Should, Could, Won't), urgency (which rises as a due date
  approaches) and T-shirt size. Nobody types numbers; sizes stand for points underneath.
- **Priority map:** drag items on a priority-by-size grid to see quick wins and big bets.
- **Planning:** releases or sprints with capacity against estimated points, and a warning when must-haves exceed 60% of capacity.
- **Dependencies:** blocked-by links, with warnings when rank or release order contradicts them.
- **Grooming health:** flags unestimated, stale, duplicate and incomplete items.
- **Import / export:** CSV (including Jira and Trello column names) and a full-fidelity JSON file.
- **Backup:** download the whole database as one file, from the Projects page (or the administration page when accounts are on).
- **Accounts (optional, off by default):** administrator, manager and viewer roles, per-project sharing, and an administration page.

## Quick start

Double-click `BacklogMatters.bat`. It sets up whatever is missing and then starts the app at http://localhost:4780:

1. Uses the Node.js on this PC if it is version 22 or newer; otherwise downloads a private copy into `.runtime/` (checksum verified, nothing installed system-wide).
2. Installs dependencies on the first run, and again if the Node version changes.
3. Builds the app if there is no build yet.

After changing the code, run `BacklogMatters.bat rebuild`.

## Develop

Requires Node 22 or newer on 64-bit Windows.

```
npm install
npm run dev        # API on :4780, web client with hot reload on http://localhost:5173
npm test           # server logic and API tests
npm run test:ui    # builds, then clicks through every screen in Edge or Chrome (set BM_BROWSER to use another browser)
npm run typecheck
```

## Run a production build

```
npm run build
npm start          # http://localhost:4780
```

## Package for people without Node

```
npm run package
```

This writes `release/BacklogMatters-<version>.zip`. It contains the app, its own copy of Node and two launchers, so the recipient
only unzips it and double-clicks **Start BacklogMatters**. The first run downloads `node.exe` from nodejs.org (checksum verified)
and caches it in `.cache/`.

## Layout

| Path | Contents |
| --- | --- |
| `shared/` | Types and pure logic (score, grooming checks, dependency cycles) used by server and client |
| `server/src/store.ts` | The only module that talks to the database |
| `server/src/routes/` | HTTP API |
| `client/src/` | React web client |
| `packaging/` | Launchers and the end-user README copied into the zip |

## Configuration

Set through environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `BM_HOST` | `127.0.0.1` | Address to listen on. The default accepts connections from this PC only. |
| `BM_PORT` | `4780` | Port |
| `BM_DATA_DIR` | `./data` | Folder holding `backlogmatters.db` |
| `BM_ACCOUNTS` | unset | Feature flag. Set to `1` to turn on sign-in, user management, per-project sharing and the administration page. |
| `BM_TRUST_PROXY` | unset | Set to `1` behind a reverse proxy that terminates HTTPS |
| `BM_OPEN_BROWSER` | unset | Set to `1` to open the browser on start |

### The accounts flag

With `BM_ACCOUNTS` unset the app is single-user: there is no sign-in, everything runs as a built-in "Local user", and the sign-in,
administration and sharing endpoints return 404. In this mode the server only answers requests addressed to `localhost` and refuses
to start on any other `BM_HOST`.

Setting `BM_ACCOUNTS=1` later keeps all existing projects. The first visit asks for an administrator account; projects created
before then belong to "Local user" and can be reassigned on the Administration page.

## Running as a service for a whole company

The same server works as a shared service: set `BM_ACCOUNTS=1` and `BM_HOST=0.0.0.0`, put it behind a reverse proxy with HTTPS, and
set `BM_TRUST_PROXY=1` so session cookies are marked secure. Do not expose it over plain HTTP.

Known limits before relying on it company-wide:

- Storage is a single SQLite file. All database access is in `server/src/store.ts`, which is the place to swap in a server database.
- Sign-in is username and password only; there is no single sign-on.
- The login attempt limiter is held in memory, so it only works with a single server process.

# ananke-archive — Roadmap

## Phase 1 (current): File-based storage

Zero-dependency REST API using Node.js built-in `node:http`, `node:fs`, and `node:url`.

- `POST /runs` — accept serialized replay JSON, save to `data/runs/{timestamp}.json`
- `GET /runs` — list files with metadata (id, savedAt, sizeBytes)
- `GET /runs/:id` — return raw replay JSON for client-side `deserializeReplay()`
- `GET /health` — liveness check
- `GET /validation` / `POST /validation/:scenario` / `GET /validation/:scenario` — validation result storage

## Phase 2: Server-side replay deserialization

- `GET /runs/:id?tick=N` — server calls `replayTo(replay, N, ctx)` and returns `WorldState`
  snapshot as JSON; avoids shipping full replay to thin clients
- `GET /runs/:id/summary` — extract metadata (tick count, entity ids, winner) without
  sending the full replay body
- Port TypeScript types from `src/server.js` to `src/server.ts`

## Phase 3: Validation result storage

- `POST /validation/:scenario` — accept validation result JSON (pass/fail, message, ananke
  version, timestamp)
- `GET /validation` — return list with pass/fail summary per scenario
- `GET /validation/history/:scenario` — return all historical results for a scenario (requires
  Phase 4 SQLite for efficient queries)

## Phase 4: SQLite backend

Replace file storage with SQLite for efficient querying and indexing.

- `runs` table: id, created_at, seed, entity_count, tick_count, winner_team, replay_json
- `validation_results` table: scenario, pass, message, ananke_version, recorded_at
- Use `node:sqlite` (Node 22+ experimental) or `better-sqlite3` as a dev dependency
- Provide a migration script from the Phase 1 file layout

## Phase 5: Public web UI

- Static HTML page served from `GET /` that links to `ananke-world-ui`
- Browseable run list with fight summary cards
- Validation history chart (pass rate over time per scenario)
- "Open in World UI" button that loads a run's replay into the `ananke-world-ui` Replay Viewer
  via a query parameter

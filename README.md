# ananke-archive

REST API for storing and querying [Ananke](https://github.com/its-not-rocket-science/ananke)
simulation runs, replays, and validation results.

Designed to complement `ananke-world-ui`: the UI runs simulations and POSTs them here for
persistent storage, comparison, and browsing.

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns `{ status: "ok" }` |
| `GET` | `/runs` | List all saved replay runs (newest first) |
| `POST` | `/runs` | Save a replay JSON body; returns `{ id }` |
| `GET` | `/runs/:id` | Fetch a single saved replay by id |
| `GET` | `/validation` | List all saved validation result files |
| `POST` | `/validation/:scenario` | Save a validation result summary for `:scenario` |
| `GET` | `/validation/:scenario` | Fetch the saved validation result for `:scenario` |

---

## Quick start

```bash
npm install
npm start
# Server listens on http://localhost:3000
```

For development with auto-restart on file changes:

```bash
npm run dev
```

Override the port:

```bash
PORT=8080 npm start
```

---

## Data format

### Runs (Phase 1)

Replay JSON is stored as-is.  The expected input format is the output of
`serializeReplay()` from `@its-not-rocket-science/ananke`:

```bash
# Save a replay
curl -X POST http://localhost:3000/runs \
  -H "Content-Type: application/json" \
  -d @my-replay.json

# List runs
curl http://localhost:3000/runs

# Fetch a run
curl http://localhost:3000/runs/run-1700000000000
```

Files are saved to `data/runs/{timestamp}.json`.

### Validation results (Phase 3)

Validation result summaries are stored per scenario name:

```bash
# Save a result
curl -X POST http://localhost:3000/validation/armed-vs-unarmed \
  -H "Content-Type: application/json" \
  -d '{ "pass": true, "message": "Armour delay confirmed", "version": "0.1.1" }'

# Fetch it later
curl http://localhost:3000/validation/armed-vs-unarmed
```

---

## Use cases

- **Baseline comparison**: save validation results from each release; compare across versions to
  detect regressions in emergent behaviour
- **Battle archive**: store notable simulation runs for replay and analysis
- **CI integration**: pipe `emergent-validation` output to `POST /validation/:scenario` in a
  post-build step

---

## Storage roadmap

| Phase | Backend |
|---|---|
| 1 (current) | Plain JSON files (`data/runs/`, `data/validation/`) |
| 4 | SQLite — `node:sqlite` built-in (Node 22+) or `better-sqlite3` |
| 5 | Public web UI (links to `ananke-world-ui`) |

---

## Link

Core simulation engine: https://github.com/its-not-rocket-science/ananke

# ananke-archive

![Ananke version](https://img.shields.io/badge/ananke-0.1.0-6366f1)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![Stack](https://img.shields.io/badge/stack-Node%20%2B%20SQLite-orange)
![Status](https://img.shields.io/badge/status-wanted-lightgrey)

A searchable public database of Ananke simulation runs, validated scenarios, parameter spaces,
and raw trace data.  Positions Ananke as a scientific and educational resource by making
simulation outcomes browsable, filterable, and downloadable without requiring any local setup.

---

## Table of contents

1. [Purpose](#purpose)
2. [Prerequisites](#prerequisites)
3. [Quick start](#quick-start)
4. [Architecture](#architecture)
5. [REST API](#rest-api)
6. [Ingest pipeline](#ingest-pipeline)
7. [File layout](#file-layout)
8. [Data model](#data-model)
9. [Contributing scenarios](#contributing-scenarios)
10. [Roadmap](#roadmap)

---

## Purpose

Ananke produces deterministic, reproducible simulation runs.  Every scenario has a seed,
a parameter set, and a full event trace.  The Archive makes those runs:

- **Browsable** — search by scenario name, entity count, tech era, or outcome (winner, tick count, casualty rate)
- **Comparable** — view parameter spaces across hundreds of seeded runs of the same scenario
- **Downloadable** — export raw trace data (JSON replay files) for offline analysis
- **Citable** — each run gets a stable URL for use in papers, blog posts, and game dev write-ups

The Archive is a companion to `ananke-historical-battles` (which contributes validated
scenarios) and to the emergent validation report in the main Ananke repo.

---

## Prerequisites

- Node 22+
- SQLite 3 (bundled via `better-sqlite3`) — the only runtime dependency
- An Ananke checkout (for the ingest pipeline)
- Optional: a static file host (Netlify, GitHub Pages, Vercel) to serve the browser client

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/its-not-rocket-science/ananke-archive
cd ananke-archive

# 2. Install
npm install

# 3. Ingest a run from an Ananke replay file
npm run ingest -- --file path/to/replay.json --scenario "Knight vs Brawler" --seed 42

# 4. Start the API server (http://localhost:4000)
npm run server

# 5. Open the browser client
open client/index.html
```

---

## Architecture

```
ananke-archive/
  src/
    ingest.ts        Read Ananke replay JSON → normalise → insert into SQLite
    server.ts        Node http REST API (zero external deps)
    query.ts         SQLite query helpers
    schema.sql       Database schema
  client/
    index.html       Standalone browser search + browse UI (no build step)
  scripts/
    bulk-ingest.ts   Ingest all replay files in a directory
    export.ts        Export query results to CSV or NDJSON
```

The server follows the same zero-external-dependency approach as `world-server.ts` in the main
Ananke repo: Node built-in `http`, with `better-sqlite3` as the only runtime dependency.

---

## REST API

All responses are JSON.  The API is read-only except for the ingest endpoint (authenticated
via a bearer token in production).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/runs` | List runs; supports `?scenario=`, `?seed=`, `?minTicks=`, `?maxTicks=`, `?winner=` |
| `GET` | `/runs/:id` | Single run metadata |
| `GET` | `/runs/:id/trace` | Full event trace (paginated, `?page=`, `?limit=`) |
| `GET` | `/runs/:id/replay` | Download raw Ananke replay JSON |
| `GET` | `/scenarios` | List distinct scenario names with run counts |
| `GET` | `/scenarios/:name/distribution` | Outcome distribution (tick count, casualty rate, winner) across seeds |
| `GET` | `/stats` | Total run count, scenario count, entity-tick count |
| `POST` | `/ingest` | Submit a replay JSON for archiving (bearer-token protected) |

Example query — all runs of "Pneumonic Plague" with >50 deaths:

```
GET /runs?scenario=Pneumonic+Plague&minDeaths=50
```

---

## Ingest pipeline

The ingest pipeline reads an Ananke replay file (`ReplayRecord[]`) and normalises it into the
database.  Key Ananke types used:

```typescript
import { ReplayRecord, ReplayRecorder } from "ananke/replay";
import { serializeWorld }               from "ananke/serialize";
```

Each replay file produces one `run` row and N `event` rows.  The pipeline also computes
derived summary fields (tick count, entity count, winner team, casualty rate) for fast filtering.

To ingest all runs from the Simulation Zoo:

```bash
# Build the Zoo first
cd ../ananke && npm run generate-zoo
# Then bulk-ingest
cd ../ananke-archive && npm run bulk-ingest -- --dir ../ananke/docs/zoo/traces/
```

---

## File layout

```
ananke-archive/
  src/
    ingest.ts        ReplayRecord normalisation and insert
    server.ts        HTTP server (GET + POST /ingest)
    query.ts         Parameterised SQLite helpers
    schema.sql       Runs, events, scenarios tables
  client/
    index.html       Search UI — scenario dropdown, filter sliders, run table, trace viewer
  scripts/
    bulk-ingest.ts   Directory scan + parallel ingest
    export.ts        CSV / NDJSON export
  test/
    ingest.test.ts   Round-trip: ingest a fixture replay → query it back
    api.test.ts      REST endpoint contract tests
  archive.db         SQLite database (git-ignored in production; committed for demo)
  README.md
```

---

## Data model

```sql
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,  -- SHA-256 of replay JSON
  scenario      TEXT NOT NULL,
  seed          INTEGER NOT NULL,
  entity_count  INTEGER NOT NULL,
  tick_count    INTEGER NOT NULL,
  winner_team   INTEGER,           -- NULL if no winner (epidemic, etc.)
  casualty_rate REAL,              -- deaths / entity_count
  ingested_at   TEXT NOT NULL,     -- ISO 8601
  replay_json   TEXT NOT NULL      -- full Ananke replay, compressed
);

CREATE TABLE events (
  run_id   TEXT NOT NULL REFERENCES runs(id),
  tick     INTEGER NOT NULL,
  type     TEXT NOT NULL,          -- "hit", "death", "shock", "disease", etc.
  entity_a INTEGER,
  entity_b INTEGER,
  value    REAL                    -- energy_J, shockQ, etc. depending on type
);

CREATE TABLE scenarios (
  name      TEXT PRIMARY KEY,
  run_count INTEGER NOT NULL DEFAULT 0
);
```

---

## Contributing scenarios

1. Write a scenario using Ananke's `ArenaScenario` or `ValidationScenario` types.
2. Run it across at least 20 seeds and collect the replay files.
3. Submit a PR to this repo with the replay files in `data/contributed/`.
4. The CI pipeline auto-ingests them and updates the Archive.

For historically-grounded scenarios, see `ananke-historical-battles` for the source
citation requirements and casualty-tolerance methodology.

---

## Roadmap

| Priority | Item |
|----------|------|
| P0 | Ingest pipeline + SQLite schema + REST API |
| P0 | Browser client — search, filter, run detail view |
| P1 | Trace viewer — event-by-event playback in the browser |
| P1 | Parameter space visualiser — scatter/histogram of outcomes across seeds |
| P2 | Bulk export (CSV, NDJSON) for research use |
| P2 | Hosted public instance at archive.ananke.dev (or similar) |
| P3 | Citation export (BibTeX, APA) for each committed scenario run |

The P0 items are self-contained and can be built without any Ananke changes.  The trace viewer
(P1) depends on CE-3 (JSON scenario schema) landing in Ananke so scenario parameters are
machine-readable.

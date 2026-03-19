// src/server.js — ananke-archive REST API server
//
// Node.js HTTP server using only built-in modules (node:http, node:fs, node:path, node:url).
// Zero external runtime dependencies required for Phase 1.
//
// Endpoints:
//   GET  /health          — 200 OK; liveness check
//   GET  /runs            — list saved replay runs (filename + metadata)
//   POST /runs            — save a replay JSON body; returns { id }
//   GET  /runs/:id        — fetch a single saved replay by id
//   GET  /validation      — list saved validation results
//   POST /validation/:scenario — save a validation result summary
//   GET  /validation/:scenario — fetch a saved validation result
//
// Data storage (Phase 1): plain JSON files under data/runs/ and data/validation/.
// TODO Phase 4: replace with SQLite (use the "node:sqlite" built-in once stable, or better-sqlite3).
// TODO Phase 2: add replay deserialization on GET /runs/:id for server-side replay-to support.
// TODO: add authentication before exposing this server publicly.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const VALIDATION_DIR = path.join(DATA_DIR, "validation");

// Ensure storage directories exist on startup
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.mkdirSync(VALIDATION_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Read the full request body as a string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Sanitize an id so it cannot escape the data directory. */
function sanitizeId(id) {
  // Allow only alphanumeric, hyphen, underscore, dot (no path separators)
  return id.replace(/[^a-zA-Z0-9\-_.]/g, "");
}

/** Send a JSON response. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",  // TODO: restrict in production
  });
  res.end(payload);
}

/** Send a 404. */
function send404(res) {
  sendJson(res, 404, { error: "Not found" });
}

/** Send a 405. */
function send405(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}

// ── Route handlers ─────────────────────────────────────────────────────────────

/** GET /health */
function handleHealth(res) {
  sendJson(res, 200, { status: "ok", version: "0.1.0" });
}

/** GET /runs — list all saved runs */
function handleListRuns(res) {
  const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  const runs = files.map((filename) => {
    const id = filename.replace(/\.json$/, "");
    const stat = fs.statSync(path.join(RUNS_DIR, filename));
    return { id, filename, savedAt: stat.mtime.toISOString(), sizeBytes: stat.size };
  });
  // Sort newest first
  runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  sendJson(res, 200, { runs });
}

/** POST /runs — save a replay JSON body */
async function handleSaveRun(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Failed to read request body" });
    return;
  }

  // Validate that the body is valid JSON before saving
  // TODO Phase 2: call deserializeReplay() from @its-not-rocket-science/ananke to fully validate
  try {
    JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Request body is not valid JSON" });
    return;
  }

  const id = `run-${Date.now()}`;
  const filename = `${id}.json`;
  const filepath = path.join(RUNS_DIR, filename);

  fs.writeFileSync(filepath, body, "utf-8");
  sendJson(res, 201, { id, filename });
}

/** GET /runs/:id — fetch a single run */
function handleGetRun(id, res) {
  const safe = sanitizeId(id);
  const filepath = path.join(RUNS_DIR, `${safe}.json`);

  if (!fs.existsSync(filepath)) {
    send404(res);
    return;
  }

  const content = fs.readFileSync(filepath, "utf-8");
  // Return raw JSON so the caller can deserializeReplay() client-side
  // TODO Phase 2: parse and call replayTo() server-side if ?tick=N query param is present
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(content),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(content);
}

/** GET /validation — list all saved validation results */
function handleListValidation(res) {
  const files = fs.readdirSync(VALIDATION_DIR).filter((f) => f.endsWith(".json"));
  const results = files.map((filename) => {
    const scenario = filename.replace(/\.json$/, "");
    const stat = fs.statSync(path.join(VALIDATION_DIR, filename));
    return { scenario, filename, savedAt: stat.mtime.toISOString() };
  });
  results.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  sendJson(res, 200, { validationResults: results });
}

/** POST /validation/:scenario — save a validation result summary */
async function handleSaveValidation(scenario, req, res) {
  const safe = sanitizeId(scenario);
  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 400, { error: "Failed to read request body" });
    return;
  }

  try {
    JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: "Request body is not valid JSON" });
    return;
  }

  const filepath = path.join(VALIDATION_DIR, `${safe}.json`);
  fs.writeFileSync(filepath, body, "utf-8");
  sendJson(res, 201, { scenario: safe });
}

/** GET /validation/:scenario — fetch a single validation result */
function handleGetValidation(scenario, res) {
  const safe = sanitizeId(scenario);
  const filepath = path.join(VALIDATION_DIR, `${safe}.json`);

  if (!fs.existsSync(filepath)) {
    send404(res);
    return;
  }

  const content = fs.readFileSync(filepath, "utf-8");
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(content),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(content);
}

// ── Router ─────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    res.end();
    return;
  }

  // GET /health
  if (method === "GET" && pathname === "/health") {
    handleHealth(res);
    return;
  }

  // GET /runs
  if (method === "GET" && pathname === "/runs") {
    handleListRuns(res);
    return;
  }

  // POST /runs
  if (method === "POST" && pathname === "/runs") {
    await handleSaveRun(req, res);
    return;
  }

  // GET /runs/:id
  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    const id = runMatch[1];
    if (method === "GET") {
      handleGetRun(id, res);
    } else {
      send405(res);
    }
    return;
  }

  // GET /validation
  if (method === "GET" && pathname === "/validation") {
    handleListValidation(res);
    return;
  }

  // /validation/:scenario
  const validationMatch = pathname.match(/^\/validation\/([^/]+)$/);
  if (validationMatch) {
    const scenario = validationMatch[1];
    if (method === "GET") {
      handleGetValidation(scenario, res);
    } else if (method === "POST") {
      await handleSaveValidation(scenario, req, res);
    } else {
      send405(res);
    }
    return;
  }

  send404(res);
});

// ── Start ──────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`ananke-archive listening on http://localhost:${PORT}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /runs          — list runs`);
  console.log(`  POST /runs          — save replay JSON`);
  console.log(`  GET  /runs/:id      — fetch run`);
  console.log(`  GET  /validation    — list validation results`);
  console.log(`  POST /validation/:scenario — save validation result`);
  console.log(`  GET  /validation/:scenario — fetch validation result`);
  console.log(`\nData directory: ${DATA_DIR}`);
});

export default server;

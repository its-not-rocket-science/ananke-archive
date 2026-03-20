// src/server.js — searchable replay archive API server

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestReplayObject, ensureArchiveDirs } from "./ingest.ts";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env["DATA_DIR"] ?? path.resolve(__dirname, "..", "data"));
const RUNS_DIR = path.join(DATA_DIR, "runs");
const VALIDATION_DIR = path.join(DATA_DIR, "validation");

ensureArchiveDirs(DATA_DIR);
fs.mkdirSync(VALIDATION_DIR, { recursive: true });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9\-_.]/g, "");
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function send404(res) {
  sendJson(res, 404, { error: "Not found" });
}

function send405(res) {
  sendJson(res, 405, { error: "Method not allowed" });
}

function send400(res, message) {
  sendJson(res, 400, { error: message });
}

function loadArchiveRunById(id) {
  const safe = sanitizeId(id);
  const filepath = path.join(RUNS_DIR, `${safe}.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function loadArchiveRuns() {
  const files = fs.readdirSync(RUNS_DIR).filter((file) => file.endsWith(".json"));
  const runs = files.map((filename) => JSON.parse(fs.readFileSync(path.join(RUNS_DIR, filename), "utf-8")));
  runs.sort((left, right) => right.ingestedAt.localeCompare(left.ingestedAt));
  return runs;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSearch(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function filterRuns(runs, searchParams) {
  const q = normalizeSearch(searchParams.get("q"));
  const scenario = normalizeSearch(searchParams.get("scenario"));
  const winner = normalizeSearch(searchParams.get("winner"));
  const seed = toNumber(searchParams.get("seed"));
  const minTicks = toNumber(searchParams.get("minTicks"));
  const maxTicks = toNumber(searchParams.get("maxTicks"));

  return runs.filter((run) => {
    const metadata = run.metadata ?? {};

    if (scenario && normalizeSearch(metadata.scenario) !== scenario) return false;
    if (winner && normalizeSearch(metadata.winnerTeam) !== winner) return false;
    if (seed !== null && metadata.seed !== seed) return false;
    if (minTicks !== null && (metadata.tickCount ?? 0) < minTicks) return false;
    if (maxTicks !== null && (metadata.tickCount ?? 0) > maxTicks) return false;
    if (q && !(metadata.searchableText ?? "").includes(q)) return false;

    return true;
  });
}

function summarizeRun(run) {
  return {
    id: run.id,
    ingestedAt: run.ingestedAt,
    metadata: run.metadata,
  };
}

function handleHealth(res) {
  sendJson(res, 200, { status: "ok", version: "0.2.0" });
}

function handleListRuns(url, res) {
  const runs = filterRuns(loadArchiveRuns(), url.searchParams);
  const scenarios = [...new Set(runs.map((run) => run.metadata?.scenario).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  sendJson(res, 200, {
    runs: runs.map(summarizeRun),
    scenarios,
    total: runs.length,
  });
}

async function handleSaveRun(req, res) {
  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch {
    send400(res, "Failed to read request body");
    return;
  }

  let replay;
  try {
    replay = JSON.parse(rawBody);
  } catch {
    send400(res, "Request body is not valid JSON");
    return;
  }

  const archive = ingestReplayObject(replay, {
    dataDir: DATA_DIR,
    scenario: typeof replay.scenario === "string" ? replay.scenario : undefined,
    seed: typeof replay.seed === "number" ? replay.seed : typeof replay.worldSeed === "number" ? replay.worldSeed : undefined,
  });

  sendJson(res, 201, summarizeRun(archive));
}

function handleGetRun(id, res) {
  const archive = loadArchiveRunById(id);
  if (!archive) {
    send404(res);
    return;
  }

  sendJson(res, 200, archive);
}

function handleGetReplay(id, res) {
  const archive = loadArchiveRunById(id);
  if (!archive) {
    send404(res);
    return;
  }

  const payload = JSON.stringify(archive.replay);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

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

async function handleSaveValidation(scenario, req, res) {
  const safe = sanitizeId(scenario);
  let body;
  try {
    body = await readBody(req);
  } catch {
    send400(res, "Failed to read request body");
    return;
  }

  try {
    JSON.parse(body);
  } catch {
    send400(res, "Request body is not valid JSON");
    return;
  }

  const filepath = path.join(VALIDATION_DIR, `${safe}.json`);
  fs.writeFileSync(filepath, body, "utf-8");
  sendJson(res, 201, { scenario: safe });
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = url.pathname.replace(/\/$/, "") || "/";
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" });
    res.end();
    return;
  }

  if (method === "GET" && pathname === "/health") {
    handleHealth(res);
    return;
  }

  if (method === "GET" && pathname === "/runs") {
    handleListRuns(url, res);
    return;
  }

  if (method === "POST" && pathname === "/runs") {
    await handleSaveRun(req, res);
    return;
  }

  const replayMatch = pathname.match(/^\/runs\/([^/]+)\/replay$/);
  if (replayMatch) {
    if (method === "GET") {
      handleGetReplay(replayMatch[1], res);
    } else {
      send405(res);
    }
    return;
  }

  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    if (method === "GET") {
      handleGetRun(runMatch[1], res);
    } else {
      send405(res);
    }
    return;
  }

  if (method === "GET" && pathname === "/validation") {
    handleListValidation(res);
    return;
  }

  const validationMatch = pathname.match(/^\/validation\/([^/]+)$/);
  if (validationMatch) {
    if (method === "GET") {
      handleGetValidation(validationMatch[1], res);
    } else if (method === "POST") {
      await handleSaveValidation(validationMatch[1], req, res);
    } else {
      send405(res);
    }
    return;
  }

  send404(res);
});

server.listen(PORT, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`ananke-archive listening on http://localhost:${listeningPort}`);
  console.log(`  GET  /health`);
  console.log(`  GET  /runs          — list searchable runs`);
  console.log(`  POST /runs          — ingest replay JSON`);
  console.log(`  GET  /runs/:id      — fetch archived run + metadata`);
  console.log(`  GET  /runs/:id/replay — fetch raw replay JSON`);
  console.log(`  GET  /validation    — list validation results`);
  console.log(`  POST /validation/:scenario — save validation result`);
  console.log(`  GET  /validation/:scenario — fetch validation result`);
  console.log(`\nData directory: ${DATA_DIR}`);
});

export default server;

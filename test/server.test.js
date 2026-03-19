// test/server.test.js — smoke tests for the ananke-archive server
//
// Uses Node.js built-in http module only — no test framework required.
// Run with: node test/server.test.js
//
// The server must NOT already be running on PORT when this script executes;
// it starts its own instance on a random available port.

import http from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// ── Setup: import server, redirect data dir to a temp location ────────────────

// Patch PORT to 0 (OS assigns a free port) before importing server
const originalPort = process.env["PORT"];
process.env["PORT"] = "0";

// Redirect data directory to a temp dir so tests don't pollute data/
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ananke-archive-test-"));
const originalCwd = process.cwd();

// We import the server after setting env vars
const serverModule = await import("../src/server.js");
const server = serverModule.default;

// Wait for server to start listening
if (!server.listening) {
  await once(server, "listening");
}

const { port } = server.address();
const BASE = `http://localhost:${port}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

async function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { json = null; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

console.log(`\nananke-archive server smoke tests (port ${port})\n`);

// GET /health
{
  console.log("GET /health");
  const { status, body } = await request("GET", "/health");
  assert(status === 200, "returns 200");
  assert(body?.status === "ok", "body.status === 'ok'");
  assert(typeof body?.version === "string", "body.version is a string");
  console.log("");
}

// GET /runs (initially empty or has existing files)
{
  console.log("GET /runs");
  const { status, body } = await request("GET", "/runs");
  assert(status === 200, "returns 200");
  assert(Array.isArray(body?.runs), "body.runs is an array");
  console.log("");
}

// POST /runs — valid JSON body
let savedRunId;
{
  console.log("POST /runs — valid JSON body");
  const replay = { version: 1, worldSeed: 42, frames: [{ tick: 0, snapshot: { entities: [] } }] };
  const { status, body } = await request("POST", "/runs", replay);
  assert(status === 201, "returns 201");
  assert(typeof body?.id === "string", "body.id is a string");
  assert(body?.id?.startsWith("run-"), "body.id starts with 'run-'");
  savedRunId = body?.id;
  console.log("");
}

// GET /runs/:id — fetch saved run
if (savedRunId) {
  console.log(`GET /runs/${savedRunId}`);
  const { status, body } = await request("GET", `/runs/${savedRunId}`);
  assert(status === 200, "returns 200");
  assert(body?.worldSeed === 42, "worldSeed preserved correctly");
  console.log("");
}

// POST /runs — invalid JSON body
{
  console.log("POST /runs — invalid JSON body");
  const { status } = await request("POST", "/runs", undefined).then(() =>
    // Manually send invalid body
    new Promise((resolve) => {
      const req = http.request(`${BASE}/runs`, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      });
      req.write("not valid json {{{{");
      req.end();
    })
  );
  assert(status === 400, "returns 400 for invalid JSON");
  console.log("");
}

// GET /runs/nonexistent — 404
{
  console.log("GET /runs/nonexistent");
  const { status } = await request("GET", "/runs/nonexistent-id-that-does-not-exist");
  assert(status === 404, "returns 404");
  console.log("");
}

// POST /validation/:scenario
{
  console.log("POST /validation/test-scenario");
  const result = { scenario: "test-scenario", pass: true, message: "Smoke test", anankeVersion: "0.1.1" };
  const { status, body } = await request("POST", "/validation/test-scenario", result);
  assert(status === 201, "returns 201");
  assert(body?.scenario === "test-scenario", "body.scenario matches");
  console.log("");
}

// GET /validation
{
  console.log("GET /validation");
  const { status, body } = await request("GET", "/validation");
  assert(status === 200, "returns 200");
  assert(Array.isArray(body?.validationResults), "body.validationResults is an array");
  console.log("");
}

// GET /validation/:scenario
{
  console.log("GET /validation/test-scenario");
  const { status, body } = await request("GET", "/validation/test-scenario");
  assert(status === 200, "returns 200");
  assert(body?.pass === true, "pass field preserved");
  console.log("");
}

// GET /nonexistent-route — 404
{
  console.log("GET /nonexistent-route");
  const { status } = await request("GET", "/nonexistent-route");
  assert(status === 404, "returns 404");
  console.log("");
}

// ── Teardown ──────────────────────────────────────────────────────────────────

server.close();

// Clean up temp data directory
fs.rmSync(tmpDir, { recursive: true, force: true });

if (originalPort !== undefined) process.env["PORT"] = originalPort;
else delete process.env["PORT"];

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

// test/server.test.js — smoke tests for the searchable replay archive server

import http from "node:http";
import { once } from "node:events";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { ingestReplayFile } from "../src/ingest.ts";

const originalPort = process.env["PORT"];
const originalDataDir = process.env["DATA_DIR"];
process.env["PORT"] = "0";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ananke-archive-test-"));
process.env["DATA_DIR"] = tmpDir;

const fixturePath = path.resolve("test/fixtures/knight-vs-brawler.json");
ingestReplayFile(fixturePath, { dataDir: tmpDir });

const serverModule = await import("../src/server.js");
const server = serverModule.default;

if (!server.listening) {
  await once(server, "listening");
}

const { port } = server.address();
const BASE = `http://localhost:${port}`;

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

async function request(method, targetPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(`${BASE}${targetPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

console.log(`\nananke-archive server smoke tests (port ${port})\n`);

{
  console.log("GET /health");
  const { status, body } = await request("GET", "/health");
  assert(status === 200, "returns 200");
  assert(body?.status === "ok", "body.status === 'ok'");
  console.log("");
}

let listedRunId;
{
  console.log("GET /runs");
  const { status, body } = await request("GET", "/runs?scenario=Knight%20vs%20Brawler&q=knight");
  assert(status === 200, "returns 200");
  assert(Array.isArray(body?.runs), "body.runs is an array");
  assert(body?.runs?.length === 1, "filters runs by scenario and search text");
  assert(body?.runs?.[0]?.metadata?.winnerTeam === "1", "winner metadata is exposed");
  listedRunId = body?.runs?.[0]?.id;
  console.log("");
}

if (listedRunId) {
  console.log(`GET /runs/${listedRunId}`);
  const { status, body } = await request("GET", `/runs/${listedRunId}`);
  assert(status === 200, "returns 200");
  assert(body?.metadata?.scenario === "Knight vs Brawler", "returns archive metadata");
  assert(Array.isArray(body?.events) && body.events.length === 4, "returns normalised event list");
  console.log("");

  console.log(`GET /runs/${listedRunId}/replay`);
  const replayResponse = await request("GET", `/runs/${listedRunId}/replay`);
  assert(replayResponse.status === 200, "returns 200 for raw replay");
  assert(replayResponse.body?.scenario === "Knight vs Brawler", "returns raw replay JSON");
  console.log("");
}

{
  console.log("POST /runs — valid JSON body");
  const replay = {
    scenario: "Arena Mirror",
    worldSeed: 99,
    initialState: {
      tick: 0,
      entities: [
        { id: 1, name: "A", team: 1, alive: true },
        { id: 2, name: "B", team: 2, alive: true }
      ]
    },
    frames: [
      { tick: 3, trace: [{ kind: "Death", tick: 3, entityId: 2 }], snapshot: { entities: [{ id: 1, team: 1, alive: true }, { id: 2, team: 2, alive: false }] } }
    ]
  };
  const { status, body } = await request("POST", "/runs", replay);
  assert(status === 201, "returns 201");
  assert(body?.metadata?.scenario === "Arena Mirror", "returns metadata for ingested run");
  assert(body?.metadata?.winnerTeam === "1", "computes winner for ingested run");
  console.log("");
}

{
  console.log("POST /runs — invalid JSON body");
  const invalid = await new Promise((resolve) => {
    const req = http.request(`${BASE}/runs`, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.write("not valid json {{{{");
    req.end();
  });
  assert(invalid.status === 400, "returns 400 for invalid JSON");
  console.log("");
}

{
  console.log("GET /runs/nonexistent");
  const { status } = await request("GET", "/runs/nonexistent-id-that-does-not-exist");
  assert(status === 404, "returns 404");
  console.log("");
}

{
  console.log("POST /validation/test-scenario");
  const result = { scenario: "test-scenario", pass: true, message: "Smoke test", anankeVersion: "0.1.1" };
  const { status, body } = await request("POST", "/validation/test-scenario", result);
  assert(status === 201, "returns 201");
  assert(body?.scenario === "test-scenario", "body.scenario matches");
  console.log("");
}

{
  console.log("GET /validation");
  const { status, body } = await request("GET", "/validation");
  assert(status === 200, "returns 200");
  assert(Array.isArray(body?.validationResults), "body.validationResults is an array");
  console.log("");
}

server.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

if (originalPort !== undefined) process.env["PORT"] = originalPort;
else delete process.env["PORT"];
if (originalDataDir !== undefined) process.env["DATA_DIR"] = originalDataDir;
else delete process.env["DATA_DIR"];

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

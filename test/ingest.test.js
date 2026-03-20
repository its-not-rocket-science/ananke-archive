import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ingestReplayFile, normalizeReplay } from "../src/ingest.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf-8"));
}

let passed = 0;
let failed = 0;

function run(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed += 1;
  } catch (error) {
    console.error(`  FAIL  ${label}`);
    console.error(error);
    failed += 1;
  }
}

console.log("\ningest pipeline round-trip tests\n");

run("normalises metadata for a combat fixture", () => {
  const fixture = loadFixture("knight-vs-brawler.json");
  const archive = normalizeReplay(fixture, { sourcePath: path.join(fixtureDir, "knight-vs-brawler.json") });

  assert.equal(archive.metadata.scenario, "Knight vs Brawler");
  assert.equal(archive.metadata.seed, 42);
  assert.equal(archive.metadata.tickCount, 2);
  assert.equal(archive.metadata.entityCount, 2);
  assert.equal(archive.metadata.casualtyCount, 1);
  assert.equal(archive.metadata.winnerTeam, "1");
  assert.deepEqual(archive.events.map((event) => event.type), ["move", "move", "death", "hit"]);
  assert.match(archive.metadata.searchableText, /knight/);
  assert.match(archive.metadata.searchableText, /brawler/);
});

run("persists an archived run and preserves the raw replay payload", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ananke-ingest-"));
  const fixturePath = path.join(fixtureDir, "pneumonic-plague.json");
  const archive = ingestReplayFile(fixturePath, { dataDir: tmpDir });
  const storedPath = path.join(tmpDir, "runs", `${archive.id}.json`);
  const stored = JSON.parse(fs.readFileSync(storedPath, "utf-8"));

  assert.equal(stored.metadata.scenario, "Pneumonic Plague");
  assert.equal(stored.metadata.tickCount, 8);
  assert.equal(stored.metadata.casualtyCount, 2);
  assert.equal(stored.metadata.winnerTeam, "village");
  assert.deepEqual(stored.replay, loadFixture("pneumonic-plague.json"));
  assert.equal(stored.events.length, 4);
});

run("bulk-ingest script ingests the whole fixture directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ananke-bulk-"));
  execFileSync(process.execPath, ["scripts/bulk-ingest.ts", "--dir", fixtureDir, "--data-dir", tmpDir], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  const storedFiles = fs.readdirSync(path.join(tmpDir, "runs")).filter((name) => name.endsWith(".json"));
  assert.equal(storedFiles.length, 2);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

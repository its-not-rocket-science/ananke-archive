import * as fs from "node:fs";
import * as path from "node:path";
import { ingestReplayFile, type ArchiveRun, type IngestOptions } from "../src/ingest.ts";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part) continue;
    if (!part.startsWith("--")) continue;
    const [rawKey, inlineValue] = part.slice(2).split("=", 2);
    if (!rawKey) continue;
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    if (next && !next.startsWith("--")) {
      parsed[rawKey] = next;
      index += 1;
      continue;
    }

    parsed[rawKey] = true;
  }

  return parsed;
}

function walkJsonFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function scenarioFromPath(filePath: string, rootDir: string): string {
  const relativePath = path.relative(rootDir, filePath);
  const parsed = path.parse(relativePath);
  const parent = parsed.dir.split(path.sep).filter(Boolean).pop();

  if (parent) {
    return parent
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return parsed.name.replace(/[-_]+/g, " ").trim();
}

function formatSummary(archive: ArchiveRun): string {
  const winner = archive.metadata.winnerTeam ?? "none";
  const seed = archive.metadata.seed ?? "unknown";
  return `${archive.metadata.scenario} | seed=${seed} | ticks=${archive.metadata.tickCount} | winner=${winner}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = typeof args.dir === "string" ? path.resolve(args.dir) : undefined;

  if (!dir) {
    console.error("Usage: node scripts/bulk-ingest.ts --dir path/to/zoo [--data-dir ./data] [--scenario-from-path]");
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Directory not found: ${dir}`);
    process.exitCode = 1;
    return;
  }

  const files = walkJsonFiles(dir);
  const dataDir = typeof args["data-dir"] === "string" ? args["data-dir"] : undefined;
  const deriveScenario = Boolean(args["scenario-from-path"] ?? true);

  if (files.length === 0) {
    console.log(`No JSON replay files found under ${dir}`);
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const filePath of files) {
    try {
      const options: IngestOptions = {};
      if (dataDir) options.dataDir = dataDir;
      if (deriveScenario) options.scenario = scenarioFromPath(filePath, dir);

      const archive = ingestReplayFile(filePath, options);
      successCount += 1;
      console.log(`INGESTED ${path.relative(dir, filePath)} -> ${archive.id.slice(0, 12)} :: ${formatSummary(archive)}`);
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAILED   ${path.relative(dir, filePath)} :: ${message}`);
    }
  }

  console.log(`\nBulk ingest complete. ${successCount} succeeded, ${failureCount} failed.`);
}

await main();

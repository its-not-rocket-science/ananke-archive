import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface IngestOptions {
  scenario?: string;
  seed?: number;
  dataDir?: string;
  sourcePath?: string;
  ingestedAt?: string;
}

export interface NormalizedEvent {
  tick: number;
  type: string;
  entityId: number | null;
  targetId: number | null;
  value: number | null;
  raw: unknown;
}

export interface RunMetadata {
  scenario: string;
  seed: number | null;
  entityCount: number;
  aliveCount: number;
  casualtyCount: number;
  casualtyRate: number | null;
  tickCount: number;
  winnerTeam: string | number | null;
  teamCount: number;
  eventCount: number;
  eventTypes: string[];
  searchableText: string;
  sourcePath: string | null;
}

export interface ArchiveRun {
  id: string;
  ingestedAt: string;
  metadata: RunMetadata;
  replay: Record<string, unknown>;
  events: NormalizedEvent[];
}

type JsonRecord = Record<string, unknown>;
type JsonArray = unknown[];
type EntityRecord = Record<string, unknown> & { id?: number; name?: string };

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function asArray(value: unknown): JsonArray {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function normalizeType(value: unknown): string {
  const text = toText(value) ?? "command";
  return text
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "command";
}

function collectTicks(replay: JsonRecord): number[] {
  const values: number[] = [];
  const initialState = asRecord(replay.initialState);
  const initialTick = toNumber(initialState?.tick);
  if (initialTick !== null) values.push(initialTick);

  for (const frame of asArray(replay.frames)) {
    const frameRecord = asRecord(frame);
    const tick = toNumber(frameRecord?.tick);
    if (tick !== null) values.push(tick);

    for (const ev of collectTraceEventsFromFrame(frameRecord)) {
      const evTick = toNumber(asRecord(ev)?.tick);
      if (evTick !== null) values.push(evTick);
    }
  }

  for (const ev of collectTopLevelTraceEvents(replay)) {
    const evTick = toNumber(asRecord(ev)?.tick);
    if (evTick !== null) values.push(evTick);
  }

  return values;
}

function collectTopLevelTraceEvents(replay: JsonRecord): JsonArray {
  for (const key of ["events", "trace", "timeline"]) {
    const candidate = replay[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function collectTraceEventsFromFrame(frame: JsonRecord | null): JsonArray {
  if (!frame) return [];
  for (const key of ["events", "trace", "timeline"]) {
    const candidate = frame[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractEntitiesFromRecord(source: JsonRecord | null): EntityRecord[] {
  if (!source) return [];
  const direct = source.entities;
  if (Array.isArray(direct)) return direct.filter((value): value is EntityRecord => asRecord(value) !== null).map((value) => value as EntityRecord);

  const nestedSnapshot = asRecord(source.snapshot);
  if (nestedSnapshot && Array.isArray(nestedSnapshot.entities)) {
    return nestedSnapshot.entities.filter((value): value is EntityRecord => asRecord(value) !== null).map((value) => value as EntityRecord);
  }

  return [];
}

function extractInitialEntities(replay: JsonRecord): EntityRecord[] {
  const initialState = asRecord(replay.initialState);
  const initialEntities = extractEntitiesFromRecord(initialState);
  if (initialEntities.length > 0) return initialEntities;

  for (const frame of asArray(replay.frames)) {
    const entities = extractEntitiesFromRecord(asRecord(frame));
    if (entities.length > 0) return entities;
  }

  return [];
}

function extractFinalEntities(replay: JsonRecord): EntityRecord[] {
  const frames = asArray(replay.frames);
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const entities = extractEntitiesFromRecord(asRecord(frames[index]));
    if (entities.length > 0) return entities;
  }

  const finalState = asRecord(replay.finalState);
  const finalEntities = extractEntitiesFromRecord(finalState);
  if (finalEntities.length > 0) return finalEntities;

  return extractInitialEntities(replay);
}

function inferTeam(entity: EntityRecord): string | number | null {
  for (const key of ["team", "teamId", "side", "factionId", "faction", "ownerTeam"]) {
    const value = entity[key];
    if (typeof value === "number" || typeof value === "string") return value;
  }
  return null;
}

function isEntityAlive(entity: EntityRecord): boolean {
  if (typeof entity.alive === "boolean") return entity.alive;
  const hp = toNumber(entity.hp ?? entity.health ?? entity.hitPoints);
  if (hp !== null) return hp > 0;
  const dead = entity.dead;
  if (typeof dead === "boolean") return !dead;
  return true;
}

function uniqueValues(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function inferSearchableTokens(replay: JsonRecord, metadataBase: Omit<RunMetadata, "searchableText">, entities: EntityRecord[]): string {
  const tokens = new Set<string>();

  const add = (value: unknown) => {
    const text = toText(value);
    if (text) tokens.add(text.toLowerCase());
  };

  add(metadataBase.scenario);
  add(metadataBase.seed);
  add(metadataBase.winnerTeam);
  for (const eventType of metadataBase.eventTypes) add(eventType);

  for (const entity of entities) {
    add(entity.name);
    add(entity.label);
    add(entity.archetype);
    add(entity.species);
    add(inferTeam(entity));
  }

  const replayMetadata = asRecord(replay.metadata);
  for (const key of ["scenario", "description", "notes", "label", "title"]) {
    add(replay[key]);
    add(replayMetadata?.[key]);
  }

  return [...tokens].sort((a, b) => a.localeCompare(b)).join(" ");
}

function normalizeTraceEvent(event: JsonRecord): NormalizedEvent {
  const type = normalizeType(event.kind ?? event.type ?? event.eventType ?? event.name);
  const value = [
    event.value,
    event.energy_J,
    event.shockQ,
    event.intensity,
    event.durationTicks,
    event.distance_m,
  ].map(toNumber).find((candidate) => candidate !== null) ?? null;

  return {
    tick: toNumber(event.tick) ?? 0,
    type,
    entityId: toNumber(event.entityId ?? event.attackerId ?? event.actorId ?? event.sourceId),
    targetId: toNumber(event.targetId ?? event.entityB ?? event.partnerId ?? event.victimId),
    value,
    raw: event,
  };
}

function normalizeCommandFrame(frame: JsonRecord): NormalizedEvent[] {
  const tick = toNumber(frame.tick) ?? 0;
  const commands = asArray(frame.commands);
  const events: NormalizedEvent[] = [];

  for (const entry of commands) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const entityId = toNumber(entry[0]);
    const commandList = asArray(entry[1]);

    for (const command of commandList) {
      const commandRecord = asRecord(command);
      if (!commandRecord) continue;
      events.push({
        tick,
        type: normalizeType(commandRecord.kind ?? commandRecord.type ?? commandRecord.action),
        entityId,
        targetId: toNumber(commandRecord.targetId ?? commandRecord.entityId ?? commandRecord.partnerId),
        value: [commandRecord.intensity, commandRecord.energy_J, commandRecord.distance_m].map(toNumber).find((candidate) => candidate !== null) ?? null,
        raw: commandRecord,
      });
    }
  }

  return events;
}

export function normalizeReplay(replayInput: string | JsonRecord, options: IngestOptions = {}): ArchiveRun {
  const replay = typeof replayInput === "string"
    ? JSON.parse(replayInput) as JsonRecord
    : structuredClone(replayInput) as JsonRecord;

  const frames = asArray(replay.frames);
  const traceEvents = collectTopLevelTraceEvents(replay)
    .map(asRecord)
    .filter((value): value is JsonRecord => value !== null)
    .map(normalizeTraceEvent);

  for (const frame of frames) {
    const frameRecord = asRecord(frame);
    if (!frameRecord) continue;

    const frameTrace = collectTraceEventsFromFrame(frameRecord)
      .map(asRecord)
      .filter((value): value is JsonRecord => value !== null)
      .map(normalizeTraceEvent);

    if (frameTrace.length > 0) {
      traceEvents.push(...frameTrace);
      continue;
    }

    traceEvents.push(...normalizeCommandFrame(frameRecord));
  }

  traceEvents.sort((left, right) => left.tick - right.tick || left.type.localeCompare(right.type));

  const initialEntities = extractInitialEntities(replay);
  const finalEntities = extractFinalEntities(replay);
  const entityCount = Math.max(initialEntities.length, finalEntities.length);
  const aliveCount = finalEntities.filter(isEntityAlive).length;
  const casualtyCount = entityCount === 0 ? 0 : Math.max(0, entityCount - aliveCount);
  const teamValues = uniqueValues(finalEntities.map(inferTeam).filter((value): value is string | number => value !== null).map(String));
  const aliveTeamValues = uniqueValues(finalEntities.filter(isEntityAlive).map(inferTeam).filter((value): value is string | number => value !== null).map(String));
  const winnerTeam = aliveTeamValues.length === 1 ? (aliveTeamValues[0] ?? null) : null;
  const tickCount = Math.max(0, ...collectTicks(replay));
  const eventTypes = uniqueValues(traceEvents.map((event) => event.type));

  const metadataBase: Omit<RunMetadata, "searchableText"> = {
    scenario: options.scenario
      ?? toText(replay.scenario)
      ?? toText(asRecord(replay.metadata)?.scenario)
      ?? toText(asRecord(replay.initialState)?.scenario)
      ?? (options.sourcePath ? path.basename(options.sourcePath, path.extname(options.sourcePath)) : "Unknown scenario"),
    seed: options.seed
      ?? toNumber(replay.seed)
      ?? toNumber(replay.worldSeed)
      ?? toNumber(asRecord(replay.metadata)?.seed)
      ?? toNumber(asRecord(replay.initialState)?.seed),
    entityCount,
    aliveCount,
    casualtyCount,
    casualtyRate: entityCount > 0 ? Number((casualtyCount / entityCount).toFixed(4)) : null,
    tickCount,
    winnerTeam,
    teamCount: teamValues.length,
    eventCount: traceEvents.length,
    eventTypes,
    sourcePath: options.sourcePath ?? null,
  };

  const metadata: RunMetadata = {
    ...metadataBase,
    searchableText: inferSearchableTokens(replay, metadataBase, initialEntities.length > 0 ? initialEntities : finalEntities),
  };

  const id = crypto.createHash("sha256")
    .update(JSON.stringify(replay))
    .digest("hex");

  return {
    id,
    ingestedAt: options.ingestedAt ?? new Date().toISOString(),
    metadata,
    replay,
    events: traceEvents,
  };
}

export function ensureArchiveDirs(dataDir: string): { dataDir: string; runsDir: string } {
  const resolved = path.resolve(dataDir);
  const runsDir = path.join(resolved, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  return { dataDir: resolved, runsDir };
}

export function ingestReplayObject(replayInput: string | JsonRecord, options: IngestOptions = {}): ArchiveRun {
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), "data");
  const archive = normalizeReplay(replayInput, options);
  const { runsDir } = ensureArchiveDirs(dataDir);
  const outputPath = path.join(runsDir, `${archive.id}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(archive, null, 2), "utf-8");
  return archive;
}

export function ingestReplayFile(filePath: string, options: IngestOptions = {}): ArchiveRun {
  const contents = fs.readFileSync(filePath, "utf-8");
  return ingestReplayObject(contents, { ...options, sourcePath: filePath });
}

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = typeof args.file === "string" ? args.file : undefined;
  if (!filePath) {
    console.error("Usage: node src/ingest.ts --file path/to/replay.json [--scenario name] [--seed 42] [--data-dir ./data]");
    process.exitCode = 1;
    return;
  }

  const options: IngestOptions = {};
  if (typeof args.scenario === "string") options.scenario = args.scenario;
  if (typeof args.seed === "string") options.seed = Number(args.seed);
  if (typeof args["data-dir"] === "string") options.dataDir = args["data-dir"];

  const archive = ingestReplayFile(filePath, options);

  console.log(JSON.stringify({
    id: archive.id,
    ingestedAt: archive.ingestedAt,
    metadata: archive.metadata,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

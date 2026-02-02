import fs from "node:fs/promises";
import path from "node:path";
import toml from "@iarna/toml";

export type ChannelProgramSource = {
  type: "path" | "url";
  value: string;
};

export type ChannelProgram = {
  title: string;
  subtitle?: string;
  tag?: string;
  duration_slots?: number;
  source?: ChannelProgramSource;
};

export type ChannelManifest = {
  id: string;
  number: string;
  name: string;
  call_sign: string;
  accent?: string;
  description?: string;
  audio_source?: ChannelProgramSource;
  audio_volume?: number;
  audio_offset_min_sec?: number;
  audio_offset_max_sec?: number;
  programs: ChannelProgram[];
};

export type ChibaConfig = {
  server?: {
    host?: string;
    port?: number;
  };
  library: {
    roots: string[];
  };
  index?: {
    scan_interval_sec?: number;
    full_scan_on_start?: boolean;
  };
  channels: {
    manifest_dir: string;
    slot_minutes: number;
    slot_count: number;
    start_time: string;
  };
};

export type LoadedConfig = {
  config: ChibaConfig;
  configPath: string;
  manifestDir: string;
  libraryRoots: string[];
  channels: ChannelManifest[];
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolvePath(baseDir: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.resolve(baseDir, target);
}

function normalizePrograms(programs: ChannelProgram[] | undefined): ChannelProgram[] {
  return ensureArray(programs ?? []).map((program) => ({
    ...program,
    duration_slots:
      typeof program.duration_slots === "number" && program.duration_slots > 0
        ? program.duration_slots
        : 1,
  }));
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

async function loadChannelManifest(filePath: string): Promise<ChannelManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as Partial<ChannelManifest> & {
    program?: ChannelProgram[] | ChannelProgram;
  };

  const programs = normalizePrograms(
    (parsed.programs ?? parsed.program) as ChannelProgram[] | undefined
  );

  return {
    id: parsed.id ?? path.basename(filePath, path.extname(filePath)),
    number: parsed.number ?? "",
    name: parsed.name ?? parsed.id ?? "Channel",
    call_sign: parsed.call_sign ?? "",
    accent: parsed.accent,
    description: parsed.description,
    audio_source: parsed.audio_source,
    audio_volume: normalizeNumber(parsed.audio_volume),
    audio_offset_min_sec: normalizeNumber(parsed.audio_offset_min_sec),
    audio_offset_max_sec: normalizeNumber(parsed.audio_offset_max_sec),
    programs,
  };
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const configRaw = await fs.readFile(configPath, "utf-8");
  const parsed = toml.parse(configRaw) as ChibaConfig;
  if (!parsed.library || !parsed.channels) {
    throw new Error("Config missing [library] or [channels] sections.");
  }
  const baseDir = path.dirname(configPath);
  const manifestDir = resolvePath(baseDir, parsed.channels.manifest_dir);

  const rootCandidates = ensureArray(parsed.library.roots).filter(isString);
  const libraryRoots = rootCandidates.map((root) => resolvePath(baseDir, root));

  let channelFiles: string[] = [];
  try {
    channelFiles = (await fs.readdir(manifestDir))
      .filter((file) => file.endsWith(".toml"))
      .map((file) => path.join(manifestDir, file));
  } catch {
    channelFiles = [];
  }

  const channels = await Promise.all(
    channelFiles.map((file) => loadChannelManifest(file))
  );

  return {
    config: parsed,
    configPath,
    manifestDir,
    libraryRoots,
    channels,
  };
}

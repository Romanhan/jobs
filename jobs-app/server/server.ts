import { resolve } from "node:path";
import { APP_VERSION } from "./web/js/version.js";
import { releaseDataLock } from "./data-lock.ts";

const DEFAULT_PORT = 8085;
const MAX_SAVE_RETRIES = 8;
const SAVE_RETRY_BASE_DELAY_MS = 50;
const LOCK_RETRY_DELAY_MS = 100;
const LOCK_MAX_WAIT_MS = 15000;
const LOCK_STALE_MS = 120000;
const BACKUP_INTERVAL_MS = 48 * 60 * 60 * 1000;
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_RETENTION_COUNT = 36;

let DATA_FILE = "jobs_data.json";
const args = Deno.args;
let PORT = DEFAULT_PORT;
let lastBackupCheck = 0;

type Job = Record<string, unknown>;
type MergeConflict = {
  jobId: string;
  field: string;
  baseValue: unknown;
  currentValue: unknown;
  userValue: unknown;
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data" && i + 1 < args.length) DATA_FILE = args[i + 1];
  if (args[i] === "--port" && i + 1 < args.length) {
    const portStr = args[i + 1];
    const parsed = Number(portStr);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 && String(parsed) === portStr) {
      PORT = parsed;
    } else {
      logError(`Invalid port number "${portStr}" (must be 0-65535)`);
      Deno.exit(1);
    }
  }
}

const INSTANCE_PROTOCOL = 1;
const absoluteDataPath = resolve(DATA_FILE);
const instanceDataPath = Deno.build.os === "windows" ? absoluteDataPath.toLowerCase() : absoluteDataPath;
const instanceUser = Deno.build.os === "windows"
  ? `${Deno.env.get("USERDOMAIN") || ""}\\${Deno.env.get("USERNAME") || ""}`
  : Deno.env.get("USER") || "";
const instanceKey = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(JSON.stringify([instanceDataPath, instanceUser])))))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");
let launchReservedUntil = 0;

let lastActivity: number = Date.now();
let activeTabs = new Map<string, number>();
let exitTimeout: ReturnType<typeof setTimeout> | undefined;
const abortController = new AbortController();

const TAB_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_SHUTDOWN_MS = 30 * 60 * 1000;

function scheduleExit() {
  if (exitTimeout !== undefined) {
    clearTimeout(exitTimeout);
  }
  exitTimeout = setTimeout(() => {
    exitTimeout = undefined;
    if (activeTabs.size === 0) {
      logEvent("Server exiting: no active tabs remain");
      abortController.abort();
    }
  }, Math.max(5000, launchReservedUntil - Date.now()));
}

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_SHUTDOWN_MS) {
    logEvent(`Server exiting: idle for ${Math.round((Date.now() - lastActivity) / 60000)} minutes`);
    abortController.abort();
  }
}, 60000);

setInterval(() => {
  const now = Date.now();
  const expired: [string, number][] = [];
  for (const [tabId, lastSeen] of activeTabs.entries()) {
    if (now - lastSeen > TAB_IDLE_TIMEOUT_MS) {
      expired.push([tabId, now - lastSeen]);
    }
  }
  for (const [tabId, idleMs] of expired) {
    activeTabs.delete(tabId);
    logEvent(`Tab expired: tab=${tabId} idleMs=${idleMs} remaining=${activeTabs.size}`);
  }
  if (expired.length && activeTabs.size === 0) {
    scheduleExit();
  }
}, 5000);

try {
  Deno.addSignalListener("SIGINT", () => {
    abortController.abort();
  });
} catch {}
try {
  Deno.addSignalListener("SIGTERM", () => {
    abortController.abort();
  });
} catch {}

const diagnosticHost = Deno.hostname();

// A compiled executable keeps its log next to itself, so it can be found
// without knowing which directory a shortcut starts in. Development runs
// (`deno run`, tests) keep using the working directory.
function logDirectory(): string {
  try {
    const executable = Deno.execPath();
    const name = executable.split(/[\\/]/).pop() || "";
    if (!/^deno(?:\.exe)?$/i.test(name)) {
      const dir = executable.slice(0, executable.length - name.length).replace(/[\\/]+$/, "");
      if (dir) return dir;
    }
  } catch { /* fall through to the working directory */ }
  return ".";
}

const LOG_FILE = Deno.env.get("JOBS_LOG_FILE") || joinPath(logDirectory(), "error.log");
const LOG_MAX_BYTES = 1024 * 1024;

function rotateLog(path: string): void {
  try {
    if (Deno.statSync(path).size < LOG_MAX_BYTES) return;
    const backup = `${path}.1`;
    try {
      Deno.removeSync(backup);
    } catch { /* first rotation */ }
    Deno.renameSync(path, backup);
  } catch { /* missing file or read-only log directory */ }
}

function writeLogLine(line: string): void {
  // Prefer the configured location; fall back to the working directory so a
  // read-only installation still records something.
  for (const file of new Set([LOG_FILE, "error.log"])) {
    try {
      rotateLog(file);
      Deno.writeTextFileSync(file, line, { append: true });
      return;
    } catch { /* try the next candidate */ }
  }
}

function logPrefix(): string {
  return `[${new Date().toISOString()}] [host=${diagnosticHost} pid=${Deno.pid} version=${APP_VERSION}]`;
}

function logError(msg: string) {
  console.error(msg);
  writeLogLine(`${logPrefix()} ${msg}\n`);
}

function logEvent(msg: string) {
  console.log(msg);
  writeLogLine(`${logPrefix()} ${msg}\n`);
}

// Polling runs every couple of seconds per tab, so an unreachable share would
// otherwise fill the log. Repeat a failing condition at most every 30s.
const throttledAt = new Map<string, number>();
function logThrottled(key: string, msg: string, intervalMs = 30000): void {
  const now = Date.now();
  if (now - (throttledAt.get(key) || 0) < intervalMs) return;
  throttledAt.set(key, now);
  logError(msg);
}

function lockPath(): string {
  return `${DATA_FILE}.lock`;
}

function revisionPath(): string {
  return `${DATA_FILE}.version`;
}

function dataDirectory(): string {
  const slash = Math.max(DATA_FILE.lastIndexOf("/"), DATA_FILE.lastIndexOf("\\"));
  if (slash < 0) return ".";
  const dir = DATA_FILE.substring(0, slash);
  if (dir === "") return DATA_FILE.startsWith("/") ? "/" : "\\";
  return dir.endsWith(":") ? `${dir}/` : dir;
}

function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? `${dir}${name}` : `${dir}${separator}${name}`;
}

function backupTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

async function readRevision(): Promise<string> {
  const stat = await Deno.stat(DATA_FILE);
  try {
    const revision = (await Deno.readTextFile(revisionPath())).trim();
    if (revision) return `${revision}-${stat.mtime?.getTime() || 0}-${stat.size}`;
  } catch {}
  return `legacy-${stat.mtime?.getTime() || 0}-${stat.size}`;
}

async function writeRevision(stat: Deno.FileInfo): Promise<string> {
  const revision = crypto.randomUUID();
  await Deno.writeTextFile(revisionPath(), revision);
  return `${revision}-${stat.mtime?.getTime() || 0}-${stat.size}`;
}

const heldDataLocks = new Map<string, { operation: string; acquired: number }>();

async function acquireDataLock(operation: string): Promise<() => Promise<void>> {
  const path = lockPath();
  const started = Date.now();
  let lastFailure = "none";
  let observedAge: number | null = null;
  let observedOwner = "unavailable";
  while (Date.now() - started < LOCK_MAX_WAIT_MS) {
    try {
      await Deno.mkdir(path);
      const token = crypto.randomUUID();
      const acquired = Date.now();
      heldDataLocks.set(token, { operation, acquired });
      const slowLockTimer = setTimeout(() => {
        logError(`Shared data lock held for ${Date.now() - acquired}ms: operation=${operation} path="${path}" token=${token}`);
      }, LOCK_MAX_WAIT_MS);
      try {
        await Deno.writeTextFile(`${path}/owner.json`, JSON.stringify({
          pid: Deno.pid,
          host: diagnosticHost,
          version: APP_VERSION,
          operation,
          token,
          created: acquired,
        }));
      } catch (error) {
        logError(`Shared data lock owner metadata write failed: operation=${operation} path="${path}": ${error}`);
      }
      return async () => {
        try {
          await releaseDataLock(path);
        } catch (error) {
          logError(`Shared data lock release failed for "${path}" after retries: operation=${operation} token=${token}: ${error}`);
        } finally {
          clearTimeout(slowLockTimer);
          heldDataLocks.delete(token);
          if (Date.now() - acquired >= LOCK_MAX_WAIT_MS) {
            logError(`Shared data lock operation finished after ${Date.now() - acquired}ms: operation=${operation} token=${token}`);
          }
        }
      };
    } catch (e) {
      lastFailure = `mkdir: ${e}`;
      // Network shares can briefly report ACCESS_DENIED while another client
      // is creating/removing the lock directory. Treat that like contention
      // and retry instead of failing the save immediately.
      if (e instanceof Deno.errors.PermissionDenied) {
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        continue;
      }
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      try {
        const stat = await Deno.stat(path);
        const age = Date.now() - (stat.mtime?.getTime() || Date.now());
        observedAge = age;
        if (observedOwner === "unavailable") {
          try {
            observedOwner = (await Deno.readTextFile(`${path}/owner.json`)).slice(0, 2048);
          } catch (error) {
            observedOwner = `unreadable: ${error}`;
          }
        }
        if (age > LOCK_STALE_MS) {
          logEvent(`Shared data lock reclaimed as stale after ${age}ms: path="${path}" owner=${observedOwner}`);
          await Deno.remove(path, { recursive: true });
          continue;
        }
      } catch (statError) {
        lastFailure = `inspect/remove stale lock: ${statError}`;
        if (statError instanceof Deno.errors.PermissionDenied) {
          await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
          continue;
        }
        if (!(statError instanceof Deno.errors.NotFound)) throw statError;
        // The lock disappeared between mkdir and stat; retry immediately.
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }
  const localHolders = [...heldDataLocks.values()].map(holder => ({
    operation: holder.operation, heldMs: Date.now() - holder.acquired,
  }));
  throw new Error(`Timed out waiting for shared data lock "${path}"; operation=${operation}; waitedMs=${Date.now() - started}; observedAgeMs=${observedAge}; lastFailure=${lastFailure}; observedOwner=${observedOwner}; localHolders=${JSON.stringify(localHolders)}`);
}

function ensureJobIds(jobs: Job[]): boolean {
  let changed = false;
  const used = new Set<string>();
  for (const job of jobs) {
    let id = typeof job._id === "string" ? job._id : "";
    if (!id || used.has(id)) {
      id = crypto.randomUUID();
      job._id = id;
      changed = true;
    }
    used.add(id);
  }
  return changed;
}

async function readJobsFile(): Promise<Job[]> {
  const content = await Deno.readTextFile(DATA_FILE);
  const jobs = JSON.parse(content);
  if (!Array.isArray(jobs)) throw new Error("Data file does not contain an array");
  return jobs;
}

async function writeJobsFile(jobs: Job[]): Promise<{ modified: number; revision: string }> {
  let dir = DATA_FILE.includes("/") || DATA_FILE.includes("\\") ? DATA_FILE.replace(/[\/\\][^\/\\]+$/, "") : ".";
  if (dir === "") dir = DATA_FILE.startsWith("/") ? "/" : "\\";
  if (dir.endsWith(":")) dir += "/";
  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
    let tempFile: string | undefined;
    try {
      tempFile = await Deno.makeTempFile({ dir, prefix: "jobs_data_temp", suffix: ".tmp" });
      await Deno.writeTextFile(tempFile, JSON.stringify(jobs));
      await Deno.rename(tempFile, DATA_FILE);
      const stat = await Deno.stat(DATA_FILE);
      const revision = await writeRevision(stat);
      return { modified: stat.mtime?.getTime() || Date.now(), revision };
    } catch (e) {
      if (tempFile) try { await Deno.remove(tempFile); } catch {}
      if (attempt === MAX_SAVE_RETRIES - 1) throw e;
      await new Promise(resolve => setTimeout(resolve, SAVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }
  throw new Error("Save failed");
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
}

async function isValidBackup(path: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(path));
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

async function maybeCreateBackup(forceCheck = false): Promise<void> {
  const now = Date.now();
  if (!forceCheck && now - lastBackupCheck < BACKUP_CHECK_INTERVAL_MS) return;
  lastBackupCheck = now;
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireDataLock("backup");
    const backupDir = joinPath(dataDirectory(), "backups");
    await Deno.mkdir(backupDir, { recursive: true });
    const backups: { name: string; path: string; modified: number }[] = [];
    for await (const entry of Deno.readDir(backupDir)) {
      if (!entry.isFile || !/^jobs_data_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
      const path = joinPath(backupDir, entry.name);
      try {
        const stat = await Deno.stat(path);
        backups.push({ name: entry.name, path, modified: stat.mtime?.getTime() || 0 });
      } catch {}
    }
    backups.sort((a, b) => b.modified - a.modified);
    let newestValidBackup: { name: string; path: string; modified: number } | undefined;
    for (const backup of backups) {
      if (await isValidBackup(backup.path)) {
        newestValidBackup = backup;
        break;
      }
    }
    if (newestValidBackup && now - newestValidBackup.modified < BACKUP_INTERVAL_MS) return;

    const jobs = await readJobsFile();
    const backupName = `jobs_data_${backupTimestamp()}.json`;
    const finalPath = joinPath(backupDir, backupName);
    const tempPath = `${finalPath}.tmp-${crypto.randomUUID()}`;
    try {
      await Deno.writeTextFile(tempPath, JSON.stringify(jobs));
      if (!await isValidBackup(tempPath)) throw new Error("Backup validation failed");
      await Deno.rename(tempPath, finalPath);
    } catch (e) {
      try { await Deno.remove(tempPath); } catch {}
      throw e;
    }

    backups.unshift({ name: backupName, path: finalPath, modified: now });
    const validBackups: { name: string; path: string; modified: number }[] = [];
    for (const backup of backups) {
      if (await isValidBackup(backup.path)) validBackups.push(backup);
    }
    if (validBackups.length > BACKUP_RETENTION_COUNT) {
      for (const backup of validBackups.slice(BACKUP_RETENTION_COUNT)) {
        try { await Deno.remove(backup.path); } catch (e) { logError(`Old backup cleanup failed for "${backup.path}": ${e}`); }
      }
    }
  } catch (e) {
    logError(`Automatic backup failed: ${e}`);
  } finally {
    if (releaseLock) await releaseLock();
  }
}

function isLocalConnection(urlStr: string | null): boolean {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

// Initialization happens inside the first data request, never before serving UI.
let dataInitialized = false;
let startupBackupScheduled = false;

async function handleGetData(corsHeaders: Record<string, string>): Promise<Response> {
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    if (!dataInitialized) await Deno.mkdir(dataDirectory(), { recursive: true });
    releaseLock = await acquireDataLock("load");
    let content: string;
    try {
      content = await Deno.readTextFile(DATA_FILE);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound) || dataInitialized) throw e;
      await Deno.writeTextFile(DATA_FILE, "[]");
      content = "[]";
    }
    if (!dataInitialized && !content.trim()) {
      await Deno.writeTextFile(DATA_FILE, "[]");
      content = "[]";
    }
    dataInitialized = true;
    const stat = await Deno.stat(DATA_FILE);
    let jobs;
    try {
      jobs = JSON.parse(content);
      if (!Array.isArray(jobs)) throw new Error("Expected an array");
    } catch {
      return new Response("Invalid JSON in data file", { status: 500, headers: corsHeaders });
    }
    let modified = stat.mtime?.getTime() || Date.now();
    let revision: string;
    if (ensureJobIds(jobs)) {
      const saved = await writeJobsFile(jobs);
      modified = saved.modified;
      revision = saved.revision;
    } else {
      revision = await readRevision();
    }
    return Response.json({
      modified,
      revision,
      jobs,
    }, { headers: corsHeaders });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      logThrottled("load-missing", `Data load failed: shared data file is unavailable: "${DATA_FILE}": ${e}`);
      return new Response("Shared data file is unavailable", { status: 503, headers: corsHeaders });
    }
    logThrottled("load-error", `Data load failed: "${DATA_FILE}": ${e}`);
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
  } finally {
    if (releaseLock) await releaseLock();
  }
}

async function handleMergeData(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  let payload: { base?: Job[]; proposed?: Job[] };
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }
  const validSnapshot = (items: unknown): items is Job[] => {
    if (!Array.isArray(items)) return false;
    const ids = new Set<string>();
    return items.every(job => {
      if (!job || typeof job !== "object" || Array.isArray(job) ||
          typeof job._id !== "string" || !job._id ||
          typeof job["Töö Nr"] !== "string" || ids.has(job._id)) return false;
      ids.add(job._id);
      return true;
    });
  };
  if (!payload || !validSnapshot(payload.base) || !validSnapshot(payload.proposed)) {
    return new Response("Invalid merge data", { status: 400, headers: corsHeaders });
  }

  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireDataLock("merge");
    const latest = await readJobsFile();
    ensureJobIds(latest);
    const baseById = new Map(payload.base.map(job => [String(job._id || ""), job]));
    const proposedById = new Map(payload.proposed.map(job => [String(job._id || ""), job]));
    const latestById = new Map(latest.map(job => [String(job._id || ""), job]));
    const conflicts: MergeConflict[] = [];

    for (const [id, proposed] of proposedById) {
      if (!id) continue;
      const base = baseById.get(id);
      const current = latestById.get(id);
      if (!base) {
        if (!current) {
          latest.push(structuredClone(proposed));
          latestById.set(id, latest[latest.length - 1]);
        } else if (!valuesEqual(current, proposed)) {
          conflicts.push({ jobId: id, field: "_job", baseValue: null, currentValue: current, userValue: proposed });
        }
        continue;
      }
      if (!current) {
        if (!valuesEqual(base, proposed)) {
          conflicts.push({ jobId: id, field: "_deleted", baseValue: base, currentValue: null, userValue: proposed });
        }
        continue;
      }
      const fields = new Set([...Object.keys(base), ...Object.keys(proposed)]);
      fields.delete("_id");
      for (const field of fields) {
        const baseValue = base[field] ?? "";
        const userValue = proposed[field] ?? "";
        if (valuesEqual(baseValue, userValue)) continue;
        const currentValue = current[field] ?? "";
        if (valuesEqual(currentValue, baseValue) || valuesEqual(currentValue, userValue)) {
          current[field] = userValue;
        } else {
          conflicts.push({ jobId: id, field, baseValue, currentValue, userValue });
        }
      }
    }

    for (const [id, base] of baseById) {
      if (!id || proposedById.has(id)) continue;
      const current = latestById.get(id);
      if (!current) continue;
      if (valuesEqual(current, base)) {
        const index = latest.indexOf(current);
        if (index >= 0) latest.splice(index, 1);
      } else {
        conflicts.push({ jobId: id, field: "_deleted", baseValue: base, currentValue: current, userValue: null });
      }
    }

    const saved = await writeJobsFile(latest);
    return Response.json({ status: conflicts.length ? "conflict" : "saved", conflicts, jobs: latest, modified: saved.modified, revision: saved.revision }, { headers: corsHeaders });
  } catch (e) {
    logError(`Merge save failed: ${e}`);
    return Response.json({ status: "error", message: "Shared data file is unavailable" }, { status: 503, headers: corsHeaders });
  } finally {
    if (releaseLock) await releaseLock();
  }
}

async function handlePostData(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const contentLength = req.headers.get("content-length");
  if (!contentLength) {
    return new Response("Length Required", { status: 411, headers: corsHeaders });
  }
  const size = parseInt(contentLength, 10);
  if (isNaN(size) || size > 5 * 1024 * 1024) {
    return new Response("Payload too large", { status: 413, headers: corsHeaders });
  }
  const body = await req.bytes();
  let jobs: unknown;
  try {
    jobs = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }
  if (!Array.isArray(jobs) || !jobs.every(j => j && typeof j === 'object' && typeof (j as Record<string, unknown>)['Töö Nr'] === 'string')) {
    return new Response("Invalid job data", { status: 400, headers: corsHeaders });
  }

  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
    let tempFile: string | undefined;
    try {
      let dir = DATA_FILE.includes("/") || DATA_FILE.includes("\\") ? DATA_FILE.replace(/[\/\\][^\/\\]+$/, "") : ".";
      if (dir === "") dir = DATA_FILE.startsWith("/") ? "/" : "\\";
      if (dir.endsWith(":")) dir += "/";
      tempFile = await Deno.makeTempFile({ dir, prefix: "jobs_data_temp", suffix: ".tmp" });
      await Deno.writeTextFile(tempFile, JSON.stringify(jobs));
      await Deno.rename(tempFile, DATA_FILE);
      break;
    } catch (e) {
      if (tempFile) {
        try { await Deno.remove(tempFile); } catch {}
      }
      if (attempt === MAX_SAVE_RETRIES - 1) {
        logError(`Save failed after ${MAX_SAVE_RETRIES} retries: ${e}`);
        return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
      }
      const delay = SAVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  const stat = await Deno.stat(DATA_FILE);
  return Response.json({
    modified: stat.mtime?.getTime() || Date.now(),
  }, { headers: corsHeaders });
}

async function handlePoll(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
  const tabId = url.searchParams.get("tabId");
  if (tabId) {
    if (!activeTabs.has(tabId)) {
      logEvent(`Tab connected: tab=${tabId} active=${activeTabs.size + 1}`);
    }
    activeTabs.set(tabId, Date.now());
    if (exitTimeout !== undefined) {
      clearTimeout(exitTimeout);
      exitTimeout = undefined;
    }
  }

  const since = parseInt(url.searchParams.get("since") || "0", 10);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(DATA_FILE);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      logThrottled("poll-missing", `Poll failed: shared data file is unavailable: "${DATA_FILE}": ${e}`);
      return new Response("Shared data file is unavailable", { status: 503, headers: corsHeaders });
    }
    logThrottled("poll-stat", `Poll failed: cannot stat "${DATA_FILE}": ${e}`);
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
  }
  const mtime = stat.mtime?.getTime() || 0;
  const clientRevision = url.searchParams.get("revision");
  const revision = await readRevision();
  if ((clientRevision && clientRevision !== revision) || (!clientRevision && mtime > since)) {
    let content;
    try {
      content = await Deno.readTextFile(DATA_FILE);
    } catch (e) {
      logThrottled("poll-read", `Poll failed: cannot read "${DATA_FILE}": ${e}`);
      return new Response("Failed to read data file", { status: 500, headers: corsHeaders });
    }
    let jobs;
    try {
      jobs = JSON.parse(content);
    } catch (e) {
      logThrottled("poll-json", `Poll failed: invalid JSON in "${DATA_FILE}": ${e}`);
      return new Response("Invalid JSON in data file", { status: 500, headers: corsHeaders });
    }
    return Response.json({ changed: true, jobs, modified: mtime, revision }, { headers: corsHeaders });
  }
  return Response.json({ changed: false }, { headers: corsHeaders });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function serveStatic(url: URL): Promise<Response> {
  let path = url.pathname;
  if (path === "/") path = "/index.html";

  try {
    path = decodeURIComponent(path);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Use import.meta.url base - works for both --include (embedded) and dev (filesystem)
  const baseUrl = new URL("web/", import.meta.url);
  const resolved = new URL(path.replace(/\\/g, "/").replace(/^\//, ""), baseUrl);
  const resolvedPath = resolved.pathname;

  if (!resolvedPath.startsWith(baseUrl.pathname)) {
    return new Response("Forbidden", { status: 403 });
  }

  const dot = resolvedPath.lastIndexOf(".");
  const ext = dot >= 0 ? resolvedPath.substring(dot) : "";
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = await Deno.readFile(resolved);
    return new Response(content, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

async function handler(req: Request): Promise<Response> {
  lastActivity = Date.now();

  if (exitTimeout !== undefined) {
    scheduleExit();
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // Local-only check for all API endpoints
  if (path.startsWith("/api/")) {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    if ((origin && !isLocalConnection(origin)) || (referer && !isLocalConnection(referer))) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (path === "/api/launch" && req.method === "POST") {
      if (req.headers.get("X-Jobs-Launch") !== String(INSTANCE_PROTOCOL)) {
        return new Response("Invalid launch protocol", { status: 400 });
      }
      const launch = await req.json();
      if (launch?.app !== "jobs-app" || launch.protocol !== INSTANCE_PROTOCOL ||
          typeof launch.nonce !== "string") return new Response("Invalid launch request", { status: 400 });
      if (launch.version !== APP_VERSION || launch.key !== instanceKey) {
        return Response.json({ app: "jobs-app", conflict: true, nonce: launch.nonce }, { status: 409 });
      }
      if (abortController.signal.aborted) return new Response("Shutting down", { status: 503 });
      // Reserve time for the new browser tab to load and register, even on a slow drive.
      launchReservedUntil = Date.now() + 30000;
      if (activeTabs.size === 0) scheduleExit();
      // The long-lived server owns the browser launcher. A second EXE exits
      // immediately after this handoff and must not own the Windows child process.
      if (launch.openBrowser === true) void openBrowser(`http://localhost:${url.port}`);
      return Response.json({ app: "jobs-app", protocol: INSTANCE_PROTOCOL, nonce: launch.nonce,
        browserLaunch: launch.openBrowser === true ? "server" : "disabled" });
    }
    if (path === "/api/data") {
      if (req.method === "GET") return await handleGetData(CORS);
      if (req.method === "POST") return await handlePostData(req, CORS);
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (path === "/api/merge" && req.method === "POST") {
      const response = await handleMergeData(req, CORS);
      if (response.ok) void maybeCreateBackup();
      return response;
    }
    if (path === "/api/poll" && req.method === "GET") {
      return await handlePoll(url, CORS);
    }
    if (path === "/api/client-log" && req.method === "POST") {
      let payload: { tabId?: string; kind?: string; message?: string; online?: boolean; visibility?: string };
      try {
        payload = await req.json();
      } catch {
        return new Response("Bad Request", { status: 400, headers: CORS });
      }
      const clean = (value: unknown, max: number) =>
        typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, max) : "";
      const detail = [
        `kind=${clean(payload.kind, 40) || "unknown"}`,
        `tab=${clean(payload.tabId, 60) || "-"}`,
        `online=${payload.online === true}`,
        `visibility=${clean(payload.visibility, 20) || "-"}`,
        `message=${clean(payload.message, 500) || "-"}`,
      ].join(" ");
      logThrottled(`client:${clean(payload.kind, 40) || "unknown"}`, `Client reported: ${detail}`, 10000);
      return new Response("ok", { headers: CORS });
    }
    if (path === "/api/ready" && req.method === "POST") {
      if (dataInitialized && !startupBackupScheduled) {
        startupBackupScheduled = true;
        setTimeout(() => void maybeCreateBackup(), 2000);
      }
      return new Response("ok");
    }
    if (path === "/api/enter" && req.method === "POST") {
      const tabId = url.searchParams.get("tabId");
      if (tabId) {
        activeTabs.set(tabId, Date.now());
        launchReservedUntil = 0;
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
          exitTimeout = undefined;
        }
      }
      return new Response("ok");
    }
    if (path === "/api/exit" && req.method === "POST") {
      const tabId = url.searchParams.get("tabId");
      if (tabId && activeTabs.delete(tabId)) {
        if (activeTabs.size === 0) {
          scheduleExit();
        }
      }
      return new Response("ok");
    }
    return await serveStatic(url);
  } catch (e) {
    logError(`Handler error: ${e}`);
    return new Response("Internal Server Error", { status: 500 });
  }
}

async function openBrowser(url: string): Promise<void> {
  const command = Deno.build.os === "windows" ? ["cmd.exe", "/c", "start", "", url]
    : Deno.build.os === "darwin" ? ["open", url] : ["xdg-open", url];
  try {
    const result = await new Deno.Command(command[0], {
      args: command.slice(1), stdin: "null", stdout: "null", stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(`Launcher exited with code ${result.code}: ${new TextDecoder().decode(result.stderr).trim()}`);
    }
  } catch (e) {
    logError(`Browser open failed: ${e}`);
  }
}

async function reportStartupError(message: string) {
  logError(message);
  // The Windows executable has no console: make a real conflict visible there.
  if (Deno.build.os === "windows" && !args.includes("--no-browser")) {
    try {
      const literal = message.replaceAll("'", "''");
      await new Deno.Command("powershell.exe", { args: ["-NoProfile", "-NonInteractive", "-Command",
        `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${literal}', 'Jobs app') | Out-Null`],
        stdin: "null", stdout: "null", stderr: "null" }).output();
    } catch { /* error.log remains available if workplace policy blocks PowerShell */ }
  }
}

async function reuseInstance(): Promise<"reused" | "retry" | "conflict"> {
  const nonce = crypto.randomUUID();
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/launch`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(1000),
      headers: { "Content-Type": "application/json", "X-Jobs-Launch": String(INSTANCE_PROTOCOL) },
      body: JSON.stringify({ app: "jobs-app", protocol: INSTANCE_PROTOCOL, version: APP_VERSION, key: instanceKey, nonce, openBrowser: !args.includes("--no-browser") }),
    });
    if (response.status === 503) { await response.body?.cancel(); return "retry"; }
    const result = await response.json();
    if (result?.app !== "jobs-app" || result.nonce !== nonce) return "conflict";
    if (response.status === 409 && result.conflict === true) return "conflict";
    return response.ok && result.protocol === INSTANCE_PROTOCOL &&
      (args.includes("--no-browser") || result.browserLaunch === "server") ? "reused" : "conflict";
  } catch {
    // The old instance may have exited between the bind attempt and this request.
    return "retry";
  }
}

async function startServer() {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const server = Deno.serve({
        port: PORT, hostname: "127.0.0.1", signal: abortController.signal,
        onListen({ port }) {
          const url = `http://localhost:${port}`;
          console.log(`Server running on port ${port}`);
          console.log(`Open: ${url}`);
          console.log(`Data: ${DATA_FILE}`);
          console.log(`Log: ${LOG_FILE}`);
          logEvent(`Server started: port=${port} data="${DATA_FILE}" log="${LOG_FILE}" host=${diagnosticHost} pid=${Deno.pid}`);
          if (!args.includes("--no-browser")) void openBrowser(url);
        },
      }, handler);
      await server.finished;
      Deno.exit(0);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") Deno.exit(0);
      if (!(e instanceof Deno.errors.AddrInUse)) {
        await reportStartupError(`Failed to start server: ${e}`);
        Deno.exit(1);
      }
      const result = await reuseInstance();
      if (result === "reused") {
        console.log(`Reusing existing jobs-app on port ${PORT}`);
        logEvent(`Reusing existing instance on port ${PORT}`);
        Deno.exit(0);
      }
      if (result === "conflict" || attempt === 3) {
        await reportStartupError(`Port ${PORT} is occupied by another program, a different Jobs app version/data file/user, or an unresponsive instance. No process was stopped. Close the previous app and retry, or use --port with another port.`);
        Deno.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

startServer();

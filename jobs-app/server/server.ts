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

let lastActivity: number = Date.now();
let activeTabs = new Map<string, number>();
let exitTimeout: ReturnType<typeof setTimeout> | undefined;
const abortController = new AbortController();

function scheduleExit() {
  if (exitTimeout !== undefined) {
    clearTimeout(exitTimeout);
  }
  exitTimeout = setTimeout(() => {
    exitTimeout = undefined;
    if (activeTabs.size === 0) abortController.abort();
  }, 5000);
}

setInterval(() => {
  if (Date.now() - lastActivity > 1800000) abortController.abort();
}, 60000);

setInterval(() => {
  const now = Date.now();
  const toDelete: string[] = [];
  for (const [tabId, lastSeen] of activeTabs.entries()) {
    if (now - lastSeen > 300000) {
      toDelete.push(tabId);
    }
  }
  let changed = toDelete.length > 0;
  for (const tabId of toDelete) {
    activeTabs.delete(tabId);
  }
  if (changed && activeTabs.size === 0) {
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

function logError(msg: string) {
  console.error(msg);
  try {
    Deno.writeTextFileSync("error.log", `[${new Date().toISOString()}] ${msg}\n`, { append: true });
  } catch {}
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

async function acquireDataLock(): Promise<() => Promise<void>> {
  const path = lockPath();
  const started = Date.now();
  while (Date.now() - started < LOCK_MAX_WAIT_MS) {
    try {
      await Deno.mkdir(path);
      try {
        await Deno.writeTextFile(`${path}/owner.json`, JSON.stringify({
          pid: Deno.pid,
          created: Date.now(),
        }));
      } catch {}
      return async () => {
        try { await Deno.remove(path, { recursive: true }); } catch {}
      };
    } catch (e) {
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
        if (age > LOCK_STALE_MS) {
          await Deno.remove(path, { recursive: true });
          continue;
        }
      } catch (statError) {
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
  throw new Error(`Timed out waiting for shared data lock "${path}"`);
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
    releaseLock = await acquireDataLock();
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

function tryKillPort(port: number): void {
  try {
    if (Deno.build.os === "windows") {
      const result = new Deno.Command("netstat", {
        args: ["-ano"],
        stdout: "piped",
      }).outputSync();
      const stdout = new TextDecoder().decode(result.stdout);
      for (const line of stdout.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddress = parts[1];
          const lastColon = localAddress.lastIndexOf(":");
          if (lastColon !== -1) {
            const localPort = parseInt(localAddress.substring(lastColon + 1), 10);
            if (localPort === port) {
              const pid = parts[parts.length - 1];
              if (/^\d+$/.test(pid)) {
                new Deno.Command("taskkill", { args: ["/PID", pid, "/F"] }).outputSync();
                break;
              }
            }
          }
        }
      }
    } else {
      const result = new Deno.Command("lsof", {
        args: ["-t", `-i:${port}`],
        stdout: "piped",
      }).outputSync();
      const output = new TextDecoder().decode(result.stdout).trim();
      for (const pid of output.split(/\s+/)) {
        if (/^\d+$/.test(pid)) {
          try {
            Deno.kill(parseInt(pid, 10), "SIGKILL");
          } catch {}
        }
      }
    }
  } catch {}
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

async function ensureDataFile(): Promise<void> {
  try {
    const stat = await Deno.stat(DATA_FILE);
    if (!stat.isFile) throw new Error("Not a file");
    const content = await Deno.readTextFile(DATA_FILE);
    if (content.trim() === "") {
      await Deno.writeTextFile(DATA_FILE, "[]");
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(
          `Data file "${DATA_FILE}" contains invalid JSON and cannot be read. ` +
          `Fix or delete the file, then restart the server.`
        );
      }
      if (!Array.isArray(parsed)) {
        throw new Error(
          `Data file "${DATA_FILE}" does not contain a JSON array. ` +
          `Fix or delete the file, then restart the server.`
        );
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      const dir = DATA_FILE.includes("/") || DATA_FILE.includes("\\") ? DATA_FILE.replace(/[\/\\][^\/\\]+$/, "") : null;
      if (dir && !/^[A-Za-z]:$/.test(dir)) {
        await Deno.mkdir(dir, { recursive: true });
      }
      await Deno.writeTextFile(DATA_FILE, "[]");
    } else {
      throw e;
    }
  }
}

async function handleGetData(corsHeaders: Record<string, string>): Promise<Response> {
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireDataLock();
    const stat = await Deno.stat(DATA_FILE);
    let content;
    try {
      content = await Deno.readTextFile(DATA_FILE);
    } catch {
      return new Response("Failed to read data file", { status: 500, headers: corsHeaders });
    }
    let jobs;
    try {
      jobs = JSON.parse(content);
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
      return new Response("Shared data file is unavailable", { status: 503, headers: corsHeaders });
    }
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
  if (!Array.isArray(payload.base) || !Array.isArray(payload.proposed)) {
    return new Response("Invalid merge data", { status: 400, headers: corsHeaders });
  }

  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireDataLock();
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
        conflicts.push({ jobId: id, field: "_deleted", baseValue: base, currentValue: null, userValue: proposed });
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
      return new Response("Shared data file is unavailable", { status: 503, headers: corsHeaders });
    }
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
  }
  const mtime = stat.mtime?.getTime() || 0;
  const clientRevision = url.searchParams.get("revision");
  const revision = await readRevision();
  if ((clientRevision && clientRevision !== revision) || (!clientRevision && mtime > since)) {
    let content;
    try {
      content = await Deno.readTextFile(DATA_FILE);
    } catch {
      return new Response("Failed to read data file", { status: 500, headers: corsHeaders });
    }
    let jobs;
    try {
      jobs = JSON.parse(content);
    } catch {
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
    if (path === "/api/enter" && req.method === "POST") {
      const tabId = url.searchParams.get("tabId");
      if (tabId) {
        activeTabs.set(tabId, Date.now());
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

async function startServer() {
  try {
    await ensureDataFile();
  } catch (e) {
    logError(`Data file error: ${e}`);
  }

  let retried = false;
  while (true) {
    try {
      const server = Deno.serve({
        port: PORT,
        hostname: "127.0.0.1",
        signal: abortController.signal,
        onListen({ port }) {
          const url = `http://localhost:${port}`;
          console.log(`Server running on port ${port}`);
          console.log(`Open: ${url}`);
          console.log(`Data: ${DATA_FILE}`);
          console.log(`Close: Ctrl+C`);
          console.log("");
          setTimeout(() => void maybeCreateBackup(true), 2000);

          let command: string[];
          if (Deno.build.os === "windows") {
            command = ["cmd.exe", "/c", "start", "", url];
          } else if (Deno.build.os === "darwin") {
            command = ["open", url];
          } else {
            command = ["xdg-open", url];
          }
          try {
            new Deno.Command(command[0], {
              args: command.slice(1),
              stdin: "null",
              stdout: "null",
              stderr: "null"
            }).spawn();
          } catch (e) {
            logError(`Browser open failed: ${e}`);
          }
        }
      }, handler);

      await server.finished;
      Deno.exit(0);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") Deno.exit(0);
      if (e instanceof Deno.errors.AddrInUse && !retried) {
        logError(`Port ${PORT} in use, trying to kill old process...`);
        tryKillPort(PORT);
        retried = true;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      if (retried) {
        logError(`Port ${PORT} still in use after kill attempt`);
      } else {
        logError(`Failed to start server: ${e}`);
      }
      Deno.exit(1);
    }
  }
}

startServer();

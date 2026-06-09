const DEFAULT_PORT = 8085;
const MAX_SAVE_RETRIES = 8;
const SAVE_RETRY_BASE_DELAY_MS = 50;

let DATA_FILE = "jobs_data.json";
const args = Deno.args;
let PORT = DEFAULT_PORT;

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
let activeTabs = new Set<string>();
let exitTimeout: ReturnType<typeof setTimeout> | undefined;
const abortController = new AbortController();

setInterval(() => {
  if (Date.now() - lastActivity > 1800000) abortController.abort();
}, 60000);

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

function tryKillPort(port: number): void {
  try {
    if (Deno.build.os === "windows") {
      const result = new Deno.Command("netstat", {
        args: ["-ano"],
        stdout: "piped",
      }).outputSync();
      const stdout = new TextDecoder().decode(result.stdout);
      for (const line of stdout.split("\n")) {
        if (line.includes("LISTENING")) {
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
      }
    } else {
      const result = new Deno.Command("lsof", {
        args: ["-t", `-i:${port}`],
        stdout: "piped",
      }).outputSync();
      const output = new TextDecoder().decode(result.stdout).trim();
      for (const pid of output.split(/\s+/)) {
        if (/^\d+$/.test(pid)) {
          new Deno.Command("kill", { args: ["-9", pid] }).outputSync();
        }
      }
    }
  } catch {}
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
  try {
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
    return Response.json({
      modified: stat.mtime?.getTime() || Date.now(),
      jobs,
    }, { headers: corsHeaders });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return Response.json({ modified: 0, jobs: [] }, { headers: corsHeaders });
    }
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
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
  const since = parseInt(url.searchParams.get("since") || "0", 10);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(DATA_FILE);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return Response.json({ changed: false }, { headers: corsHeaders });
    }
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
  }
  const mtime = stat.mtime?.getTime() || 0;
  if (mtime > since) {
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
    return Response.json({ changed: true, jobs, modified: mtime }, { headers: corsHeaders });
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
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    if (path === "/api/data") {
      if (req.method === "GET") return await handleGetData(CORS);
      if (req.method === "POST") return await handlePostData(req, CORS);
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (path === "/api/poll" && req.method === "GET") {
      return await handlePoll(url, CORS);
    }
    if (path === "/api/enter" && req.method === "POST") {
      const tabId = url.searchParams.get("tabId");
      if (tabId) {
        activeTabs.add(tabId);
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
          exitTimeout = undefined;
        }
      }
      return new Response("ok");
    }
    if (path === "/api/exit" && req.method === "POST") {
      const origin = req.headers.get("origin");
      const referer = req.headers.get("referer");
      const isLocalConnection = (urlStr: string | null) => {
        if (!urlStr) return false;
        try {
          const u = new URL(urlStr);
          return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
        } catch {
          return false;
        }
      };
      const isLocal = (!origin || isLocalConnection(origin)) && (!referer || isLocalConnection(referer));
      if (!isLocal) return new Response("Forbidden", { status: 403 });

      const tabId = url.searchParams.get("tabId");
      if (tabId) {
        activeTabs.delete(tabId);
      }
      if (activeTabs.size === 0) {
        if (exitTimeout !== undefined) {
          clearTimeout(exitTimeout);
        }
        exitTimeout = setTimeout(() => {
          if (activeTabs.size === 0) abortController.abort();
        }, 5000);
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
    Deno.exit(1);
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
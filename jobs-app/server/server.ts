const DEFAULT_PORT = 8080;
const MAX_SAVE_RETRIES = 8;
const SAVE_RETRY_BASE_DELAY_MS = 50;

let DATA_FILE = "jobs_data.json";
const args = Deno.args;
let PORT = DEFAULT_PORT;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data" && i + 1 < args.length) DATA_FILE = args[i + 1];
  if (args[i] === "--port" && i + 1 < args.length) {
    const parsed = parseInt(args[i + 1], 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 65535) {
      PORT = parsed;
    } else {
      logError(`Invalid port number "${args[i + 1]}" (must be 0-65535)`);
      Deno.exit(1);
    }
  }
}

let lastActivity: number = Date.now();

setInterval(() => {
  if (Date.now() - lastActivity > 1800000) Deno.exit(0);
}, 60000);

function logError(msg: string) {
  try {
    Deno.writeTextFileSync("error.log", `[${new Date().toISOString()}] ${msg}\n`, { append: true });
  } catch {}
}

async function ensureDataFile(): Promise<void> {
  try {
    const stat = await Deno.stat(DATA_FILE);
    if (!stat.isFile) throw new Error("Not a file");
    const content = await Deno.readTextFile(DATA_FILE);
    JSON.parse(content); // validate JSON
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      const dir = DATA_FILE.includes("/") || DATA_FILE.includes("\\") ? DATA_FILE.replace(/[\/\\][^\/\\]+$/, "") : null;
      if (dir) {
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
      const dir = DATA_FILE.includes("/") || DATA_FILE.includes("\\") ? DATA_FILE.replace(/[\/\\][^\/\\]+$/, "") : ".";
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
    if (path === "/api/exit") {
      setTimeout(() => Deno.exit(0), 100);
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

  const abortController = new AbortController();

  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGINT", () => {
      abortController.abort();
    });
  }

  try {
    const server = Deno.serve({
      port: PORT,
      hostname: "127.0.0.1",
      signal: abortController.signal,
      onListen() {
        const url = `http://localhost:${PORT}`;

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
    if (e instanceof Deno.errors.AddrInUse) {
      logError(`Port ${PORT} in use`);
      Deno.exit(1);
    }
    logError(`Failed to start server: ${e}`);
    Deno.exit(1);
  }
}

startServer();
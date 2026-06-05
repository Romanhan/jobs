const DEFAULT_PORT = 8080;
const MAX_PORT_RETRIES = 10;
const MAX_SAVE_RETRIES = 8;
const SAVE_RETRY_BASE_DELAY_MS = 50;

let DATA_FILE = "jobs_data.json";
const args = Deno.args;
let PORT = DEFAULT_PORT;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data" && i + 1 < args.length) DATA_FILE = args[i + 1];
  if (args[i] === "--port" && i + 1 < args.length) PORT = parseInt(args[i + 1], 10);
}

let lastHeartbeat: number = Date.now();

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
    if (e instanceof Deno.errors.NotFound || e instanceof SyntaxError) {
      // File missing or invalid JSON → create empty array silently
      await Deno.writeTextFile(DATA_FILE, "[]");
      // Only log when we repaired corrupted/invalid JSON, not on first run
      if (!(e instanceof Deno.errors.NotFound)) {
        logError(`Data file was invalid JSON, replaced with empty list`);
      }
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

  const tempFile = DATA_FILE + "." + Math.random().toString(36).slice(2) + ".tmp";
  for (let attempt = 0; attempt < MAX_SAVE_RETRIES; attempt++) {
    try {
      await Deno.writeTextFile(tempFile, JSON.stringify(jobs));
      await Deno.rename(tempFile, DATA_FILE);
      break;
    } catch (e) {
      if (attempt === MAX_SAVE_RETRIES - 1) {
        logError(`Save failed after ${MAX_SAVE_RETRIES} retries: ${e}`);
        try { await Deno.remove(tempFile); } catch {}
        return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
      }
      const delay = SAVE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      try { await Deno.remove(tempFile); } catch {}
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
    if (path === "/api/heartbeat") {
      lastHeartbeat = Date.now();
      return new Response("ok");
    }
    return await serveStatic(url);
  } catch (e) {
    logError(`Handler error: ${e}`);
    return new Response("Internal Server Error", { status: 500 });
  }
}

const url = `http://localhost:${PORT}`;

function printBanner() {
  console.log("");
  console.log("  ╔══════════════════════════════╗");
  console.log("  ║   Tööde Haldus — Server       ║");
  console.log("  ╚══════════════════════════════╝");
  console.log(`  Andmed: ${DATA_FILE}`);
  console.log(`  Otsitava pordivahemik: ${PORT}-${PORT + MAX_PORT_RETRIES - 1}`);
}

async function verifyServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/heartbeat`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer() {
  printBanner();

  const abortController = new AbortController();

  Deno.addSignalListener("SIGINT", () => {
    console.log("\n  Server suletakse...");
    abortController.abort();
    Deno.exit(0);
  });

  for (let port = PORT; port < PORT + MAX_PORT_RETRIES; port++) {
    process.stdout.write(`  Proovin pordi ${port}... `);
    try {
      Deno.serve({
        port,
        hostname: "127.0.0.1",
        signal: abortController.signal,
        onListen() {
          const actualUrl = `http://localhost:${port}`;
          console.log("Õnnestus!");
          console.log("");
          console.log(`  ✅ Server töötab!`);
          console.log(`  🌐 Ava: ${actualUrl}`);
          console.log(`  ❌ Sulge: Ctrl+C`);
          console.log("");

          if (Deno.build.os === "windows") {
            try {
              new Deno.Command("cmd.exe", {
                args: ["/c", "start", "", actualUrl],
                stdout: "null", stderr: "null"
              }).spawn();
            } catch (e) {
              logError(`Browser open failed: ${e}`);
            }
          }
        }
      }, handler);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.log("Hõivatud");
      if (port === PORT + MAX_PORT_RETRIES - 1) {
        console.error("");
        console.error("  ⛔ Viga: kõik pordid on hõivatud!");
        console.error(`  ${PORT}-${PORT + MAX_PORT_RETRIES - 1} — proovige --port pordiga`);
        console.error("");
        logError(`All ports ${PORT}-${PORT + MAX_PORT_RETRIES - 1} in use: ${e}`);
        Deno.exit(1);
      }
    }
  }
}

startServer();
const PORT = 8080;
let DATA_FILE = "jobs_data.json";
const args = Deno.args;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--data" && i + 1 < args.length) DATA_FILE = args[i + 1];
}

let lastHeartbeat: number | null = null;
setInterval(() => {
  if (lastHeartbeat && Date.now() - lastHeartbeat > 10000) Deno.exit(0);
}, 5000);

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
  try {
    await Deno.writeTextFile(tempFile, JSON.stringify(jobs));
    await Deno.rename(tempFile, DATA_FILE);
  } catch (e) {
    console.error("Failed to write data file:", e);
    try {
      await Deno.remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    return new Response("Internal Server Error", { status: 500, headers: corsHeaders });
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

  // decodeURIComponent handles percent-encoded traversals like %2e%2e%2f
  try {
    path = decodeURIComponent(path);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const baseUrl = new URL("web/", import.meta.url);
  // URL pathname normalizes .. segments, handling decoded and literal traversals
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
    console.error("Error:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}

const url = `http://localhost:${PORT}`;

console.log("");
console.log("  Tööde Haldus — Server käivitatud");
console.log(`  Ava: ${url}`);
console.log(`  Andmed: ${DATA_FILE}`);
console.log("  Sulge: Ctrl+C");
console.log("");

const run = Deno.build.os === "windows" ? ["cmd.exe", "/c", "start", url]
  : Deno.build.os === "darwin" ? ["open", url]
  : ["xdg-open", url];

try {
  Deno.serve({
    port: PORT,
    hostname: "127.0.0.1",
    onListen() {
      try {
        new Deno.Command(run[0], { args: run.slice(1), stdin: "null", stdout: "null", stderr: "null" }).spawn();
      } catch (e) {
        Deno.writeTextFileSync("error.log", "Browser open failed: " + e);
      }
    }
  }, handler);
} catch (e) {
  Deno.writeTextFileSync("error.log", e + "\n" + ((e as Error)?.stack || ""));
  Deno.exit(1);
}

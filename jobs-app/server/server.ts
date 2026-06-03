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
    const content = await Deno.readTextFile(DATA_FILE);
    const jobs = JSON.parse(content);
    return Response.json({
      modified: stat.mtime?.getTime() || Date.now(),
      jobs,
    }, { headers: corsHeaders });
  } catch {
    return Response.json({ modified: 0, jobs: [] }, { headers: corsHeaders });
  }
}

async function handlePostData(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const jobs = await req.json();
  const file = await Deno.open(DATA_FILE, { create: true, write: true, truncate: true });
  try {
    file.lockSync(true);
    await file.write(new TextEncoder().encode(JSON.stringify(jobs)));
    file.unlockSync();
  } finally {
    file.close();
  }
  const stat = await Deno.stat(DATA_FILE);
  return Response.json({
    modified: stat.mtime?.getTime() || Date.now(),
  }, { headers: corsHeaders });
}

async function handlePoll(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
  const since = parseInt(url.searchParams.get("since") || "0");
  try {
    const stat = await Deno.stat(DATA_FILE);
    const mtime = stat.mtime?.getTime() || 0;
    if (mtime > since) {
      const content = await Deno.readTextFile(DATA_FILE);
      const jobs = JSON.parse(content);
      return Response.json({ changed: true, jobs, modified: mtime }, { headers: corsHeaders });
    }
  } catch {
    // file not found or invalid JSON — no changes
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
  if (path.includes("..")) return new Response("Forbidden", { status: 403 });

  const filePath = import.meta.dirname + "/web" + path;
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.substring(dot) : "";
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const content = await Deno.readFile(filePath);
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
  new Deno.Command(run[0], { args: run.slice(1), stdin: "null", stdout: "null", stderr: "null" }).spawn();
} catch (e) {
  Deno.writeTextFileSync("error.log", `Browser open failed: ${e}`);
}

try {
  Deno.serve({ port: PORT, hostname: "127.0.0.1" }, handler);
} catch (e) {
  Deno.writeTextFileSync("error.log", `${e}\n${(e as Error)?.stack || ""}`);
}

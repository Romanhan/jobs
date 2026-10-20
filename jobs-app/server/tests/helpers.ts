import { fileURLToPath } from "node:url";

export function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

export function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Backup snapshots are filed by month; tests search the whole tree.
export async function backupEntries(directory: string): Promise<{ name: string; path: string }[]> {
  const entries: { name: string; path: string }[] = [];
  const collect = async (dir: string) => {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) await collect(path);
        else if (entry.name.endsWith(".json")) entries.push({ name: entry.name, path });
      }
    } catch { /* missing or unreadable folder */ }
  };
  await collect(directory);
  return entries;
}

export const job = (id = "a", extra = {}) => ({
  _id: id, "Töö Nr": id.toUpperCase(), "Täitmise koht": "TOS", ...extra,
});

export async function until<T>(fn: () => Promise<T>, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition");
}

export async function startServer(dataFile: string, cwd: string, extraEnv: Record<string, string> = {}) {
  const executable = Deno.env.get("JOBS_TEST_EXECUTABLE");
  const child = new Deno.Command(executable || Deno.execPath(), {
    args: [...(executable ? [] : ["run", "-A", fileURLToPath(new URL("../server.ts", import.meta.url))]),
      "--port", "0", "--data", dataFile, "--no-browser"],
    // Pin the log next to the fixture data so tests never write next to the
    // executable (a compiled exe keeps its log beside itself). Lock waits are
    // shortened: production waits 90 s for a lock, tests cannot.
    env: {
      JOBS_LOG_FILE: `${cwd}/error.log`,
      JOBS_LOCK_MAX_WAIT_MS: Deno.env.get("JOBS_LOCK_MAX_WAIT_MS") || "1500",
      JOBS_LOCK_HEARTBEAT_MS: Deno.env.get("JOBS_LOCK_HEARTBEAT_MS") || "250",
      JOBS_LOCK_PROGRESS_MS: Deno.env.get("JOBS_LOCK_PROGRESS_MS") || "400",
      ...extraEnv,
    },
    cwd, stdout: "piped", stderr: "piped",
  }).spawn();
  let output = "";
  let url = "";
  const consume = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
      output += chunk;
      const match = output.match(/Server running on port (\d+)/);
      if (match) url = `http://127.0.0.1:${match[1]}`;
    }
  };
  const readers = Promise.all([consume(child.stdout), consume(child.stderr)]);
  const close = async () => {
    try { child.kill("SIGTERM"); } catch { /* already stopped */ }
    await child.status;
    await readers;
  };
  try {
    await until(async () => url);
  } catch (error) {
    await close();
    throw new Error(`${error}\n${output}`);
  }
  return { url, close };
}

export async function fixture(jobs: unknown = [job()], env: Record<string, string> = {}) {
  const dir = await Deno.makeTempDir({ prefix: "jobs-tests-" });
  const file = `${dir}/jobs_data.json`;
  await Deno.writeTextFile(file, JSON.stringify(jobs));
  const servers: Awaited<ReturnType<typeof startServer>>[] = [];
  const start = async () => {
    const server = await startServer(file, dir, env);
    servers.push(server);
    return server;
  };
  try {
    const server = await start();
    const request = (path: string, body?: unknown, url = server.url) => fetch(url + path,
      body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return {
      dir, file, url: server.url, start, request,
      read: async () => JSON.parse(await Deno.readTextFile(file)),
      data: async () => { const r = await request("/api/data"); equal(r.status, 200); return r.json(); },
      merge: async (base: unknown, proposed: unknown, url = server.url) => {
        const r = await request("/api/merge", { base, proposed }, url);
        equal(r.status, 200);
        return r.json();
      },
      close: async () => {
        await Promise.all(servers.map(s => s.close()));
        await Deno.remove(dir, { recursive: true });
      },
    };
  } catch (error) {
    await Promise.all(servers.map(s => s.close()));
    await Deno.remove(dir, { recursive: true });
    throw error;
  }
}

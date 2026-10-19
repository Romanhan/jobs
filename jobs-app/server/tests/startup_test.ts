import { fileURLToPath } from "node:url";
import { assert, equal, fixture, until } from "./helpers.ts";

function launch(file: string, port: number, cwd: string, options: { browser?: boolean; env?: Record<string, string> } = {}) {
  const executable = Deno.env.get("JOBS_TEST_EXECUTABLE");
  const child = new Deno.Command(executable || Deno.execPath(), {
    args: [...(executable ? [] : ["run", "-A", fileURLToPath(new URL("../server.ts", import.meta.url))]),
      "--data", file, "--port", String(port), ...(options.browser ? [] : ["--no-browser"])],
    env: options.env,
    cwd, stdout: "piped", stderr: "piped",
  }).spawn();
  let output = "";
  let status: Deno.CommandStatus | undefined;
  const readers = Promise.all([child.stdout, child.stderr].map(async stream => {
    for await (const chunk of stream.pipeThrough(new TextDecoderStream())) output += chunk;
  }));
  const finished = child.status.then(value => { status = value; return value; });
  return {
    pid: child.pid,
    output: () => output,
    status: () => status,
    async wait() { await until(async () => status, 12000); await readers; return (await finished).code; },
    async close() { try { child.kill("SIGTERM"); } catch { /* already exited */ } await finished; await readers; },
  };
}

Deno.test("startup: repeated and concurrent launches reuse the server without logging failures", async () => {
  const f = await fixture();
  const launches: ReturnType<typeof launch>[] = [];
  try {
    const port = Number(new URL(f.url).port);
    for (let round = 0; round < 2; round++) {
      const batch = Array.from({ length: 3 }, () => launch(f.file, port, f.dir));
      launches.push(...batch);
      equal(await Promise.all(batch.map(item => item.wait())), [0, 0, 0]);
      for (const item of batch) assert(item.output().includes("Reusing existing jobs-app"));
    }
    equal((await f.data()).jobs.length, 1);
    const log = await Deno.readTextFile(`${f.dir}/error.log`);
    assert(log.includes("Server started:"), "Startup should be recorded");
    for (const failure of ["Failed to start", "is occupied", "Data load failed", "Poll failed"]) {
      assert(!log.includes(failure), `Unexpected failure in log: ${failure}`);
    }
  } finally { await Promise.all(launches.map(item => item.close())); await f.close(); }
});

Deno.test("startup: reopen reserves time beyond the old five-second shutdown", async () => {
  const f = await fixture();
  let second;
  try {
    for (const route of ['/api/enter?tabId=old', '/api/exit?tabId=old']) {
      const response = await f.request(route, {}); await response.text();
    }
    second = launch(f.file, Number(new URL(f.url).port), f.dir);
    equal(await second.wait(), 0);
    await new Promise(resolve => setTimeout(resolve, 5500));
    equal((await f.data()).jobs.length, 1);
    const enter = await f.request('/api/enter?tabId=new', {}); await enter.text();
    const exit = await f.request('/api/exit?tabId=new', {}); await exit.text();
    await new Promise(resolve => setTimeout(resolve, 5500));
    let stopped = false;
    try { const response = await f.request('/'); await response.text(); } catch { stopped = true; }
    assert(stopped, 'Server should stop after the last registered tab closes');
  } finally { await second?.close(); await f.close(); }
});

Deno.test("startup: different data file is rejected without stopping the first server", async () => {
  const f = await fixture();
  const second = launch(`${f.dir}/other.json`, Number(new URL(f.url).port), f.dir);
  try {
    equal(await second.wait(), 1);
    assert(second.output().includes("No process was stopped"));
    equal((await f.data()).jobs.length, 1);
  } finally { await second.close(); await f.close(); }
});

Deno.test("startup: simultaneous first launches elect one server", async () => {
  const dir = await Deno.makeTempDir();
  const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = listener.addr.port; listener.close();
  const children = [launch(`${dir}/data.json`, port, dir), launch(`${dir}/data.json`, port, dir)];
  try {
    await until(async () => children.some(child => child.status()));
    equal(children.filter(child => child.status()?.code === 0).length, 1);
    equal(children.filter(child => !child.status()).length, 1);
    const response = await fetch(`http://127.0.0.1:${port}/api/data`);
    equal(response.status, 200); equal((await response.json()).jobs, []);
  } finally { await Promise.all(children.map(child => child.close())); await Deno.remove(dir, { recursive: true }); }
});

for (const kind of ['unrelated', 'wrong-version', 'unresponsive', 'shutting-down']) {
  Deno.test(`startup: occupied port (${kind}) is handled without killing its owner`, async () => {
    const dir = await Deno.makeTempDir();
    const sockets: Deno.Conn[] = [];
    let server: Deno.HttpServer | undefined;
    let listener: Deno.TcpListener | undefined;
    let accept: Promise<void> | undefined;
    let port: number;
    if (kind === 'unresponsive') {
      listener = Deno.listen({ hostname: '127.0.0.1', port: 0 }); port = listener.addr.port;
      accept = (async () => { try { for await (const conn of listener!) sockets.push(conn); } catch { /* closed */ } })();
    } else {
      server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async req => {
        if (kind === 'shutting-down') {
          setTimeout(() => void server!.shutdown(), 20);
          return new Response('Shutting down', { status: 503 });
        }
        if (kind === 'wrong-version') {
          const request = await req.json();
          return Response.json({ app: 'jobs-app', nonce: request.nonce, conflict: true }, { status: 409 });
        }
        return new Response('Another program');
      });
      port = (server.addr as Deno.NetAddr).port;
    }
    const child = launch(`${dir}/data.json`, port, dir);
    try {
      if (kind === 'shutting-down') {
        await until(async () => child.output().includes('Server running on port'));
        assert(!child.status());
      } else {
        equal(await child.wait(), 1);
        assert(child.output().includes('No process was stopped'));
        if (server) {
          const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', body: '{}' });
          await response.text();
        } else assert(sockets.length > 0);
      }
    } finally {
      await child.close();
      listener?.close(); for (const socket of sockets) socket.close(); await accept;
      await server?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  });
}

Deno.test({
  name: "startup: existing server owns browser opening after second executable exits",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const dir = await Deno.makeTempDir();
    const marker = `${dir}/browser.log`;
    // A delayed desktop opener exercises the real launch path without a GUI.
    await Deno.writeTextFile(`${dir}/xdg-open`, '#!/bin/sh\nsleep 0.3\nprintf "%s %s\\n" "$PPID" "$1" >> "$JOBS_TEST_BROWSER_LOG"\n');
    await Deno.chmod(`${dir}/xdg-open`, 0o755);
    const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const port = listener.addr.port; listener.close();
    const options = { browser: true, env: { PATH: `${dir}:${Deno.env.get('PATH') || ''}`, JOBS_TEST_BROWSER_LOG: marker } };
    const first = launch(`${dir}/data.json`, port, dir, options);
    let second;
    const lines = async () => {
      try { return (await Deno.readTextFile(marker)).trim().split('\n'); }
      catch (e) { if (e instanceof Deno.errors.NotFound) return []; throw e; }
    };
    try {
      await until(async () => (await lines()).length === 1);
      second = launch(`${dir}/data.json`, port, dir, options);
      equal(await second.wait(), 0);
      await until(async () => (await lines()).length === 2);
      equal(await lines(), Array(2).fill(`${first.pid} http://localhost:${port}`));
      assert(!first.status(), 'The browser launcher must belong to the surviving server');
    } finally {
      await second?.close(); await first.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});

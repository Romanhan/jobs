import { until } from "./helpers.ts";

// Uses Chromium's built-in DevTools protocol; no downloaded test libraries.
export async function browser() {
  const dir = await Deno.makeTempDir({ prefix: "jobs-browser-" });
  const child = new Deno.Command(Deno.env.get("CHROME_BIN") || "chromium", {
    args: ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank"],
    stdout: "null", stderr: "piped",
  }).spawn();
  let log = "";
  let port = "";
  const reader = (async () => {
    for await (const text of child.stderr.pipeThrough(new TextDecoderStream())) {
      log += text;
      const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) port = match[1];
    }
  })();
  let socket: WebSocket | undefined;
  const close = async () => {
    socket?.close();
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
    await child.status;
    await reader;
    await Deno.remove(dir, { recursive: true });
  };
  try {
    await until(async () => port);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await response.json();
    socket = new WebSocket(targets.find((t: { type: string }) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
    let id = 0;
    let loads = 0;
    const pageErrors: string[] = [];
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Page.loadEventFired") loads++;
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        pageErrors.push(details.exception?.description || details.text);
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(requestId, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      socket!.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async (expression: string) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send("Page.enable");
    await send("Runtime.enable");
    return {
      close, evaluate,
      beforeLoad: (source: string) => send("Page.addScriptToEvaluateOnNewDocument", { source }),
      async open(url: string, requireData = true) {
        const previousLoads = loads;
        await send("Page.navigate", { url });
        await until(async () => loads > previousLoads);
        await until(async () => await evaluate(`document.readyState === 'complete' && !!document.getElementById('btn-add-job') ${requireData ? "&& !document.getElementById('btn-add-job').disabled" : ""}`));
      },
      async run(fn: () => Promise<void>) {
        await evaluate(`(${fn.toString()})()`);
        if (pageErrors.length) throw new Error(`Uncaught browser error: ${pageErrors.join("\n")}`);
      },
    };
  } catch (error) {
    await close();
    throw new Error(`${error}\n${log}`);
  }
}

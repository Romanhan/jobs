import { acquireDataLock, releaseDataLock, type LockFs } from "../data-lock.ts";
import { assert, equal, exists } from "./helpers.ts";

// Windows and SMB report ERROR_ACCESS_DENIED (not ERROR_ALREADY_EXISTS) when a
// directory is pending deletion, so the create fails even though the lock is
// sitting right there. These tests drive that case without a network share.
class FakeFs implements LockFs {
  directories = new Set<string>();
  files = new Map<string, { content: string; mtime: number }>();
  directoryMtimes = new Map<string, number>();
  /** Refuse creates while the lock directory is present, like a delete-pending share. */
  denyCreateWhilePresent = false;
  /** Refuse every filesystem call, like a share that lost write access. */
  denyEverything = false;
  createCalls = 0;

  private deny(path: string): never {
    throw new Deno.errors.PermissionDenied(`Access is denied. (os error 5): ${path}`);
  }

  async mkdir(path: string): Promise<void> {
    this.createCalls++;
    if (this.denyEverything) this.deny(path);
    if (this.denyCreateWhilePresent && this.directories.has(path)) this.deny(path);
    if (this.directories.has(path) || this.files.has(path)) {
      throw new Deno.errors.AlreadyExists(`File exists (os error 17): ${path}`);
    }
    this.directories.add(path);
    this.directoryMtimes.set(path, Date.now());
  }

  async stat(path: string): Promise<{ mtime: Date | null }> {
    if (this.denyEverything) this.deny(path);
    const directory = this.directoryMtimes.get(path);
    if (directory !== undefined) return { mtime: new Date(directory) };
    const file = this.files.get(path);
    if (file) return { mtime: new Date(file.mtime) };
    throw new Deno.errors.NotFound(`No such file or directory (os error 2): ${path}`);
  }

  async readTextFile(path: string): Promise<string> {
    if (this.denyEverything) this.deny(path);
    const file = this.files.get(path);
    if (!file) throw new Deno.errors.NotFound(`No such file or directory (os error 2): ${path}`);
    return file.content;
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    if (this.denyEverything) this.deny(path);
    this.files.set(path, { content: data, mtime: Date.now() });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.denyEverything) this.deny(oldPath);
    let found = false;
    const directoryMtime = this.directoryMtimes.get(oldPath);
    if (this.directories.delete(oldPath)) {
      this.directoryMtimes.delete(oldPath);
      this.directories.add(newPath);
      this.directoryMtimes.set(newPath, directoryMtime ?? Date.now());
      found = true;
    }
    const file = this.files.get(oldPath);
    if (file) {
      this.files.delete(oldPath);
      this.files.set(newPath, file);
      found = true;
    }
    // Move children too: a lock directory holds owner.json.
    for (const directory of [...this.directories]) {
      if (!directory.startsWith(`${oldPath}/`)) continue;
      this.directories.delete(directory);
      this.directories.add(newPath + directory.slice(oldPath.length));
      found = true;
    }
    for (const child of [...this.files.keys()]) {
      if (!child.startsWith(`${oldPath}/`)) continue;
      const moved = this.files.get(child)!;
      this.files.delete(child);
      this.files.set(newPath + child.slice(oldPath.length), moved);
      found = true;
    }
    if (!found) throw new Deno.errors.NotFound(`No such file or directory (os error 2): ${oldPath}`);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.denyEverything) this.deny(path);
    let found = false;
    if (this.directories.delete(path)) {
      this.directoryMtimes.delete(path);
      found = true;
    }
    if (this.files.delete(path)) found = true;
    if (options?.recursive) {
      const prefix = `${path}/`;
      for (const directory of [...this.directories]) {
        if (!directory.startsWith(prefix)) continue;
        this.directories.delete(directory);
        this.directoryMtimes.delete(directory);
        found = true;
      }
      for (const file of [...this.files.keys()]) {
        if (!file.startsWith(prefix)) continue;
        this.files.delete(file);
        found = true;
      }
    }
    if (!found) throw new Deno.errors.NotFound(`No such file or directory (os error 2): ${path}`);
  }

  ageDirectory(path: string, ageMs: number): void {
    this.directoryMtimes.set(path, Date.now() - ageMs);
  }

  touchFile(path: string, ageMs = 0): void {
    const file = this.files.get(path);
    if (file) file.mtime = Date.now() - ageMs;
  }
}

const LOCK_PATH = "/share/jobs_data.json.lock";
const OWNER_PATH = `${LOCK_PATH}/owner.json`;

function options(fs: FakeFs, log: string[], overrides: Record<string, unknown> = {}) {
  return {
    path: LOCK_PATH,
    operation: "merge",
    owner: { pid: 1, host: "test-host" },
    fs,
    maxWaitMs: 5000,
    staleMs: 120000,
    heartbeatMs: 100000,
    progressMs: 100000,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    log: (message: string) => log.push(message),
    logError: (message: string) => log.push(message),
    ...overrides,
  };
}

Deno.test("lock: a create refused for a stale lock is reclaimed instead of retried", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.ageDirectory(LOCK_PATH, 300000);
  // The share refuses the create for as long as the stale directory exists.
  fs.denyCreateWhilePresent = true;

  const release = await acquireDataLock(options(fs, log));

  assert(log.some(line => line.includes("reclaimed as stale")), "The reclaim must be logged");
  assert(log.some(line => line.includes("method=renamed")), "The stale lock must be renamed to a tombstone");
  assert(fs.createCalls > 1, "The lock must be created after the stale one is gone");
  const owner = JSON.parse(await fs.readTextFile(OWNER_PATH));
  equal(owner.operation, "merge");
  assert(owner.token && owner.created, "owner.json must carry a token and timestamp");

  await release();
  equal(fs.directories.has(LOCK_PATH), false);
  equal(fs.directories.size, 0);
});

Deno.test("lock: a lock whose owner heartbeat is fresh is never mistaken for stale", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  // The directory timestamp looks ancient (network shares cache attributes),
  // but the owner keeps refreshing its heartbeat.
  fs.ageDirectory(LOCK_PATH, 600000);
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ host: "other" }), mtime: Date.now() });

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 300 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("Timed out waiting for shared data lock"), `Unexpected failure: ${failure}`);
  assert(fs.directories.has(LOCK_PATH), "A live lock must not be reclaimed");
  assert(failure.includes("observedOwner="), "The timeout must name the lock owner");
  assert(failure.includes("lockState=present"), "The timeout must report the lock state");
});

Deno.test("lock: a create refused with no lock present reports the share, not a lock", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.denyEverything = true;
  const probes: string[] = [];

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, {
      maxWaitMs: 300,
      probeWritable: async () => { probes.push("called"); return "denied"; },
    }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("lockState=missing"), `Unexpected failure: ${failure}`);
  assert(failure.includes("probe=denied"), "A share that refuses everything must be reported as such");
  assert(probes.length === 1, "The writability probe must be cached, not repeated on every retry");
});

Deno.test("lock release retries transient shared-drive deletion failures", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/jobs_data.json.lock`;
  await Deno.mkdir(path);
  await Deno.writeTextFile(`${path}/owner.json`, "{}");
  const remove = Deno.remove;
  let attempts = 0;
  Deno.remove = (target, options) => {
    if (target === path && ++attempts <= 2) {
      return Promise.reject(new Deno.errors.PermissionDenied("Shared-drive handle still open"));
    }
    return remove(target, options);
  };
  try {
    await releaseDataLock(path);
    equal(attempts, 3);
    // The next save can acquire the same lock immediately.
    await Deno.mkdir(path);
    await releaseDataLock(path);
    await releaseDataLock(path); // Already removed is successful cleanup.
  } finally {
    Deno.remove = remove;
    await remove(dir, { recursive: true });
  }
});

Deno.test("lock release confirms the directory is gone before reporting success", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/jobs_data.json.lock`;
  await Deno.mkdir(path);
  // A share can report a successful deletion while the directory is still in a
  // delete-pending state — exactly what makes every later create fail.
  const remove = Deno.remove;
  let lingeringRemovals = 1;
  Deno.remove = ((target: string | URL, options?: { recursive?: boolean }) => {
    if (String(target) === path && lingeringRemovals-- > 0) return Promise.resolve();
    return remove(target, options);
  }) as typeof Deno.remove;
  const log: string[] = [];
  try {
    await releaseDataLock(path, { log: message => log.push(message) });
    assert(lingeringRemovals <= 0, "Release must keep retrying while the directory lingers");
    assert(log.some(line => line.includes("still present after removal")), "A lingering removal must be logged");
    assert(!(await exists(path)), "Release must not report success while the directory is still there");
  } finally {
    Deno.remove = remove;
    await remove(dir, { recursive: true });
  }
});
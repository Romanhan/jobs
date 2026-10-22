import { acquireDataLock, releaseDataLock, type LockFs } from "../data-lock.ts";
import { assert, equal, exists } from "./helpers.ts";

// The claim is a file created with CREATE_NEW inside a permanent folder, so
// these tests model the filesystem rather than a network share. Windows and
// SMB report ERROR_ACCESS_DENIED (not ERROR_ALREADY_EXISTS) while a name is
// pending deletion, and some shares allow files but refuse new directories;
// both cases can be driven here.
class FakeFs implements LockFs {
  directories = new Set<string>();
  files = new Map<string, { content: string; mtime: number }>();
  directoryMtimes = new Map<string, number>();
  /** Refuse every directory create, like a share that only allows files. */
  denyMkdir = false;
  /** Refuse the holder create even when the name is absent (delete pending). */
  denyHolderCreate = false;
  /** Refuse renames, like a share that cannot move a stale claim aside. */
  denyRename = false;
  /** Refuse every filesystem call, like a share that lost write access. */
  denyEverything = false;
  /** Runs right after a holder is created, to stage a race with another client. */
  afterHolderCreate: (() => void) | null = null;
  createCalls = 0;
  removeCalls: string[] = [];

  constructor() {
    this.directories.add("/share");
  }

  private deny(path: string): never {
    throw new Deno.errors.PermissionDenied(`Access is denied. (os error 5): ${path}`);
  }

  private parent(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
  }

  private ensureParent(path: string): void {
    const parent = this.parent(path);
    if (parent && !this.directories.has(parent)) {
      throw new Deno.errors.NotFound(`No such file or directory (os error 2): ${parent}`);
    }
  }

  async mkdir(path: string): Promise<void> {
    this.createCalls++;
    if (this.denyEverything || this.denyMkdir) this.deny(path);
    if (this.directories.has(path) || this.files.has(path)) {
      throw new Deno.errors.AlreadyExists(`File exists (os error 17): ${path}`);
    }
    this.ensureParent(path);
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

  async writeTextFile(path: string, data: string, options?: { createNew?: boolean }): Promise<void> {
    if (this.denyEverything) this.deny(path);
    if (this.denyHolderCreate && path.endsWith("/holder") && options?.createNew) this.deny(path);
    if (options?.createNew && (this.files.has(path) || this.directories.has(path))) {
      throw new Deno.errors.AlreadyExists(`File exists (os error 17): ${path}`);
    }
    this.ensureParent(path);
    this.files.set(path, { content: data, mtime: Date.now() });
    if (options?.createNew && path.endsWith("/holder") && this.afterHolderCreate) {
      const hook = this.afterHolderCreate;
      this.afterHolderCreate = null;
      hook();
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.denyEverything) this.deny(oldPath);
    if (this.denyRename) this.deny(oldPath);
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
    // Move children too: legacy lock directories hold files.
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
    this.removeCalls.push(path);
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

  tombstones(): string[] {
    return [...this.files.keys()].filter(path => path.includes("/holder.broken-"));
  }
}

const LOCK_PATH = "/share/jobs_data.json.lock";
const HOLDER_PATH = `${LOCK_PATH}/holder`;
const OWNER_PATH = `${LOCK_PATH}/owner.json`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

Deno.test("lock: the claim is a file and the folder survives the release", async () => {
  const fs = new FakeFs();
  const log: string[] = [];

  const release = await acquireDataLock(options(fs, log));

  assert(fs.directories.has(LOCK_PATH), "The lock folder must exist");
  const claim = JSON.parse(await fs.readTextFile(HOLDER_PATH));
  equal(claim.operation, "merge");
  assert(claim.token && claim.created, "The holder must carry a token and timestamp");
  equal(JSON.parse(await fs.readTextFile(OWNER_PATH)).token, claim.token);

  await release();
  assert(fs.directories.has(LOCK_PATH), "The permanent lock folder must never be removed");
  equal(fs.files.has(HOLDER_PATH), false);
  equal(fs.files.has(OWNER_PATH), false);
  assert(!fs.removeCalls.includes(LOCK_PATH), "Release must not remove the folder itself");
});

Deno.test("lock: a second client waits for the holder and proceeds after release", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  const first = await acquireDataLock(options(fs, log));

  let secondReady = false;
  const secondPromise = acquireDataLock(options(fs, log)).then(release => {
    secondReady = true;
    return release;
  });
  await sleep(30);
  equal(secondReady, false);

  await first();
  const second = await secondPromise;
  assert(secondReady, "The second client must acquire after the release");
  const claim = JSON.parse(await fs.readTextFile(HOLDER_PATH));
  equal(claim.operation, "merge");
  await second();
});

Deno.test("lock: a stale claim is renamed aside and the folder stays", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  const old = Date.now() - 300000;
  fs.directories.add(LOCK_PATH);
  fs.directoryMtimes.set(LOCK_PATH, old);
  fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "old" }), mtime: old });
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ token: "old", host: "other" }), mtime: old });

  const release = await acquireDataLock(options(fs, log));

  assert(log.some(line => line.includes("reclaimed as stale")), "The reclaim must be logged");
  assert(log.some(line => line.includes("method=renamed")), "The stale claim must be renamed, not deleted in place");
  const claim = JSON.parse(await fs.readTextFile(HOLDER_PATH));
  assert(claim.token !== "old", "The stale claim must be replaced");
  assert(fs.tombstones().length === 0, "The tombstone must be cleaned up");
  assert(fs.directories.has(LOCK_PATH), "The folder must stay");

  await release();
});

Deno.test("lock: a lock whose owner heartbeat is fresh is never mistaken for stale", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  // The claim timestamp looks ancient (network shares cache attributes), but
  // the owner keeps refreshing its heartbeat.
  fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "other" }), mtime: Date.now() - 600000 });
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ token: "other", host: "other" }), mtime: Date.now() });

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 300 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("Timed out waiting for shared data lock"), `Unexpected failure: ${failure}`);
  assert(fs.files.has(HOLDER_PATH), "A live lock must not be reclaimed");
  assert(failure.includes("observedOwner="), "The timeout must name the lock owner");
  assert(failure.includes("lockState=present"), "The timeout must report the lock state");
});

Deno.test("lock: an old heartbeat cannot make a fresh claim look stale", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  // owner.json is left over from the previous owner; the holder is new.
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ token: "previous" }), mtime: Date.now() - 600000 });
  fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "current" }), mtime: Date.now() });

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 300 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("Timed out waiting for shared data lock"), `Unexpected failure: ${failure}`);
  assert(fs.files.has(HOLDER_PATH), "A fresh claim must not be reclaimed because of an old heartbeat");
  equal(JSON.parse(await fs.readTextFile(HOLDER_PATH)).token, "current");
});

Deno.test("lock: a leftover heartbeat from this protocol does not block the next claim", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  // A release that removed the holder but not the heartbeat leaves this state.
  fs.directories.add(LOCK_PATH);
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ protocol: 2, token: "previous" }), mtime: Date.now() });

  const release = await acquireDataLock(options(fs, log, { maxWaitMs: 1000 }));
  assert(fs.files.has(HOLDER_PATH), "A new-protocol heartbeat without a holder must not block");
  await release();
});

Deno.test("lock: a refused claim with no holder present reports the share, not a lock", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.denyHolderCreate = true;
  const probes: string[] = [];

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, {
      maxWaitMs: 300,
      probeWritable: async () => {
        probes.push("called");
        return "denied";
      },
    }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("lockState=missing"), `Unexpected failure: ${failure}`);
  assert(failure.includes("probe=denied"), "A share that refuses everything must be reported as such");
  assert(probes.length === 1, "The writability probe must be cached, not repeated on every retry");
});

Deno.test("lock: a missing folder is created once and kept", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add("/share");

  const release = await acquireDataLock(options(fs, log));
  assert(fs.directories.has(LOCK_PATH), "The lock folder must be created on first use");
  assert(log.some(line => line.includes("Created shared data lock folder")), "Creating the folder must be logged");
  await release();

  const again = await acquireDataLock(options(fs, log));
  await again();
  assert(fs.directories.has(LOCK_PATH), "The folder must stay after the second use");
});

Deno.test("lock: an empty claim left by a failed create is reclaimed without the full stale wait", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.files.set(HOLDER_PATH, { content: "", mtime: Date.now() - 60000 });

  const started = Date.now();
  const release = await acquireDataLock(options(fs, log, { staleMs: 120000, emptyClaimMs: 30000 }));

  assert(Date.now() - started < 1000, "An abandoned claim must not wait for the stale period");
  assert(log.some(line => line.includes("abandoned (empty claim)")), "The reclaim must be logged as abandoned");
  assert(JSON.parse(await fs.readTextFile(HOLDER_PATH)).token, "The new claim must carry a token");
  equal(fs.tombstones().length, 0);
  await release();
});

Deno.test("lock: a fresh empty claim is still respected", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.files.set(HOLDER_PATH, { content: "", mtime: Date.now() });

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 200, emptyClaimMs: 30000 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("Timed out"), `A claim being written must be waited for: ${failure}`);
  equal(fs.files.get(HOLDER_PATH)?.content, "");
  assert(!log.some(line => line.includes("reclaimed")), "A fresh empty claim must not be reclaimed");
});

Deno.test("lock: a claim taken over right after create is not used", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  // Another client moves our claim aside and takes the lock in the same instant.
  fs.afterHolderCreate = () => {
    fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "other", protocol: 2 }), mtime: Date.now() });
    fs.files.set(OWNER_PATH, { content: JSON.stringify({ token: "other", protocol: 2 }), mtime: Date.now() });
  };

  let acquired = false;
  const pending = acquireDataLock(options(fs, log)).then(release => {
    acquired = true;
    return release;
  });
  await sleep(30);
  equal(acquired, false);
  assert(log.some(line => line.includes("not confirmed after create")), "The lost claim must be logged");

  // The other client releases.
  fs.files.delete(OWNER_PATH);
  fs.files.delete(HOLDER_PATH);
  const release = await pending;
  assert(JSON.parse(await fs.readTextFile(HOLDER_PATH)).token !== "other", "The claim must be ours after the release");
  await release();
});

Deno.test("lock: a share that refuses folder creation fails fast with a setup message", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add("/share");
  fs.denyMkdir = true;
  const probes: string[] = [];

  const started = Date.now();
  let failure = "";
  try {
    await acquireDataLock(options(fs, log, {
      maxWaitMs: 5000,
      probeWritable: async () => {
        probes.push("called");
        return "ok";
      },
    }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const elapsed = Date.now() - started;

  assert(failure.includes("Shared data lock folder"), `Unexpected failure: ${failure}`);
  assert(failure.includes("create it once on the file server"), "The error must explain the one-time folder");
  assert(elapsed < 1000, `The setup error must not wait for the lock timeout (waited ${elapsed}ms)`);
  equal(probes, ["called"]);
  equal(fs.directories.has(LOCK_PATH), false);
});

Deno.test("lock: a failed reclaim rename never deletes a live claim", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  const old = Date.now() - 300000;
  fs.directories.add(LOCK_PATH);
  fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "old" }), mtime: old });
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ token: "old" }), mtime: old });
  fs.denyRename = true;

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 300 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("Timed out waiting for shared data lock"), `Unexpected failure: ${failure}`);
  assert(fs.files.has(HOLDER_PATH), "A failed rename must leave the claim alone");
  assert(!fs.removeCalls.includes(HOLDER_PATH), "A failed rename must never fall back to deleting the claim");
  assert(log.some(line => line.includes("waiting instead of deleting")), "The refusal must be logged");
});

Deno.test("lock: release leaves a claim that changed hands", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  const release = await acquireDataLock(options(fs, log));

  fs.files.set(HOLDER_PATH, { content: JSON.stringify({ token: "someone-else" }), mtime: Date.now() });
  await release();

  assert(fs.files.has(HOLDER_PATH), "A release must not remove another owner's claim");
  assert(log.some(line => line.includes("release skipped")), "The skipped release must be logged");
});

Deno.test("lock: a fresh legacy folder lock is honoured", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ host: "old-version" }), mtime: Date.now() });

  let failure = "";
  try {
    await acquireDataLock(options(fs, log, { maxWaitMs: 300 }));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  assert(failure.includes("lockState=legacy"), `Unexpected failure: ${failure}`);
  assert(!fs.files.has(HOLDER_PATH), "A live old-version lock must not be taken over");
});

Deno.test("lock: a stale legacy folder lock is taken over", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add(LOCK_PATH);
  fs.files.set(OWNER_PATH, { content: JSON.stringify({ host: "old-version" }), mtime: Date.now() - 300000 });

  const release = await acquireDataLock(options(fs, log));

  assert(log.some(line => line.includes("replacing legacy lock")), "The legacy takeover must be logged");
  assert(fs.files.has(HOLDER_PATH), "The new claim must exist");
  await release();
});

Deno.test("lock: a folder removed by an old client is recreated", async () => {
  const fs = new FakeFs();
  const log: string[] = [];
  fs.directories.add("/share");
  const first = await acquireDataLock(options(fs, log));
  await first();

  // 0.3.10 reclaims and removes the whole directory when it releases.
  fs.directories.delete(LOCK_PATH);
  fs.directoryMtimes.delete(LOCK_PATH);

  const second = await acquireDataLock(options(fs, log));
  assert(fs.directories.has(LOCK_PATH), "The folder must be recreated");
  assert(fs.files.has(HOLDER_PATH), "The claim must be recreated");
  await second();
});

Deno.test("lock release retries transient shared-drive deletion failures", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/holder`;
  await Deno.writeTextFile(path, "{}");
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
    // The next save can claim the same name immediately.
    await Deno.writeTextFile(path, "{}");
    await releaseDataLock(path);
    await releaseDataLock(path); // Already removed is successful cleanup.
  } finally {
    Deno.remove = remove;
    await remove(dir, { recursive: true });
  }
});

Deno.test("lock release confirms the claim is gone before reporting success", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/holder`;
  await Deno.writeTextFile(path, "{}");
  // A share can report a successful deletion while the name is still in a
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
    assert(lingeringRemovals <= 0, "Release must keep retrying while the claim lingers");
    assert(log.some(line => line.includes("still present after removal")), "A lingering removal must be logged");
    assert(!(await exists(path)), "Release must not report success while the claim is still there");
  } finally {
    Deno.remove = remove;
    await remove(dir, { recursive: true });
  }
});

// Exclusive locking for the shared data file.
//
// The lock is a directory created next to jobs_data.json, holding an
// owner.json that also acts as a heartbeat. Two network-share behaviours shape
// this code:
//   1. A create can fail with ACCESS_DENIED, not ALREADY_EXISTS, while the
//      lock directory is pending deletion or sits in the client's attribute
//      cache. A refused create therefore has to be inspected, never merely
//      retried, or one stranded lock directory pins every client forever.
//   2. Removal can resolve while the directory is still there. Release has to
//      confirm the path is gone before the next save may proceed.
//
// Stale locks are broken by renaming them to a unique tombstone, so only one
// waiting client can win the race and no client ever deletes a lock another
// client has just acquired.

export const LOCK_DEFAULTS = {
  maxWaitMs: 90_000,
  staleMs: 120_000,
  heartbeatMs: 5_000,
  progressMs: 15_000,
  releaseRetryMs: 50,
  releaseAttempts: 8,
};

export type LockProbe = "unknown" | "ok" | "denied";

export interface LockFs {
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ mtime: Date | null }>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export type LockLog = (message: string) => void;

export interface AcquireLockOptions {
  path: string;
  operation: string;
  /** Identity recorded in owner.json, e.g. pid, host and version. */
  owner?: Record<string, unknown>;
  fs?: LockFs;
  log?: LockLog;
  logError?: LockLog;
  maxWaitMs?: number;
  staleMs?: number;
  heartbeatMs?: number;
  progressMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  /** Confirms the data directory is writable, so a share outage is reported
   *  differently from a lock directory that is merely hard to reclaim. */
  probeWritable?: () => Promise<LockProbe>;
}

export const TOMBSTONE_MARKER = ".broken-";

export function lockTombstonePrefix(dataFileName: string): string {
  return `${dataFileName}.lock${TOMBSTONE_MARKER}`;
}

const holders = new Map<string, { operation: string; acquired: number }>();

export function heldLockHolders(): Array<{ operation: string; heldMs: number }> {
  const now = Date.now();
  return [...holders.values()].map(holder => ({
    operation: holder.operation,
    heldMs: now - holder.acquired,
  }));
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function ownerPath(path: string): string {
  return `${path}/owner.json`;
}

// Shared drives may temporarily refuse deletion while closing file handles.
// Await cleanup before allowing the request to finish, and verify the path is
// really gone: a successful delete can still leave the directory in a state
// that refuses later creates.
export async function releaseDataLock(
  path: string,
  options: { fs?: LockFs; attempts?: number; log?: LockLog } = {},
): Promise<void> {
  const fs = options.fs ?? Deno;
  const attempts = options.attempts ?? LOCK_DEFAULTS.releaseAttempts;
  let lastFailure: unknown = new Error(`lock path "${path}" is still present`);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.remove(path, { recursive: true });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      lastFailure = error;
      if (attempt < attempts - 1) {
        await sleep(LOCK_DEFAULTS.releaseRetryMs * 2 ** attempt);
        continue;
      }
      break;
    }
    try {
      await fs.stat(path);
      lastFailure = new Error(`lock path "${path}" is still present after removal`);
      options.log?.(`Shared data lock path still present after removal (attempt ${attempt + 1}): "${path}"`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      lastFailure = error;
    }
    if (attempt < attempts - 1) await sleep(LOCK_DEFAULTS.releaseRetryMs * 2 ** attempt);
  }
  throw lastFailure;
}

async function lockDirectoryExists(fs: LockFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

interface LockObservation {
  /** Age of the newest evidence of life: the heartbeat when present. */
  ageMs: number;
  /** Age of the lock directory itself (used for clock-skew reporting). */
  dirAgeMs: number;
  owner: string;
}

async function observeLock(fs: LockFs, path: string): Promise<LockObservation> {
  const stat = await fs.stat(path);
  const now = Date.now();
  const dirAgeMs = now - (stat.mtime?.getTime() ?? now);
  let ageMs = dirAgeMs;
  let owner = "missing";
  try {
    const ownerStat = await fs.stat(ownerPath(path));
    owner = (await fs.readTextFile(ownerPath(path))).slice(0, 2048);
    // Require both the directory and the heartbeat to look stale before
    // reclaiming, so a live holder is never mistaken for a dead one.
    ageMs = Math.min(dirAgeMs, now - (ownerStat.mtime?.getTime() ?? now));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { ageMs, dirAgeMs, owner };
}

async function breakStaleLock(fs: LockFs, path: string, logError: LockLog): Promise<string> {
  const tombstone = `${path}${TOMBSTONE_MARKER}${Date.now()}-${crypto.randomUUID()}`;
  try {
    await fs.rename(path, tombstone);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "already-removed";
    logError(`Shared data lock rename to "${tombstone}" failed, falling back to removal: ${error}`);
    try {
      await fs.remove(path, { recursive: true });
      return "removed";
    } catch (removeError) {
      if (removeError instanceof Deno.errors.NotFound) return "already-removed";
      logError(`Shared data lock reclaim failed for "${path}": ${removeError}`);
      return "failed";
    }
  }
  try {
    await releaseDataLock(tombstone, { fs, attempts: 3, log: logError });
  } catch (error) {
    logError(`Shared data lock tombstone cleanup failed for "${tombstone}": ${error}`);
  }
  return "renamed";
}

export async function acquireDataLock(options: AcquireLockOptions): Promise<() => Promise<void>> {
  const fs = options.fs ?? Deno;
  const log = options.log ?? (() => {});
  const logError = options.logError ?? log;
  const maxWaitMs = options.maxWaitMs ?? LOCK_DEFAULTS.maxWaitMs;
  const staleMs = options.staleMs ?? LOCK_DEFAULTS.staleMs;
  const heartbeatMs = options.heartbeatMs ?? LOCK_DEFAULTS.heartbeatMs;
  const progressMs = options.progressMs ?? LOCK_DEFAULTS.progressMs;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 1000;
  const path = options.path;
  const started = Date.now();

  let attempts = 0;
  let lastFailure = "none";
  let lockState = "unknown";
  let observedAge: number | null = null;
  let observedOwner = "unavailable";
  let probe: LockProbe = "unknown";
  let lastProgress = started;
  let lastClockWarning = 0;

  const backoff = () => {
    const base = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** Math.min(attempts - 1, 4));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  };

  const reportProgress = (details: string[]) => {
    const now = Date.now();
    if (now - lastProgress < progressMs) return;
    lastProgress = now;
    log(`Shared data lock still unavailable after ${now - started}ms: operation=${options.operation} path="${path}" ${details.join(" ")}`);
  };

  const engage = async (): Promise<() => Promise<void>> => {
    const token = crypto.randomUUID();
    const acquired = Date.now();
    holders.set(token, { operation: options.operation, acquired });
    const writeOwner = () => fs.writeTextFile(ownerPath(path), JSON.stringify({
      ...options.owner,
      operation: options.operation,
      token,
      created: acquired,
      heartbeat: Date.now(),
    }));
    try {
      await writeOwner();
    } catch (error) {
      logError(`Shared data lock owner metadata write failed: operation=${options.operation} path="${path}": ${error}`);
    }
    // The heartbeat keeps owner.json fresh on the share, so a slow but live
    // operation is never mistaken for a stranded lock.
    const heartbeat = setInterval(() => {
      writeOwner().catch(error => logError(`Shared data lock heartbeat failed: operation=${options.operation} token=${token}: ${error}`));
    }, heartbeatMs);
    const slowLockTimer = setTimeout(() => {
      logError(`Shared data lock held for ${Date.now() - acquired}ms: operation=${options.operation} path="${path}" token=${token}`);
    }, maxWaitMs);
    return async () => {
      clearInterval(heartbeat);
      try {
        await releaseDataLock(path, { fs, log: logError });
      } catch (error) {
        logError(`Shared data lock release failed for "${path}" after retries: operation=${options.operation} token=${token}: ${error}`);
      } finally {
        clearTimeout(slowLockTimer);
        holders.delete(token);
        if (Date.now() - acquired >= maxWaitMs) {
          logError(`Shared data lock operation finished after ${Date.now() - acquired}ms: operation=${options.operation} token=${token}`);
        }
      }
    };
  };

  while (Date.now() - started < maxWaitMs) {
    attempts++;
    try {
      await fs.mkdir(path);
      return await engage();
    } catch (error) {
      lastFailure = `mkdir: ${error}`;
      const denied = error instanceof Deno.errors.PermissionDenied;
      if (!denied && !(error instanceof Deno.errors.AlreadyExists)) throw error;

      // A refused create still means the lock may be sitting right there.
      const present = await lockDirectoryExists(fs, path);
      lockState = present ? "present" : "missing";
      if (!present) {
        if (probe === "unknown" && options.probeWritable) probe = await options.probeWritable();
        reportProgress([`lockState=${lockState}`, `lastFailure=${lastFailure}`, `probe=${probe}`]);
        await sleep(backoff());
        continue;
      }

      let observation: LockObservation;
      try {
        observation = await observeLock(fs, path);
      } catch (inspectError) {
        lastFailure = `inspect stale lock: ${inspectError}`;
        if (inspectError instanceof Deno.errors.NotFound) continue;
        if (inspectError instanceof Deno.errors.PermissionDenied) {
          reportProgress([`lockState=${lockState}`, `lastFailure=${lastFailure}`, `probe=${probe}`]);
          await sleep(backoff());
          continue;
        }
        throw inspectError;
      }
      observedAge = observation.ageMs;
      observedOwner = observation.owner;
      if (observation.dirAgeMs < -staleMs) {
        // A future timestamp means the owning computer's clock is ahead;
        // never reclaim based on it, only report it.
        const now = Date.now();
        if (now - lastClockWarning > progressMs) {
          lastClockWarning = now;
          logError(`Shared data lock timestamp is ${-observation.dirAgeMs}ms in the future: path="${path}" owner=${observedOwner}`);
        }
      }
      if (observation.ageMs > staleMs) {
        const method = await breakStaleLock(fs, path, logError);
        if (method === "failed") {
          logError(`Shared data lock could not be reclaimed as stale: path="${path}" owner=${observedOwner}`);
        } else {
          log(`Shared data lock reclaimed as stale after ${observation.ageMs}ms: path="${path}" owner=${observedOwner} method=${method}`);
        }
        continue;
      }
      reportProgress([
        `lockState=${lockState}`,
        `observedAgeMs=${observation.ageMs}`,
        `observedOwner=${observedOwner}`,
        `lastFailure=${lastFailure}`,
      ]);
      await sleep(backoff());
    }
  }

  throw new Error(
    `Timed out waiting for shared data lock "${path}"; operation=${options.operation};` +
    ` waitedMs=${Date.now() - started}; attempts=${attempts}; lockState=${lockState};` +
    ` observedAgeMs=${observedAge}; observedOwner=${observedOwner}; lastFailure=${lastFailure};` +
    ` probe=${probe}; localHolders=${JSON.stringify(heldLockHolders())}`,
  );
}
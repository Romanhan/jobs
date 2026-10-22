// Exclusive locking for the shared data file.
//
// The lock is a permanent directory created next to jobs_data.json. The claim
// itself is a file inside it, created with CREATE_NEW, because some network
// shares allow creating files but refuse to create directories: the old code
// made the directory the claim, so one refused mkdir blocked every save while
// a file write in the same folder kept succeeding.
//
// What the folder holds:
//   holder       exclusive claim; its content names the owner and the token
//   owner.json   heartbeat, rewritten every few seconds by the live owner
//
// Two network-share behaviours still shape this code:
//   1. A create can fail with ACCESS_DENIED, not ALREADY_EXISTS, while a name
//      is pending deletion. A refused create therefore has to be inspected,
//      never merely retried.
//   2. Removal can resolve while the path is still there. Release has to
//      confirm the path is gone before the next save may proceed.
//
// Stale claims are broken by renaming the holder to a unique tombstone, so
// only one waiting client can win the race and no client ever deletes a claim
// another client has just acquired. The folder itself is never removed: a
// client that only knows the old protocol would otherwise delete it again.

export const LOCK_DEFAULTS = {
  maxWaitMs: 90_000,
  staleMs: 120_000,
  heartbeatMs: 5_000,
  progressMs: 15_000,
  // A holder still empty this long after its creation, with no heartbeat, was
  // left by a client that failed between creating the file and writing its
  // claim. A live owner writes both within milliseconds.
  emptyClaimMs: 30_000,
  releaseRetryMs: 50,
  releaseAttempts: 8,
};

export const HOLDER_NAME = "holder";
export const OWNER_NAME = "owner.json";
export const HOLDER_TOMBSTONE_PREFIX = `${HOLDER_NAME}.broken-`;

// Written into the claim and heartbeat. A heartbeat without it belongs to
// 0.3.10 or older, which holds the folder itself rather than a file.
export const LOCK_PROTOCOL = 2;

export type LockProbe = "unknown" | "ok" | "denied";

export interface LockFs {
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ mtime: Date | null }>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string, options?: { createNew?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export type LockLog = (message: string) => void;

export interface AcquireLockOptions {
  /** The permanent lock directory, e.g. jobs_data.json.lock. */
  path: string;
  operation: string;
  /** Identity recorded in the holder and heartbeat, e.g. pid, host and version. */
  owner?: Record<string, unknown>;
  fs?: LockFs;
  log?: LockLog;
  logError?: LockLog;
  maxWaitMs?: number;
  staleMs?: number;
  emptyClaimMs?: number;
  heartbeatMs?: number;
  progressMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  /** Confirms the data directory is writable, so a missing folder is reported
   *  differently from a lock that is merely hard to reclaim. */
  probeWritable?: () => Promise<LockProbe>;
}

export const TOMBSTONE_MARKER = ".broken-";

/** Tombstones of the old directory lock, left next to the data file. */
export function lockTombstonePrefix(dataFileName: string): string {
  return `${dataFileName}.lock${TOMBSTONE_MARKER}`;
}

export function lockHolderPath(lockDir: string): string {
  return `${lockDir}/${HOLDER_NAME}`;
}

export function lockOwnerPath(lockDir: string): string {
  return `${lockDir}/${OWNER_NAME}`;
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

// Shared drives may temporarily refuse deletion while closing file handles.
// Await cleanup before allowing the request to finish, and verify the path is
// really gone: a successful delete can still leave a name in a state that
// refuses later creates.
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

async function pathExists(fs: LockFs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Creating the folder is a one-time deployment step, not part of the claim.
// It is retried here so an existing installation upgrades on its own, and a
// share that refuses folder creation gets a clear error instead of 90 s of
// waiting for a lock that can never exist.
const preparedLockDirs = new Set<string>();

async function ensureLockDirectory(
  fs: LockFs,
  path: string,
  runProbe: () => Promise<LockProbe>,
  log: LockLog,
): Promise<void> {
  if (preparedLockDirs.has(path)) return;
  try {
    await fs.stat(path);
    preparedLockDirs.add(path);
    return;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      const probe = await runProbe();
      throw new Error(`Shared data lock folder "${path}" is unreadable: ${error}; data folder probe=${probe}`);
    }
  }
  try {
    await fs.mkdir(path);
    preparedLockDirs.add(path);
    log(`Created shared data lock folder: "${path}"`);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      preparedLockDirs.add(path);
      return;
    }
    if (error instanceof Deno.errors.PermissionDenied) {
      const probe = await runProbe();
      const reason = probe === "ok"
        ? "the share allows files but refuses to create this folder; create it once on the file server next to the data file"
        : `the data folder is not writable (probe=${probe})`;
      throw new Error(`Shared data lock folder "${path}" is unavailable: ${error}; ${reason}`);
    }
    throw error;
  }
}

interface LockObservation {
  /** Age of the newest evidence of life: the heartbeat when it belongs to this claim. */
  ageMs: number;
  /** Age of the claim file itself (used for clock-skew reporting). */
  claimAgeMs: number;
  owner: string;
  token: string | null;
  /** Token written in the holder itself; null while it is empty or unreadable. */
  holderToken: string | null;
}

function readToken(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { token?: unknown };
    return typeof parsed?.token === "string" ? parsed.token : null;
  } catch {
    return null;
  }
}

async function observeLock(fs: LockFs, lockDir: string): Promise<LockObservation> {
  const holderPath = lockHolderPath(lockDir);
  const holderStat = await fs.stat(holderPath);
  const holderToken = readToken(await fs.readTextFile(holderPath));
  const now = Date.now();
  const claimAgeMs = now - (holderStat.mtime?.getTime() ?? now);
  let ageMs = claimAgeMs;
  let owner = "missing";
  let token: string | null = null;
  try {
    const ownerStat = await fs.stat(lockOwnerPath(lockDir));
    const text = await fs.readTextFile(lockOwnerPath(lockDir));
    owner = text.slice(0, 2048);
    token = readToken(text);
    // Require both the claim and the heartbeat to look stale before
    // reclaiming. A heartbeat older than the claim belongs to the previous
    // owner and must not shorten the new claim's life.
    const holderMtime = holderStat.mtime?.getTime();
    const ownerMtime = ownerStat.mtime?.getTime();
    if (ownerMtime !== undefined && (holderMtime === undefined || ownerMtime >= holderMtime)) {
      ageMs = Math.min(claimAgeMs, now - ownerMtime);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return { ageMs, claimAgeMs, owner, token, holderToken };
}

// A 0.3.10 client (or older) claims the folder itself and only writes
// owner.json. Respect its heartbeat so both versions can wait on each other
// during a staged upgrade; never take the folder over while it is fresh. A
// heartbeat written by this protocol is not a legacy lock: it is left over
// from a release whose cleanup only partly finished, and must not block.
async function observeLegacyOwner(
  fs: LockFs,
  lockDir: string,
  staleMs: number,
): Promise<{ fresh: boolean; stale: boolean; ageMs: number }> {
  try {
    const stat = await fs.stat(lockOwnerPath(lockDir));
    const ageMs = Date.now() - (stat.mtime?.getTime() ?? Date.now());
    let protocol = 0;
    try {
      const parsed = JSON.parse(await fs.readTextFile(lockOwnerPath(lockDir))) as { protocol?: unknown };
      protocol = typeof parsed?.protocol === "number" ? parsed.protocol : 0;
    } catch { /* unreadable metadata is treated as legacy */ }
    if (protocol >= LOCK_PROTOCOL) return { fresh: false, stale: false, ageMs };
    return { fresh: ageMs <= staleMs, stale: ageMs > staleMs, ageMs };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { fresh: false, stale: false, ageMs: 0 };
    throw error;
  }
}

async function breakStaleClaim(
  fs: LockFs,
  lockDir: string,
  staleToken: string | null,
  logError: LockLog,
): Promise<string> {
  const holderPath = lockHolderPath(lockDir);
  const tombstone = `${holderPath}.broken-${Date.now()}-${crypto.randomUUID()}`;
  try {
    await fs.rename(holderPath, tombstone);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "already-removed";
    // A failed rename means another client may already be taking the claim.
    // Deleting the path here could remove a live lock, so wait instead.
    logError(`Shared data lock reclaim rename to "${tombstone}" failed, waiting instead of deleting: ${error}`);
    return "failed";
  }
  try {
    const ownerText = await fs.readTextFile(lockOwnerPath(lockDir));
    if (staleToken === null || readToken(ownerText) === staleToken) {
      await fs.remove(lockOwnerPath(lockDir));
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      logError(`Shared data lock heartbeat cleanup failed for "${lockOwnerPath(lockDir)}": ${error}`);
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
  const emptyClaimMs = options.emptyClaimMs ?? LOCK_DEFAULTS.emptyClaimMs;
  const heartbeatMs = options.heartbeatMs ?? LOCK_DEFAULTS.heartbeatMs;
  const progressMs = options.progressMs ?? LOCK_DEFAULTS.progressMs;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 100;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 1000;
  const lockDir = options.path;
  const holderPath = lockHolderPath(lockDir);
  const started = Date.now();

  let attempts = 0;
  let lastFailure = "none";
  let lockState = "unknown";
  let observedAge: number | null = null;
  let observedOwner = "unavailable";
  let probe: LockProbe = "unknown";
  let probeChecked = false;
  let lastProgress = started;
  let lastClockWarning = 0;

  const runProbe = async (): Promise<LockProbe> => {
    if (!probeChecked) {
      probeChecked = true;
      if (options.probeWritable) probe = await options.probeWritable();
    }
    return probe;
  };

  const backoff = () => {
    const base = Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** Math.min(attempts - 1, 4));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  };

  const reportProgress = (details: string[]) => {
    const now = Date.now();
    if (now - lastProgress < progressMs) return;
    lastProgress = now;
    log(`Shared data lock still unavailable after ${now - started}ms: operation=${options.operation} path="${lockDir}" ${details.join(" ")}`);
  };

  const engage = async (token: string, claim: Record<string, unknown>): Promise<() => Promise<void>> => {
    const acquired = Date.now();
    holders.set(token, { operation: options.operation, acquired });
    // The heartbeat keeps owner.json fresh on the share, so a slow but live
    // operation is never mistaken for a stranded lock. It only rewrites the
    // heartbeat while this client still owns the claim, so a process that
    // wakes up after its lock was reclaimed cannot overwrite the new owner.
    const writeOwner = async () => {
      try {
        const current = await fs.readTextFile(holderPath);
        if (readToken(current) !== token) return;
        await fs.writeTextFile(lockOwnerPath(lockDir), JSON.stringify({ ...claim, heartbeat: Date.now() }));
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        logError(`Shared data lock heartbeat failed: operation=${options.operation} token=${token}: ${error}`);
      }
    };
    await writeOwner();
    const heartbeat = setInterval(() => {
      void writeOwner();
    }, heartbeatMs);
    const slowLockTimer = setTimeout(() => {
      logError(`Shared data lock held for ${Date.now() - acquired}ms: operation=${options.operation} path="${lockDir}" token=${token}`);
    }, maxWaitMs);
    return async () => {
      clearInterval(heartbeat);
      try {
        let current: string | null = null;
        try {
          current = await fs.readTextFile(holderPath);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        if (current === null) {
          logError(`Shared data lock was already released: operation=${options.operation} path="${holderPath}" token=${token}`);
        } else if (readToken(current) !== token) {
          logError(`Shared data lock release skipped, the claim changed: operation=${options.operation} path="${holderPath}" token=${token}`);
        } else {
          // Remove the heartbeat first: deleting the claim first would let the
          // next owner write its heartbeat before this cleanup ran.
          try {
            await fs.remove(lockOwnerPath(lockDir));
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) {
              logError(`Shared data lock heartbeat removal failed for "${lockOwnerPath(lockDir)}": ${error}`);
            }
          }
          await releaseDataLock(holderPath, { fs, log: logError });
        }
      } catch (error) {
        logError(`Shared data lock release failed for "${holderPath}" after retries: operation=${options.operation} token=${token}: ${error}`);
      } finally {
        clearTimeout(slowLockTimer);
        holders.delete(token);
        if (Date.now() - acquired >= maxWaitMs) {
          logError(`Shared data lock operation finished after ${Date.now() - acquired}ms: operation=${options.operation} token=${token}`);
        }
      }
    };
  };

  await ensureLockDirectory(fs, lockDir, runProbe, log);

  while (Date.now() - started < maxWaitMs) {
    attempts++;

    // A 0.3.10 client claims the folder itself and only leaves owner.json.
    // While that heartbeat is fresh the folder is held; otherwise the claim
    // file below is created while the stale metadata is replaced by ours.
    if (!(await pathExists(fs, holderPath))) {
      const legacy = await observeLegacyOwner(fs, lockDir, staleMs);
      if (legacy.fresh) {
        lockState = "legacy";
        observedAge = legacy.ageMs;
        reportProgress([`lockState=${lockState}`, `observedAgeMs=${observedAge}`, `lastFailure=${lastFailure}`]);
        await sleep(backoff());
        continue;
      }
      if (legacy.stale) {
        log(`Shared data lock replacing legacy lock after ${legacy.ageMs}ms: path="${lockDir}"`);
      }
    }

    const token = crypto.randomUUID();
    const claim = {
      ...options.owner,
      protocol: LOCK_PROTOCOL,
      operation: options.operation,
      token,
      created: Date.now(),
      heartbeat: Date.now(),
    };
    try {
      await fs.writeTextFile(holderPath, JSON.stringify(claim), { createNew: true });
      // Confirm the claim on the share carries this token before acting as the
      // owner: if it was moved aside between the create and the write, another
      // client may own the lock now. A failed read proves nothing either way,
      // and abandoning our own claim would stall every save for the stale
      // period, so only a different claim or a missing one backs off.
      let confirmed = true;
      try {
        confirmed = readToken(await fs.readTextFile(holderPath)) === token;
      } catch (readError) {
        if (readError instanceof Deno.errors.NotFound) confirmed = false;
      }
      if (!confirmed) {
        lastFailure = "claim not confirmed after create";
        logError(`Shared data lock claim was not confirmed after create, retrying: path="${holderPath}" token=${token}`);
        await sleep(backoff());
        continue;
      }
      return await engage(token, claim);
    } catch (error) {
      lastFailure = `create holder: ${error}`;
      if (error instanceof Deno.errors.NotFound) {
        // An old client can still remove the permanent folder when it reclaims
        // its own directory lock. Recreate it and try again.
        preparedLockDirs.delete(lockDir);
        await ensureLockDirectory(fs, lockDir, runProbe, log);
        continue;
      }
      const denied = error instanceof Deno.errors.PermissionDenied;
      if (!denied && !(error instanceof Deno.errors.AlreadyExists)) throw error;

      const present = await pathExists(fs, holderPath);
      if (!present) {
        lockState = "missing";
        const probeValue = await runProbe();
        reportProgress([`lockState=${lockState}`, `lastFailure=${lastFailure}`, `probe=${probeValue}`]);
        await sleep(backoff());
        continue;
      }

      lockState = "present";
      let observation: LockObservation;
      try {
        observation = await observeLock(fs, lockDir);
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
      if (observation.claimAgeMs < -staleMs) {
        // A future timestamp means the owning computer's clock is ahead;
        // never reclaim based on it, only report it.
        const now = Date.now();
        if (now - lastClockWarning > progressMs) {
          lastClockWarning = now;
          logError(`Shared data lock timestamp is ${-observation.claimAgeMs}ms in the future: path="${holderPath}" owner=${observedOwner}`);
        }
      }
      // An empty holder without a heartbeat is a claim whose creator failed
      // before writing it; waiting the full stale period would stall saves.
      const abandoned = observation.holderToken === null && observation.owner === "missing" &&
        observation.claimAgeMs > emptyClaimMs;
      if (observation.ageMs > staleMs || abandoned) {
        // An abandoned claim has no heartbeat of its own, so pass a token that
        // never matches: a heartbeat appearing meanwhile belongs to a new owner.
        const method = await breakStaleClaim(fs, lockDir, abandoned ? "" : observation.token, logError);
        if (method === "failed") {
          logError(`Shared data lock could not be reclaimed as stale: path="${holderPath}" owner=${observedOwner}`);
        } else {
          log(`Shared data lock reclaimed as ${abandoned ? "abandoned (empty claim)" : "stale"} after ${observation.claimAgeMs}ms: path="${holderPath}" owner=${observedOwner} method=${method}`);
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
    `Timed out waiting for shared data lock "${lockDir}"; operation=${options.operation};` +
    ` waitedMs=${Date.now() - started}; attempts=${attempts}; lockState=${lockState};` +
    ` observedAgeMs=${observedAge}; observedOwner=${observedOwner}; lastFailure=${lastFailure};` +
    ` probe=${probe}; localHolders=${JSON.stringify(heldLockHolders())}`,
  );
}

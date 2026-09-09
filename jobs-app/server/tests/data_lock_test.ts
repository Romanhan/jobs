import { releaseDataLock } from "../data-lock.ts";
import { equal } from "./helpers.ts";

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

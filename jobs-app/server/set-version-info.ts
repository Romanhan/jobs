const { version } = JSON.parse(Deno.readTextFileSync("deno.json"));

const exePath = "jobs-app.exe";
const rceditUrl = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe";
const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".";
const cacheDir = `${home}/.cache/rcedit`;
const rceditPath = `${cacheDir}/rcedit-x64.exe`;
const isWindows = Deno.build.os === "windows";

async function ensureRcedit() {
  try {
    await Deno.stat(rceditPath);
  } catch {
    console.log("Downloading rcedit...");
    await Deno.mkdir(cacheDir, { recursive: true });
    const resp = await fetch(rceditUrl);
    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
    const file = await Deno.open(rceditPath, { write: true, create: true });
    await resp.body.pipeTo(file.writable);
    console.log("Downloaded rcedit-x64.exe");
  }
}

async function setVersionInfo() {
  await ensureRcedit();

  const cmd = isWindows ? rceditPath : "wine";
  const cmdArgs = isWindows
    ? [rceditPath]
    : [rceditPath];

  const args = [
    ...cmdArgs,
    exePath,
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-version-string", "FileVersion", version,
    "--set-version-string", "ProductVersion", version,
    "--set-version-string", "ProductName", "jobs-app",
    "--set-version-string", "CompanyName", "Romanhan",
    "--set-version-string", "FileDescription", "Work management application",
    "--set-version-string", "LegalCopyright", "",
  ];

  console.log(`Setting version info for ${exePath}...`);
  const proc = new Deno.Command(cmd, { args });
  const { code, stdout, stderr } = await proc.output();
  if (stderr.length) console.error(new TextDecoder().decode(stderr));
  if (code !== 0) throw new Error(`rcedit failed with exit code ${code}`);
  console.log("Version info set successfully.");
}

await setVersionInfo();

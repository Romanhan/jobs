const { version } = JSON.parse(Deno.readTextFileSync("deno.json"));

const exePath = "jobs-app.exe";
const rceditUrl = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe";
const cacheDir = `${Deno.env.get("HOME")}/.cache/rcedit`;
const rceditPath = `${cacheDir}/rcedit-x64.exe`;

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

  console.log(`Setting version info for ${exePath}...`);
  const proc = new Deno.Command("wine", {
    args: [rceditPath, exePath,
      "--set-version-string", "FileVersion", version,
      "--set-version-string", "ProductVersion", version,
      "--set-version-string", "ProductName", "jobs-app",
      "--set-version-string", "FileDescription", "jobs-app - Work management application",
    ],
  });

  const { code, stdout, stderr } = await proc.output();
  if (stderr.length) console.error(new TextDecoder().decode(stderr));
  if (code !== 0) {
    throw new Error(`rcedit failed with exit code ${code}`);
  }
  console.log("Version info set successfully.");
}

await setVersionInfo();

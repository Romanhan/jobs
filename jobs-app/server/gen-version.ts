const { version } = JSON.parse(Deno.readTextFileSync("deno.json"));
const content = [
  `export const APP_VERSION = ${JSON.stringify(version)};`,
  `export const APP_NAME = ${JSON.stringify("Tööde Haldus")};`,
  `export const APP_AUTHOR = ${JSON.stringify("Romanhan")};`,
  "",
].join("\n");
Deno.writeTextFileSync("web/js/version.js", content);

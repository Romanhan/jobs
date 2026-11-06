// Adds Windows file-version information (RT_VERSION) to the compiled
// executable so Explorer's "Details" tab shows the app version.
//
// Why this is not a plain rcedit call: `deno compile` embeds the bundled
// application as an RT_RCDATA resource (named "D3N0L4ND") inside the .pedata
// section and locates it at runtime with FindResourceA. rcedit and similar
// tools rebuild the resource directory from scratch, dropping that payload
// resource, which makes the finished executable fail with
// "Could not find standalone binary section".
//
// This script instead rebuilds the resource directory in place, keeping every
// existing entry untouched and adding RT_VERSION next to it. The directory is
// the first thing in the .pedata section, so it simply grows there and the
// resource data behind it shifts along; no section is added or reordered, the
// file keeps a single resource directory, and the embedded payload keeps
// working.

import { APP_NAME } from "./web/js/version.js";

const RT_RCDATA = 10;
const RT_VERSION = 16;

interface Section {
  hdr: number;
  name: string;
  vsize: number;
  va: number;
  size: number;
  ptr: number;
}

interface ResourceEntry {
  type: number | string;
  name: number | string;
  lang: number;
  rva: number;
  size: number;
  cp: number;
}

interface PeInfo {
  pe: number;
  nsec: number;
  st: number;
  sections: Section[];
}

function parsePe(d: Uint8Array): PeInfo {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const pe = dv.getUint32(0x3c, true);
  if (dv.getUint32(pe, true) !== 0x00004550) {
    throw new Error("not a PE file");
  }
  const nsec = dv.getUint16(pe + 6, true);
  const optSize = dv.getUint16(pe + 20, true);
  const st = pe + 24 + optSize;
  const sections: Section[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < nsec; i++) {
    const o = st + i * 40;
    const name = dec.decode(d.subarray(o, o + 8)).replace(/\0+$/, "");
    sections.push({
      hdr: o,
      name,
      vsize: dv.getUint32(o + 8, true),
      va: dv.getUint32(o + 12, true),
      size: dv.getUint32(o + 16, true),
      ptr: dv.getUint32(o + 20, true),
    });
  }
  return { pe, nsec, st, sections };
}

function dataDirOffset(pe: number, index: number): number {
  // PE32+ optional header: data directories start 112 bytes in.
  return pe + 24 + 112 + index * 8;
}

function rvaToOffset(sections: Section[], rva: number): number {
  for (const s of sections) {
    if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.size)) {
      return s.ptr + (rva - s.va);
    }
  }
  throw new Error(`RVA 0x${rva.toString(16)} is not inside any section`);
}

function readResourceEntries(d: Uint8Array, pe: PeInfo): ResourceEntry[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const dec = new TextDecoder("utf-16le");
  const base = rvaToOffset(pe.sections, dv.getUint32(dataDirOffset(pe.pe, 2), true));
  const entries: ResourceEntry[] = [];

  const walk = (off: number, path: (number | string)[]) => {
    const named = dv.getUint16(off + 12, true);
    const ids = dv.getUint16(off + 14, true);
    for (let i = 0; i < named + ids; i++) {
      const e = off + 16 + i * 8;
      const rawName = dv.getUint32(e, true);
      const rawOffset = dv.getUint32(e + 4, true);
      let name: number | string = rawName;
      if (rawName & 0x80000000) {
        const so = base + (rawName & 0x7fffffff);
        const len = dv.getUint16(so, true);
        name = dec.decode(d.subarray(so + 2, so + 2 + len * 2));
      }
      if (rawOffset & 0x80000000) {
        walk(base + (rawOffset & 0x7fffffff), [...path, name]);
      } else {
        const doff = base + rawOffset;
        if (path.length !== 2) {
          throw new Error(`unexpected resource tree depth: ${JSON.stringify(path)}`);
        }
        entries.push({
          type: path[0],
          name: path[1],
          lang: typeof name === "number" ? name : Number(name),
          rva: dv.getUint32(doff, true),
          size: dv.getUint32(doff + 4, true),
          cp: dv.getUint32(doff + 8, true),
        });
      }
    }
  };

  walk(base, []);
  return entries;
}

function sortNames(keys: (number | string)[]): (number | string)[] {
  const named = keys.filter((k) => typeof k === "string").sort((a, b) =>
    String(a).toUpperCase() < String(b).toUpperCase() ? -1 : 1
  );
  const ids = keys.filter((k) => typeof k === "number").sort((a, b) => Number(a) - Number(b));
  return [...named, ...ids];
}

function buildResourceTree(entries: ResourceEntry[]): Uint8Array {
  const byType = new Map<number | string, Map<number | string, Map<number, ResourceEntry>>>();
  for (const e of entries) {
    if (!byType.has(e.type)) byType.set(e.type, new Map());
    const names = byType.get(e.type)!;
    if (!names.has(e.name)) names.set(e.name, new Map());
    names.get(e.name)!.set(e.lang, e);
  }
  const types = sortNames([...byType.keys()]);

  const dirSize = (n: number) => 16 + 8 * n;
  const write = (buf: Uint8Array, off: number, named: number, ids: number) => {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(off, 0, true);
    dv.setUint32(off + 4, 0, true);
    dv.setUint16(off + 8, 0, true);
    dv.setUint16(off + 10, 0, true);
    dv.setUint16(off + 12, named, true);
    dv.setUint16(off + 14, ids, true);
  };
  const dvOf = (buf: Uint8Array) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let off = dirSize(types.length);
  const typeOffset = new Map<number | string, number>();
  for (const t of types) {
    typeOffset.set(t, off);
    off += dirSize(byType.get(t)!.size);
  }
  const nameOffset = new Map<string, number>();
  for (const t of types) {
    for (const n of sortNames([...byType.get(t)!.keys()])) {
      nameOffset.set(`${String(t)}\u0000${String(n)}`, off);
      off += dirSize(byType.get(t)!.get(n)!.size);
    }
  }
  const strOffset = new Map<string, number>();
  for (const t of types) {
    for (const n of byType.get(t)!.keys()) {
      if (typeof n === "string") {
        const bytes = n.length * 2;
        strOffset.set(`${String(t)}\u0000${n}`, off);
        // WORD length prefix + UTF-16 characters, padded so the next
        // structure stays DWORD aligned.
        off += Math.ceil((2 + bytes) / 4) * 4;
      }
    }
  }
  const dataOffset = new Map<string, number>();
  for (const t of types) {
    for (const n of byType.get(t)!.keys()) {
      for (const l of [...byType.get(t)!.get(n)!.keys()].sort((a, b) => a - b)) {
        dataOffset.set(`${String(t)}\u0000${String(n)}\u0000${l}`, off);
        off += 16;
      }
    }
  }

  const buf = new Uint8Array(off);
  const dv = dvOf(buf);
  write(buf, 0, 0, types.length);
  types.forEach((t, i) => {
    dv.setUint32(16 + i * 8, typeof t === "number" ? t : 0, true);
    dv.setUint32(16 + i * 8 + 4, typeOffset.get(t)! | 0x80000000, true);
  });
  for (const t of types) {
    const names = sortNames([...byType.get(t)!.keys()]);
    const named = names.filter((n) => typeof n === "string").length;
    write(buf, typeOffset.get(t)!, named, names.length - named);
    names.forEach((n, i) => {
      const e = typeOffset.get(t)! + 16 + i * 8;
      const key = `${String(t)}\u0000${String(n)}`;
      dv.setUint32(e, typeof n === "string" ? (0x80000000 | strOffset.get(key)!) : n, true);
      dv.setUint32(e + 4, nameOffset.get(key)! | 0x80000000, true);
    });
  }
  for (const t of types) {
    for (const n of byType.get(t)!.keys()) {
      const langs = [...byType.get(t)!.get(n)!.keys()].sort((a, b) => a - b);
      const o = nameOffset.get(`${String(t)}\u0000${String(n)}`)!;
      write(buf, o, 0, langs.length);
      langs.forEach((l, i) => {
        dv.setUint32(o + 16 + i * 8, l, true);
        dv.setUint32(o + 16 + i * 8 + 4, dataOffset.get(`${String(t)}\u0000${String(n)}\u0000${l}`)!, true);
      });
    }
  }
  for (const t of types) {
    for (const n of byType.get(t)!.keys()) {
      if (typeof n !== "string") continue;
      const o = strOffset.get(`${String(t)}\u0000${n}`)!;
      dv.setUint16(o, n.length, true);
      for (let i = 0; i < n.length; i++) dv.setUint16(o + 2 + i * 2, n.charCodeAt(i), true);
    }
  }
  for (const t of types) {
    for (const n of byType.get(t)!.keys()) {
      for (const l of byType.get(t)!.get(n)!.keys()) {
        const e = byType.get(t)!.get(n)!.get(l)!;
        const o = dataOffset.get(`${String(t)}\u0000${String(n)}\u0000${l}`)!;
        dv.setUint32(o, e.rva, true);
        dv.setUint32(o + 4, e.size, true);
        dv.setUint32(o + 8, e.cp, true);
        dv.setUint32(o + 12, 0, true);
      }
    }
  }
  return buf;
}

function utf16(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c & 0xff, c >> 8);
  }
  return out;
}

function align4(bytes: number[]): number[] {
  while (bytes.length % 4 !== 0) bytes.push(0);
  return bytes;
}

function node(
  key: string,
  type: number,
  valueLength: number,
  value: number[] | null,
  children: number[] | null,
): number[] {
  // Header is included from the start so that padding is computed against the
  // absolute offset inside the structure (the key begins at byte 6).
  const body: number[] = [0, 0, 0, 0, 0, 0];
  body.push(...utf16(key), 0, 0);
  align4(body);
  if (value) {
    body.push(...value);
    align4(body);
  }
  if (children) body.push(...children);
  align4(body);
  body[0] = body.length & 0xff;
  body[1] = (body.length >> 8) & 0xff;
  body[2] = valueLength & 0xff;
  body[3] = (valueLength >> 8) & 0xff;
  body[4] = type & 0xff;
  body[5] = (type >> 8) & 0xff;
  return body;
}

function buildVersionInfo(version: string): Uint8Array {
  const parts = version.split(".").map((n) => parseInt(n, 10) || 0);
  const [major = 0, minor = 0, build = 0, revision = 0] = parts;
  const ms = ((major & 0xffff) << 16) | (minor & 0xffff);
  const ls = ((build & 0xffff) << 16) | (revision & 0xffff);
  const dword = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

  const fixed = [
    ...dword(0xfeef04bd), // signature
    ...dword(0x00010000), // structure version
    ...dword(ms), // file version MS
    ...dword(ls), // file version LS
    ...dword(ms), // product version MS
    ...dword(ls), // product version LS
    ...dword(0x3f), // file flags mask
    ...dword(0), // file flags
    ...dword(0x40004), // VOS_NT_WINDOWS32
    ...dword(0x1), // VFT_APP
    ...dword(0), // subtype
    ...dword(0), // date MS
    ...dword(0), // date LS
  ];

  const strings: [string, string][] = [
    ["CompanyName", "Romanhan"],
    ["FileDescription", "Tööde Haldus"],
    ["FileVersion", version],
    ["InternalName", APP_NAME],
    ["OriginalFilename", `${APP_NAME}.exe`],
    ["ProductName", "Tööde Haldus"],
    ["ProductVersion", version],
  ];

  const stringNodes = strings.map(([key, value]) =>
    node(key, 1, value.length + 1, [...utf16(value), 0, 0], null)
  ).flat();

  const table = node("040904b0", 1, 0, null, stringNodes);
  const stringFileInfo = node("StringFileInfo", 1, 0, null, table);
  const translation = node("Translation", 0, 4, [0x09, 0x04, 0xb0, 0x04], null);
  const varFileInfo = node("VarFileInfo", 0, 0, null, translation);
  const root = node("VS_VERSION_INFO", 0, 52, fixed, [...stringFileInfo, ...varFileInfo]);

  return Uint8Array.from(root);
}

function mergeVersionResource(buf: Uint8Array, versionBlob: Uint8Array): Uint8Array {
  const pe = parsePe(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const entries = readResourceEntries(buf, pe);

  const pedata = pe.sections.find((s) => s.name === ".pedata");
  if (!pedata) throw new Error(".pedata section not found; is this a `deno compile` output?");

  const sectionAlign = dv.getUint32(pe.pe + 24 + 32, true);
  const fileAlign = dv.getUint32(pe.pe + 24 + 36, true);
  const alignUp = (value: number, align: number) => Math.ceil(value / align) * align;

  // Resource data is packed right behind the directory inside .pedata, so the
  // smallest data offset is also the end of the original directory.
  let treeSize = Number.POSITIVE_INFINITY;
  for (const e of entries) {
    const off = rvaToOffset(pe.sections, e.rva) - pedata.ptr;
    if (off < 0 || off >= pedata.size) {
      throw new Error("resource data outside .pedata; refusing to rewrite the directory");
    }
    treeSize = Math.min(treeSize, off);
  }
  if (!Number.isFinite(treeSize)) throw new Error("no resource data found");
  treeSize = alignUp(treeSize, 8);

  // Stored RVAs do not change the encoded length, so the merged directory can
  // be measured up front with placeholder values.
  const treeLength = buildResourceTree([
    ...entries,
    { type: RT_VERSION, name: 1, lang: 0x409, rva: 0, size: versionBlob.length, cp: 0x4b0 },
  ]).length;
  const shift = alignUp(Math.max(0, treeLength - treeSize), 8);

  // The version data goes after the existing resource data, still inside
  // .pedata, so the file never grows an overlay past the last section.
  const versionOffset = alignUp(pedata.ptr + pedata.size + shift, 8);
  const versionRva = pedata.va + (versionOffset - pedata.ptr);

  const tree = buildResourceTree([
    ...entries.map((e) => ({ ...e, rva: e.rva + shift })),
    { type: RT_VERSION, name: 1, lang: 0x409, rva: versionRva, size: versionBlob.length, cp: 0x4b0 },
  ]);

  const rawSize = alignUp(versionOffset + versionBlob.length - pedata.ptr, fileAlign);
  const virtualSize = Math.max(pedata.vsize, rawSize);

  // Grow the directory in place: everything behind it shifts by `shift`, so
  // the finished file keeps a single resource directory and no stray copies.
  const treeOffset = pedata.ptr + treeSize;
  const out = new Uint8Array(pedata.ptr + rawSize);
  out.set(buf.subarray(0, treeOffset), 0);
  out.set(buf.subarray(treeOffset), treeOffset + shift);
  out.set(tree, pedata.ptr);
  out.set(versionBlob, versionOffset);

  const odv = new DataView(out.buffer);
  odv.setUint32(pedata.hdr + 8, virtualSize, true);
  odv.setUint32(pedata.hdr + 16, rawSize, true);
  odv.setUint32(dataDirOffset(pe.pe, 2), pedata.va, true);
  odv.setUint32(dataDirOffset(pe.pe, 2) + 4, rawSize, true);
  odv.setUint32(pe.pe + 24 + 56, alignUp(pedata.va + virtualSize, sectionAlign), true);

  return out;
}

const exePath = "jobs-app.exe";
const { version } = JSON.parse(await Deno.readTextFile(new URL("./deno.json", import.meta.url)));

// WithSecure quarantines `deno compile` output from Deno 2.9.7
// (Trojan.TR/W64.Malware; it also broke the resource merge below) and from
// 2.9.8 (Trojan.TR/W64.Evo; its runtime is blocked outright) - false positives
// on the Deno runtime. 2.9.6 was scanned clean for both a hello-world and a
// real app build, so that is the release toolchain. Warn loudly on anything
// else so a stray toolchain is never shipped by accident.
const RELEASE_DENO_VERSION = "2.9.6";
if (Deno.version.deno !== RELEASE_DENO_VERSION) {
  console.warn(
    `\nWARNING: built with Deno ${Deno.version.deno}; release builds use ` +
      `${RELEASE_DENO_VERSION}. 2.9.7 and 2.9.8 executables are quarantined ` +
      `by WithSecure.\n`,
  );
}

const original = await Deno.readFile(exePath);
const merged = mergeVersionResource(original, buildVersionInfo(version));

// Safety net: the embedded payload resource must survive byte for byte,
// otherwise the executable would fail with "Could not find standalone binary
// section".
const check = readResourceEntries(merged, parsePe(merged));
const payload = check.find((e) => e.type === RT_RCDATA);
if (!payload) throw new Error("payload resource lost while adding version info");
if (!check.find((e) => e.type === RT_VERSION)) throw new Error("version resource was not added");

const before = readResourceEntries(original, parsePe(original)).find((e) => e.type === RT_RCDATA);
if (!before) throw new Error("payload resource missing from the compiled executable");
const slice = (bytes: Uint8Array, entry: { rva: number; size: number }) => {
  const off = rvaToOffset(parsePe(bytes).sections, entry.rva);
  return bytes.subarray(off, off + entry.size);
};
const oldPayload = slice(original, before);
const newPayload = slice(merged, payload);
if (oldPayload.length !== newPayload.length || oldPayload.some((b, i) => b !== newPayload[i])) {
  throw new Error("payload bytes changed while adding version info");
}

await Deno.writeFile(exePath, merged);
console.log(`Set ${exePath} file version to ${version} (payload resource kept: ${payload.size} bytes)`);

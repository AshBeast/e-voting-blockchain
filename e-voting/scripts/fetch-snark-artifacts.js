const fs = require("fs/promises");
const path = require("path");

const BASE_URL = "https://snark-artifacts.pse.dev";
const PROJECT = "semaphore";
const VERSION = process.env.SEMAPHORE_SNARK_VERSION || "4.13.0";
const DEPTHS = (process.env.SEMAPHORE_SNARK_DEPTHS || "1")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

const OUT_DIR = path.resolve(
  process.env.SEMAPHORE_SNARK_ARTIFACTS_DIR ||
    path.join(__dirname, "..", "snark-artifacts", PROJECT, VERSION)
);

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

async function ensureFile(url, outPath) {
  try {
    await fs.access(outPath);
    console.log(`exists: ${outPath}`);
    return;
  } catch {
    // continue and download
  }

  console.log(`download: ${url}`);
  await download(url, outPath);
  console.log(`saved: ${outPath}`);
}

async function main() {
  if (DEPTHS.length === 0) {
    throw new Error(
      "No valid depths. Set SEMAPHORE_SNARK_DEPTHS (e.g. '1' or '1,20')."
    );
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const depth of DEPTHS) {
    const base = `${BASE_URL}/${PROJECT}/${VERSION}/${PROJECT}-${depth}`;
    await ensureFile(`${base}.wasm`, path.join(OUT_DIR, `${PROJECT}-${depth}.wasm`));
    await ensureFile(`${base}.zkey`, path.join(OUT_DIR, `${PROJECT}-${depth}.zkey`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

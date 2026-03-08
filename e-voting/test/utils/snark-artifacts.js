const fs = require("fs");
const path = require("path");

const DEFAULT_SEMAPHORE_SNARK_DIR = path.resolve(
  __dirname,
  "../../snark-artifacts/semaphore/4.13.0"
);

function resolveSemaphoreSnarkArtifacts(depth) {
  const d = Number(depth);
  if (!Number.isInteger(d) || d < 1) return null;

  const baseDir = process.env.SEMAPHORE_SNARK_ARTIFACTS_DIR
    ? path.resolve(process.env.SEMAPHORE_SNARK_ARTIFACTS_DIR)
    : DEFAULT_SEMAPHORE_SNARK_DIR;

  const wasm = path.join(baseDir, `semaphore-${d}.wasm`);
  const zkey = path.join(baseDir, `semaphore-${d}.zkey`);

  if (!fs.existsSync(wasm) || !fs.existsSync(zkey)) return null;

  return { wasm, zkey };
}

module.exports = {
  DEFAULT_SEMAPHORE_SNARK_DIR,
  resolveSemaphoreSnarkArtifacts,
};

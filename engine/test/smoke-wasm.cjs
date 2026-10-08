const fs = require('fs');
const path = require('path');

async function main() {
  const wasmPath = path.join(
    __dirname,
    '..',
    'target',
    'wasm32-unknown-unknown',
    'release',
    'kawaii_wasm.wasm',
  );
  if (!fs.existsSync(wasmPath)) {
    console.error('smoke-wasm: 尚未构建，先 npm run build:wasm');
    process.exit(1);
  }
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const len = instance.exports.kawaii_engine_info_len();
  const ptr = instance.exports.kawaii_engine_info_ptr();
  const mem = new Uint8Array(instance.exports.memory.buffer);
  const info = new TextDecoder().decode(mem.subarray(ptr, ptr + len));
  console.log('smoke wasm:', info);
  if (!info.includes('kawaii-wasm') || !info.includes('(wasm)')) {
    console.error('smoke-wasm: 自述串不符合预期', info);
    process.exit(1);
  }
  console.log('smoke wasm OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

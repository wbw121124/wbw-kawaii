// 把 wasm 构建产物复制到 engine/ 根（vsix 与 glue.mjs 打包位置优先级）。
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'target', 'wasm32-unknown-unknown', 'release', 'kawaii_wasm.wasm');
const dst = join(root, 'kawaii_wasm.wasm');

if (!existsSync(src)) {
  console.error(`缺少构建产物 ${src}（先 cargo build --release --target wasm32-unknown-unknown -p kawaii-wasm）`);
  process.exit(1);
}
copyFileSync(src, dst);
console.log('已复制 engine.wasm → engine/kawaii_wasm.wasm');

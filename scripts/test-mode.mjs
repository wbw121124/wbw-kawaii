// 单模式跑全部测试：node scripts/test-mode.mjs [ts|native|wasm]
// 跨平台设置 KBWW_ENGINE 后拉起 node --test（npm test 默认三连跑）。
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'ts';
if (!['ts', 'native', 'wasm'].includes(mode)) {
  console.error(`未知模式 ${mode}（可选 ts | native | wasm）`);
  process.exit(2);
}

console.log(`── 测试后端: ${mode} ──`);
const r = spawnSync(
  process.execPath,
  [
    '--test',
    'test/transform.test.cjs',
    'test/uninstall-restore.test.cjs',
    'test/new-targets.test.cjs',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, KBWW_ENGINE: mode },
  },
);
process.exit(r.status ?? 1);

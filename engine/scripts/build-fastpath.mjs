// 从编译产物 out/rules.generated.js 导出 fastpath 语料（TSV + identity 列表）。
// 先 npm run compile 再运行。0.9.0 语料编译成 .kawaii 后删除本脚本与数据文件。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(import.meta.url);

const outPath = path.join(repoRoot, 'out', 'rules.generated.js');
if (!fs.existsSync(outPath)) {
  console.error(`缺少 ${outPath}（先 npm run compile）`);
  process.exit(1);
}
const { RULES, IDENTITY_VALUES, RULES_VERSION } = require(outPath);

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

const dataDir = path.join(repoRoot, 'engine', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const lines = [];
let variantCount = 0;
for (const [key, variants] of Object.entries(RULES)) {
  variantCount += variants.length;
  lines.push([key, ...variants].map(esc).join('\t'));
}
fs.writeFileSync(path.join(dataDir, 'fastpath.tsv'), lines.join('\n') + '\n', 'utf8');
fs.writeFileSync(
  path.join(dataDir, 'identity.txt'),
  IDENTITY_VALUES.map(esc).join('\n') + '\n',
  'utf8',
);

console.log(
  `fastpath: ${Object.keys(RULES).length} 键 / ${variantCount} 变体 / ${IDENTITY_VALUES.length} identity（${RULES_VERSION}）`,
);

#!/usr/bin/env node
// 生成 src/rules.generated.ts：
//   基准1: cpptools 1.34.4 原文 <-> kawaii 文案（逐索引配对）
//   基准2: cpptools 1.19.7 原文 <-> 同索引 kawaii 文案（占位符序列一致才采纳）
//   TS 规则: scripts/rules/chunks/ts-*.json 按 key 汇总
//   PACK 规则: scripts/rules/chunks/pack-*.json 按 key 汇总
// 规则以"原文文本"为键（cpptools），TS/PACK 以 messageKey 为键。
// 未命中条目由运行时正则兜底装饰。
// 用法: node scripts/build-rules.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = path.join(ROOT, 'assets', 'baseline');
const KAWAII_PATH = path.join(ROOT, 'assets', 'reference', 'messages.json');
const OUT_PATH = path.join(ROOT, 'src', 'rules.generated.ts');
const CHUNKS_TS_DIR = path.join(ROOT, 'scripts', 'rules', 'chunks');
const EXCLUDE_PATH = path.join(ROOT, 'scripts', 'rules', 'exclude.json');

const PRIMARY = '1.34.4';
const SECONDARY = '1.19.7';
const COVERAGE = ['1.34.4', '1.19.7', '1.35.3'];

// 占位符形态：%% | %[方括号] | %字母族+数字下标 | {N}（与 src/transform.ts 保持一致）
const TOKEN_RE = new RegExp('%%|%\\[[^\\]]*\\]|%[A-Za-z]+\\d*|\\{\\d+\\}', 'g');

const tokens = (s) => s.match(TOKEN_RE) ?? [];
const seqKey = (arr) => arr.join('\u0001');
const multiKey = (arr) => [...arr].sort().join('\u0001');

function loadJson(p) {
  if (!fs.existsSync(p)) {
    console.error(`缺少文件: ${p}\n先运行: npm run fetch-baseline`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function assertArray(name, v) {
  if (!Array.isArray(v)) {
    console.error(`${name} 不是 JSON 数组`);
    process.exit(1);
  }
}

// ========== cpptools RULES ==========
const kawaii = loadJson(KAWAII_PATH);
assertArray('kawaii 文案', kawaii);
const primary = loadJson(path.join(BASE_DIR, `orig-${PRIMARY}.json`));
assertArray(`orig-${PRIMARY}`, primary);

if (primary.length !== kawaii.length) {
  console.error(`长度不一致: orig-${PRIMARY}=${primary.length}, kawaii=${kawaii.length}（基准版本不匹配？）`);
  process.exit(1);
}

let nullMismatch = 0;
for (let i = 0; i < kawaii.length; i++) {
  if ((kawaii[i] === null) !== (primary[i] === null)) nullMismatch++;
}
if (nullMismatch > 0) {
  console.error(`null 位置不一致 ${nullMismatch} 处，基准与文案不配对，拒绝生成`);
  process.exit(1);
}

// key -> Set<variant>
const cpptoolsRules = new Map();
const identityValues = new Set();
let identity = 0;
let addedPrimary = 0;
let skipOrderSwap = 0;
let skipPlaceholder = 0;

function tryAdd(orig, cute, tag) {
  const tOrig = tokens(orig);
  const tCute = tokens(cute);
  if (seqKey(tOrig) !== seqKey(tCute)) {
    if (multiKey(tOrig) === multiKey(tCute)) {
      skipOrderSwap++;
    } else {
      skipPlaceholder++;
    }
    return false;
  }
  let set = cpptoolsRules.get(orig);
  if (!set) { set = new Set(); cpptoolsRules.set(orig, set); }
  const before = set.size;
  set.add(cute);
  if (set.size > before) addedPrimary += (tag === 'p' ? 1 : 0);
  return set.size > before;
}

for (let i = 0; i < primary.length; i++) {
  const o = primary[i];
  const k = kawaii[i];
  if (o === null || k === null) continue;
  if (o === k) { identity++; identityValues.add(o); continue; }
  tryAdd(o, k, 'p');
}

let addedSecondary = 0;
const secondaryPath = path.join(BASE_DIR, `orig-${SECONDARY}.json`);
if (fs.existsSync(secondaryPath)) {
  const secondary = loadJson(secondaryPath);
  assertArray(`orig-${SECONDARY}`, secondary);
  const n = Math.min(secondary.length, kawaii.length);
  for (let i = 0; i < n; i++) {
    const o = secondary[i];
    const k = kawaii[i];
    if (o === null || k === null) continue;
    if (o === primary[i]) continue;
    if (o === k) { identityValues.add(o); continue; }
    const tOrig = tokens(o);
    const tCute = tokens(k);
    if (seqKey(tOrig) !== seqKey(tCute)) continue;
    let set = cpptoolsRules.get(o);
    if (!set) { set = new Set(); cpptoolsRules.set(o, set); }
    const before = set.size;
    set.add(k);
    if (set.size > before) addedSecondary++;
  }
}

// 与规则冲突时规则优先
for (const key of cpptoolsRules.keys()) identityValues.delete(key);
const identityList = [...identityValues].sort();

let dupGroups = 0;
let dupMultiVariant = 0;
for (const [, v] of cpptoolsRules) {
  if (v.size >= 1) {
    dupGroups++;
    if (v.size > 1) dupMultiVariant++;
  }
}

// ========== TS / PACK 规则 ==========
function loadChunkFile(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function loadExcludeSet() {
  if (!fs.existsSync(EXCLUDE_PATH)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8')).map(e => e.key));
}

function collectChunks(pattern, scope, invMap) {
  const entries = [];
  for (const f of fs.readdirSync(CHUNKS_TS_DIR).filter(n => n.match(pattern))) {
    const arr = loadChunkFile(path.join(CHUNKS_TS_DIR, f));
    if (!arr) { console.error(`[build] 无法解析: ${f}`); continue; }
    for (const e of arr) {
      if (!e || typeof e.key !== 'string' || !Array.isArray(e.variants)) {
        console.error(`[build] 条目结构异常: ${JSON.stringify(e)?.slice(0, 120)}`);
        process.exit(1);
      }
      // TS 的 key 是消息标识符（不含占位符），源文本在 invMap.get(key)
      const sourceText = scope === 'ts' ? (invMap?.get(e.key)?.zh ?? invMap?.get(e.key)?.en ?? e.key) : e.key;
      for (const v of e.variants) {
        if (typeof v !== 'string') {
          console.error(`[build] 变体非字符串: ${e.key}`);
          process.exit(1);
        }
        const tSrc = tokens(sourceText);
        const tVar = tokens(v);
        if (seqKey(tSrc) !== seqKey(tVar)) {
          console.error(`[build] 占位符不一致: ${scope}:${e.key}`);
          console.error(`  source tokens: ${JSON.stringify(tSrc)} (source: ${JSON.stringify(sourceText)?.slice(0,80)})`);
          console.error(`  variant tokens: ${JSON.stringify(tVar)}`);
          console.error(`  variant: ${v}`);
          process.exit(1);
        }
      }
      entries.push(e);
    }
  }
  return entries;
}

const excludeSet = loadExcludeSet();

// TS 的 key 是消息标识符（不含占位符），源文本在 inventory
let tsInvMap = null;
try {
  const tsInv = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'rules', 'inventory', 'ts.json'), 'utf8'));
  tsInvMap = new Map(tsInv.map(e => [e.key, e]));
} catch (e) {
  console.warn(`[build] 无法加载 TS inventory: ${e.message}`);
}

const tsEntries = collectChunks(/^ts-\d+\.json$/, 'ts', tsInvMap);
const packEntries = collectChunks(/^pack-\d+\.json$/, 'pack', null);

// markdownlint: 直接从 chunks/markdownlint.json 加载（无 inventory，key 即英文原文）
const markdownlintEntries = [];
try {
  const mlPath = path.join(CHUNKS_TS_DIR, 'markdownlint.json');
  if (fs.existsSync(mlPath)) {
    const arr = JSON.parse(fs.readFileSync(mlPath, 'utf8'));
    for (const e of arr) {
      if (e && typeof e.key === 'string' && Array.isArray(e.variants)) {
        markdownlintEntries.push(e);
      }
    }
  }
} catch {}

const tsRules = new Map();
for (const e of tsEntries) {
  if (excludeSet.has(e.key)) continue;
  tsRules.set(e.key, [...new Set(e.variants)]);
}

const packRules = new Map();
for (const e of packEntries) {
  if (excludeSet.has(e.key)) continue;
  packRules.set(e.key, [...new Set(e.variants)]);
}

let tsMissed = 0, packMissed = 0;
for (const e of tsEntries) if (!tsRules.has(e.key)) tsMissed++;
for (const e of packEntries) if (!packRules.has(e.key)) packMissed++;

// ========== 生成 rules.generated.ts ==========
const obj = {};
for (const [k, v] of [...cpptoolsRules.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  obj[k] = [...v];
}
const canonical = JSON.stringify(obj);
const identityCanonical = JSON.stringify(identityList);
const tsObj = {};
for (const [k, v] of [...tsRules.entries()].sort((a, b) => a[0].localeCompare(b[0]))) tsObj[k] = v;
const packObj = {};
for (const [k, v] of [...packRules.entries()].sort((a, b) => a[0].localeCompare(b[0]))) packObj[k] = v;
const mlObj = {};
for (const [k, v] of [...new Map(markdownlintEntries.map(e => [e.key, e.variants])).entries()].sort((a, b) => a[0].localeCompare(b[0]))) mlObj[k] = v;
const tsCanonical = JSON.stringify(tsObj);
const packCanonical = JSON.stringify(packObj);
const mlCanonical = JSON.stringify(mlObj);

const fullCanonical = canonical + '\n' + identityCanonical + '\n' + tsCanonical + '\n' + packCanonical + '\n' + mlCanonical;
const version = 'sha256:' + crypto.createHash('sha256').update(fullCanonical).digest('hex').slice(0, 16);

const lines = [];
lines.push('// AUTO-GENERATED by scripts/build-rules.mjs —— 不要手改。');
lines.push(`// 基准: cpptools ${PRIMARY} + ${SECONDARY} (zh-cn messages.json)`);
lines.push('// 文案: Gary-0925/kawaii-vscode-cpptools (MIT, 见 assets/reference/NOTICE)');
lines.push(`// TS/PACK/ML 规则: ${tsRules.size} + ${packRules.size} + ${markdownlintEntries.length} 条（规则版本 ${version}）`);
lines.push(`export const RULES_VERSION = ${JSON.stringify(version)};`);
lines.push('export const RULES: Record<string, string[]> = {');
for (const [k, v] of Object.entries(obj)) {
  lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
}
lines.push('};');
lines.push('export const IDENTITY_VALUES: string[] = [');
for (const v of identityList) {
  lines.push(`  ${JSON.stringify(v)},`);
}
lines.push('];');
lines.push('export const TS_RULES: Record<string, string[]> = {');
for (const [k, v] of Object.entries(tsObj)) {
  lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
}
lines.push('};');
lines.push('export const PACK_RULES: Record<string, string[]> = {');
for (const [k, v] of Object.entries(packObj)) {
  lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
}
lines.push('};');
lines.push('export const MARKDOWNLINT_RULES: Record<string, string[]> = {');
for (const [k, v] of Object.entries(mlObj)) {
  lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
}
lines.push('};');
lines.push('');
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, lines.join('\n'));

// 覆盖率报告
const totalBytes = fs.statSync(OUT_PATH).size;
console.log(`生成 ${path.relative(ROOT, OUT_PATH)} (${(totalBytes / 1024).toFixed(0)} KB, RULES_VERSION=${version})`);
console.log(`cpptools: 规则键 ${cpptoolsRules.size}, identity ${identity} 条（唯一值 ${identityList.length}），占位符换序跳过 ${skipOrderSwap}, 占位符不一致跳过 ${skipPlaceholder}`);
console.log(`TS: ${tsRules.size} 条, PACK: ${packRules.size} 条, MarkdownLint: ${markdownlintEntries.length} 条`);
if (tsMissed > 0) console.warn(`[warn] TS 未覆盖 ${tsMissed} 条`);
if (packMissed > 0) console.warn(`[warn] PACK 未覆盖 ${packMissed} 条`);

console.log('\ncpptools 覆盖率（按原文文本精确命中规则表的非 null 条目占比）:');
for (const ver of COVERAGE) {
  const p = path.join(BASE_DIR, `orig-${ver}.json`);
  if (!fs.existsSync(p)) { console.log(`  ${ver}: 缺基线，跳过`); continue; }
  const arr = loadJson(p);
  let nonNull = 0, hit = 0;
  for (const e of arr) {
    if (e === null) continue;
    nonNull++;
    if (cpptoolsRules.has(e)) hit++;
  }
  console.log(`  ${ver}: ${hit}/${nonNull} = ${(hit / nonNull * 100).toFixed(2)}%`);
}

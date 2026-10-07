#!/usr/bin/env node
// 提取 0.2.0 新目标的规则输入清单（inventory）与排除清单（exclude）。
// 产出（提交入库，供子代理撰写 chunks 与 build-rules 合并校验使用）:
//   scripts/rules/inventory/ts.json    [{key, en, zh}]  TypeScript 诊断（diag 表 ∪ zh-cn JSON）
//   scripts/rules/inventory/pack.json  [{key, zh, files}] 语言包 contents.bundle（css ∪ html）
//   scripts/rules/exclude.json         [{scope, key, reason, value}]
// 用法:
//   node scripts/extract-rule-inputs.mjs [--app-dir <path>] [--pack-dir <path>]
// --app-dir 可指向 VS Code 安装根、app 目录或 extensions 目录；
// --pack-dir 可指向语言包扩展根、translations 或 translations/extensions 目录。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'rules');
const TS_INVENTORY = path.join(OUT_DIR, 'inventory', 'ts.json');
const PACK_INVENTORY = path.join(OUT_DIR, 'inventory', 'pack.json');
const EXCLUDE_PATH = path.join(OUT_DIR, 'exclude.json');

const CHUNK_SIZE = 180;
const MIN_DIAG_ROWS = 2000;
const MIN_ZH_KEYS = 2000;
const MIN_PACK_CSS = 200;
const MIN_PACK_HTML = 200;

function fail(msg) {
  console.error(`[extract] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { appDir: null, packDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app-dir') out.appDir = argv[++i];
    else if (argv[i] === '--pack-dir') out.packDir = argv[++i];
    else fail(`未知参数: ${argv[i]}`);
  }
  return out;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// 解析出含 node_modules/typescript/lib/typescript.js 的 extensions 目录
function resolveExtensionsRoot(p) {
  const candidates = [p, path.join(p, 'resources', 'app', 'extensions'), path.join(p, 'extensions')];
  for (const c of candidates) {
    if (isFile(path.join(c, 'node_modules', 'typescript', 'lib', 'typescript.js'))) return c;
  }
  return null;
}

function discoverExtensionsRoot(override) {
  if (override) {
    const r = resolveExtensionsRoot(override);
    if (!r) fail(`--app-dir 下未找到 typescript.js: ${override}`);
    return r;
  }
  const roots = [
    process.env.VSCODE_APP_ROOT,
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code Insiders'),
    'C:\\Program Files\\Microsoft VS Code',
    '/usr/share/code',
    '/usr/share/code-insiders',
    '/Applications/Visual Studio Code.app/Contents/Resources/app'
  ].filter(Boolean);

  const tried = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const direct = resolveExtensionsRoot(root);
    if (direct) return direct;
    tried.push(root);
    // 哈希目录布局：<安装根>/<hash>/resources/app/extensions
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      const r = resolveExtensionsRoot(path.join(root, name));
      if (r) return r;
    }
  }
  fail(
    '未找到 VS Code 的 extensions 目录（含 node_modules/typescript/lib/typescript.js）。\n' +
      '可用 --app-dir 显式指定，例如 --app-dir "C:\\Users\\<u>\\AppData\\Local\\Programs\\Microsoft VS Code"' +
      (tried.length ? `\n已尝试根目录: ${tried.join(', ')}` : '')
  );
}

function resolvePackTranslations(override) {
  const tryDir = (p) => {
    const candidates = [
      path.join(p, 'translations', 'extensions'),
      path.join(p, 'extensions'),
      p
    ];
    for (const c of candidates) {
      const css = path.join(c, 'vscode.css-language-features.i18n.json');
      const html = path.join(c, 'vscode.html-language-features.i18n.json');
      if (isFile(css) && isFile(html)) return c;
    }
    return null;
  };

  if (override) {
    const r = tryDir(override);
    if (!r) fail(`--pack-dir 下未找到 vscode.{css,html}-language-features.i18n.json: ${override}`);
    return r;
  }

  const roots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions')
  ];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const packs = fs
      .readdirSync(root)
      .filter((n) => n.startsWith('ms-ceintl.vscode-language-pack-zh-hans-'))
      .sort(); // 目录名带版本，字典序最大 ≈ 最新
    for (let i = packs.length - 1; i >= 0; i--) {
      const r = tryDir(path.join(root, packs[i]));
      if (r) return r;
    }
  }
  fail('未找到语言包 ms-ceintl.vscode-language-pack-zh-hans 的 translations 目录（可用 --pack-dir 指定）');
}

// diag 表行：PropertyName: diag(2304, 1 /* Error */, "Key_2304", "English text."),
// 跨行：长消息可能在参数间换行，全部用 \s* 承接。
const DIAG_RE =
  /([A-Za-z_$][\w$]*)\s*:\s*diag\(\s*\d+\s*,\s*[^,]+?,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g;

function unescapeJsString(s) {
  // diag 表字符串按 JS 字面量转义（\" \\ \n \t 等）
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, g) => {
    switch (g[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      case 'u': return String.fromCharCode(parseInt(g.slice(1), 16));
      case 'x': return String.fromCharCode(parseInt(g.slice(1), 16));
      default: return g;
    }
  });
}

function extractTsDiag(tsJsPath) {
  const src = fs.readFileSync(tsJsPath, 'utf8');
  const map = new Map(); // messageKey -> {en}
  let matched = 0;
  let renameSkipped = 0;
  let m;
  DIAG_RE.lastIndex = 0;
  while ((m = DIAG_RE.exec(src)) !== null) {
    matched++;
    const propName = m[1];
    const key = m[2];
    const en = unescapeJsString(m[3]);
    if (propName !== key) renameSkipped++;
    if (!map.has(key)) map.set(key, { en });
  }
  if (matched < MIN_DIAG_ROWS) {
    fail(`diag 表命中 ${matched} 行 < 门禁 ${MIN_DIAG_ROWS}，typescript.js 格式可能变化，拒绝生成`);
  }
  return { map, matched, renameSkipped };
}

function extractZhJson(zhPath) {
  const obj = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
  const map = new Map();
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') map.set(k, v);
  }
  if (map.size < MIN_ZH_KEYS) {
    fail(`zh-cn JSON 键 ${map.size} < 门禁 ${MIN_ZH_KEYS}: ${zhPath}`);
  }
  return map;
}

function extractPack(translationsDir) {
  const files = [
    ['css', path.join(translationsDir, 'vscode.css-language-features.i18n.json')],
    ['html', path.join(translationsDir, 'vscode.html-language-features.i18n.json')]
  ];
  const map = new Map(); // key -> {zh, files:Set}
  const counts = {};
  let mismatch = 0;
  for (const [tag, file] of files) {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bundle = obj?.contents?.bundle;
    if (!bundle || typeof bundle !== 'object') fail(`缺少 contents.bundle: ${file}`);
    const keys = Object.keys(bundle);
    counts[tag] = keys.length;
    for (const k of keys) {
      const v = bundle[k];
      if (typeof v !== 'string') continue;
      const hit = map.get(k);
      if (!hit) {
        map.set(k, { zh: v, files: new Set([tag]) });
      } else {
        hit.files.add(tag);
        if (hit.zh !== v) mismatch++;
      }
    }
  }
  if ((counts.css ?? 0) < MIN_PACK_CSS || (counts.html ?? 0) < MIN_PACK_HTML) {
    fail(
      `语言包键数不足（css ${counts.css} < ${MIN_PACK_CSS} 或 html ${counts.html} < ${MIN_PACK_HTML}），` +
        '语言包结构可能变化，拒绝生成'
    );
  }
  return { map, counts, mismatch };
}

// 排除判定：展示值是空/纯符号/裸标识符时改写会破坏语义（如设置 ID），一律保持原样
const SYMBOL_ONLY_RE = /^[^\p{L}\p{N}]+$/u;
const IDENTIFIER_RE = /^[A-Za-z0-9._@\-/+#+]+$/;

function exclusionReason(texts) {
  if (texts.length === 0) return { reason: 'no-text', value: '' };
  for (const t of texts) {
    if (t.trim() === '') return { reason: 'empty', value: t };
    if (SYMBOL_ONLY_RE.test(t)) return { reason: 'symbol-only', value: t };
    if (IDENTIFIER_RE.test(t)) return { reason: 'identifier-like', value: t };
  }
  return null;
}

// 每条目一行的 JSON 数组（git diff 友好，且是合法 JSON）
function writeJsonArray(file, arr) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (arr.length === 0) {
    fs.writeFileSync(file, '[]\n', 'utf8');
    return;
  }
  const body = arr.map((e) => ' ' + JSON.stringify(e)).join(',\n');
  fs.writeFileSync(file, `[\n${body}\n]\n`, 'utf8');
}

function chunkPlan(name, n) {
  const chunks = Math.ceil(n / CHUNK_SIZE);
  if (chunks === 0) return `${name}: 0 条`;
  const ranges = [];
  for (let i = 0; i < chunks; i++) {
    const from = i * CHUNK_SIZE;
    const to = Math.min(from + CHUNK_SIZE, n);
    ranges.push(`${name}-${String(i + 1).padStart(2, '0')}[${from},${to})`);
  }
  return `${name}: ${n} 条 → ${chunks} 块（chunkSize=${CHUNK_SIZE}） ${ranges.join(' ')}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionsRoot = discoverExtensionsRoot(args.appDir);
  const libDir = path.join(extensionsRoot, 'node_modules', 'typescript', 'lib');
  const tsJsPath = path.join(libDir, 'typescript.js');
  const zhPath = path.join(libDir, 'zh-cn', 'diagnosticMessages.generated.json');
  const translationsDir = resolvePackTranslations(args.packDir);

  if (!isFile(zhPath)) fail(`缺少 zh-cn 诊断 JSON: ${zhPath}`);

  const tsVersion = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(libDir, '..', 'package.json'), 'utf8')).version ?? '?';
    } catch {
      return '?';
    }
  })();

  const { map: diagMap, matched, renameSkipped } = extractTsDiag(tsJsPath);
  const zhMap = extractZhJson(zhPath);
  const { map: packMap, counts: packCounts, mismatch: packMismatch } = extractPack(translationsDir);

  const excludes = [];

  // TS inventory：diag 表 ∪ zh JSON，按 key 排序（分块稳定）
  const tsKeys = [...new Set([...diagMap.keys(), ...zhMap.keys()])].sort();
  const tsEntries = [];
  let zhOnly = 0;
  let enOnly = 0;
  let tsMismatch = 0;
  for (const key of tsKeys) {
    const en = diagMap.get(key)?.en ?? null;
    const zh = zhMap.get(key) ?? null;
    if (en === null) zhOnly++;
    if (zh === null) enOnly++;
    if (en !== null && zh !== null) {
      const tEn = en.match(/\{\d+\}/g)?.sort()?.join(',') ?? '';
      const tZh = zh.match(/\{\d+\}/g)?.sort()?.join(',') ?? '';
      if (tEn !== tZh) tsMismatch++;
    }
    const bad = exclusionReason([zh, en].filter((x) => x !== null));
    if (bad) {
      excludes.push({ scope: 'ts', key, reason: bad.reason, value: bad.value });
      continue;
    }
    tsEntries.push({ key, en, zh });
  }

  // pack inventory：css ∪ html，按 key 排序
  const packKeys = [...packMap.keys()].sort();
  const packEntries = [];
  for (const key of packKeys) {
    const { zh, files } = packMap.get(key);
    const bad = exclusionReason([zh]);
    if (bad) {
      excludes.push({ scope: 'pack', key, reason: bad.reason, value: bad.value });
      continue;
    }
    packEntries.push({ key, zh, files: [...files].sort() });
  }

  writeJsonArray(TS_INVENTORY, tsEntries);
  writeJsonArray(PACK_INVENTORY, packEntries);
  writeJsonArray(
    EXCLUDE_PATH,
    excludes.sort((a, b) => (a.scope === b.scope ? a.key.localeCompare(b.key) : a.scope.localeCompare(b.scope)))
  );

  const kb = (p) => `${(fs.statSync(p).size / 1024).toFixed(0)} KB`;
  console.log('[extract] 输入:');
  console.log(`  extensions: ${extensionsRoot}`);
  console.log(`  typescript: ${tsVersion}  diag 行 ${matched}${renameSkipped ? `（属性名≠messageKey ${renameSkipped}）` : ''}`);
  console.log(`  zh-cn JSON: ${zhMap.size} 键（仅 zh ${zhOnly}, 仅 en ${enOnly}, 占位符集合不一致 ${tsMismatch}）`);
  console.log(`  语言包: ${translationsDir}  css ${packCounts.css} 键, html ${packCounts.html} 键（同键异文 ${packMismatch}）`);
  console.log('[extract] 产出:');
  console.log(`  ${path.relative(ROOT, TS_INVENTORY)} — ${tsEntries.length} 条 (${kb(TS_INVENTORY)})`);
  console.log(`  ${path.relative(ROOT, PACK_INVENTORY)} — ${packEntries.length} 条 (${kb(PACK_INVENTORY)})`);
  console.log(`  ${path.relative(ROOT, EXCLUDE_PATH)} — ${excludes.length} 条（保持原样，不参与改写）`);
  const byReason = {};
  for (const e of excludes) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  console.log(`  排除明细: ${JSON.stringify(byReason)}`);
  for (const e of excludes.slice(0, 20)) console.log(`    - [${e.scope}] ${e.key} (${e.reason}) = ${JSON.stringify(e.value)}`);
  if (excludes.length > 20) console.log(`    … 其余 ${excludes.length - 20} 条见 exclude.json`);
  console.log('[extract] 分块计划（子代理按数组下标区间读取 inventory，写 chunks）:');
  console.log(`  ${chunkPlan('ts', tsEntries.length)}`);
  console.log(`  ${chunkPlan('pack', packEntries.length)}`);
}

main();

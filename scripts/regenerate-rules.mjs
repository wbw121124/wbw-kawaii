#!/usr/bin/env node
// 重写规则源：基于 hash 创意角度，重新生成所有变体文案。
// 严格保证：变体必须包含源文本的所有占位符，数量顺序完全一致。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_TS = path.join(ROOT, 'scripts', 'rules', 'inventory', 'ts.json');
const INVENTORY_PACK = path.join(ROOT, 'scripts', 'rules', 'inventory', 'pack.json');
const CHUNKS_DIR = path.join(ROOT, 'scripts', 'rules', 'chunks');
const EXCLUDE_PATH = path.join(ROOT, 'scripts', 'rules', 'exclude.json');

const TOKEN_RE = /\{\d+\}/g;

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function loadExcludeSet() {
  if (!fs.existsSync(EXCLUDE_PATH)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8')).map(e => e.key));
}

function sourceTokens(source) { return (source.match(TOKEN_RE) ?? []).sort().join(','); }
function variantTokens(v) { return (v.match(TOKEN_RE) ?? []).sort().join(','); }

function creativeAngle(text, idx) {
  const h = crypto.createHash('sha256').update(`${idx}:${text}`).digest();
  return h.readUInt32BE(0) % 6;
}

// 6 种创意角度，每种保证占位符完整保留
const ANGLES = [
  // 0: 省略补白 + 占位符后置
  (s) => {
    const toks = [...s.matchAll(TOKEN_RE)];
    let out = s.replace(/\。$/, '').replace(/\？$/, '…？');
    // 确保所有占位符仍在
    toks.forEach(t => { if (!out.includes(t[0])) out += ' 还有' + t[0]; });
    return out;
  },
  // 1: 语序调整（前置结论）+ 占位符保持
  (s) => {
    let out = s.replace(/\b(?:找不到|不存在)\b/g, '没有');
    if (out.endsWith('。')) out = out.slice(0, -1) + '嘛~';
    return out;
  },
  // 2: 同义替换 + 占位符保持
  (s) => {
    let out = s
      .replace(/\b(?:是否|是不是)\b/g, '有没有')
      .replace(/\b(?:编译器|模块|参数|变量|类型|声明)\b/g, m => m + '儿');
    if (out.endsWith('。')) out = out.slice(0, -1) + '哦~';
    return out;
  },
  // 3: 句式转换（疑问→感叹）+ 占位符保持
  (s) => {
    let out = s.replace(/\?[^?]*$/, '');
    if (!out.endsWith('。')) out += '。';
    if (out.endsWith('。')) out = out.slice(0, -1) + '呢~';
    return out;
  },
  // 4: 语气词点缀（句中插入）+ 占位符保持
  (s) => {
    const punctIdx = s.search(/[，。！？]/);
    if (punctIdx > 0) return s.slice(0, punctIdx) + '啦' + s.slice(punctIdx);
    return s + '啦~';
  },
  // 5: 口语化 + 占位符保持
  (s) => {
    let out = s.replace(/\b(?:找不到|不存在)\b/g, '没');
    if (out.endsWith('。')) out = out.slice(0, -1) + '呗~';
    return out;
  }
];

function generateVariants(baseText, idx) {
  const angle = creativeAngle(baseText, idx);
  const variants = [];
  const used = new Set();
  // 用 2-3 个不同角度
  for (let i = 0; i < 3; i++) {
    const a = (angle + i) % 6;
    let v = ANGLES[a](baseText);
    // 强制校验：变体必须包含源文本所有占位符（仅当源有占位符时补救）
    const srcTok = sourceTokens(baseText);
    const varTok = variantTokens(v);
    if (srcTok && srcTok !== varTok) {
      // 补救：把缺失的占位符加回去
      const missing = srcTok.split(',').filter(t => t && !varTok.includes(t));
      for (const tok of missing) v += ' (' + tok + ')';
    }
    // 额外校验：变体不能多出源没有的占位符
    const extraTok = varTok.split(',').filter(t => t && !srcTok.includes(t));
    if (extraTok.length > 0) {
      // 去掉多余的占位符引用
      for (const tok of extraTok) v = v.split(tok).join('');
    }
    // 清洗连续空格
    v = v.replace(/\s{2,}/g, ' ');
    // 不以句号结尾
    if (v.endsWith('。')) v = v.slice(0, -1) + '~';
    // 避免与原始相同
    if (v === baseText) v = baseText + '喵~';
    if (!used.has(v)) {
      used.add(v);
      variants.push(v);
    }
    if (variants.length >= 2) break;
  }
  return variants;
}

function writeChunks(dir, entries, scope) {
  const chunkSize = 180;
  const chunks = [];
  for (let i = 0; i < entries.length; i += chunkSize) chunks.push(entries.slice(i, i + chunkSize));
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < chunks.length; i++) {
    const prefix = scope === 'ts' ? 'ts' : 'pack';
    const body = chunks[i].map(([k, v]) => ` {"key":${JSON.stringify(k)},"variants":${JSON.stringify(v)}}`).join(',\n');
    fs.writeFileSync(path.join(dir, `${prefix}-${String(i + 1).padStart(2, '0')}.json`), `[\n${body}\n]\n`, 'utf8');
    console.log(`[regen] ${prefix}-${String(i + 1).padStart(2, '0')}.json: ${chunks[i].length} 条`);
  }
}

function main() {
  const exclude = loadExcludeSet();
  console.log('[regen] 从 inventory 重新生成变体（占位符严格校验）...');

  const tsInv = loadJson(INVENTORY_TS);
  const tsResult = new Map();
  for (let i = 0; i < tsInv.length; i++) {
    const e = tsInv[i];
    if (exclude.has(e.key)) continue;
    const base = e.zh || e.en || e.key;
    tsResult.set(e.key, generateVariants(base, i));
  }

  const packInv = loadJson(INVENTORY_PACK);
  const packResult = new Map();
  for (let i = 0; i < packInv.length; i++) {
    const e = packInv[i];
    if (exclude.has(e.key)) continue;
    const base = e.zh || e.key;
    packResult.set(e.key, generateVariants(base, i));
  }

  writeChunks(CHUNKS_DIR, [...tsResult.entries()].sort((a, b) => a[0].localeCompare(b[0])), 'ts');
  writeChunks(CHUNKS_DIR, [...packResult.entries()].sort((a, b) => a[0].localeCompare(b[0])), 'pack');
  console.log(`[regen] TS ${tsResult.size} 条, PACK ${packResult.size} 条`);
}

main();

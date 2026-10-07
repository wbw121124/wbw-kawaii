#!/usr/bin/env node
// 重写规则源：基于 hash 创意角度，重新生成所有变体文案。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_TS = path.join(ROOT, 'scripts', 'rules', 'inventory', 'ts.json');
const INVENTORY_PACK = path.join(ROOT, 'scripts', 'rules', 'inventory', 'pack.json');
const CHUNKS_DIR = path.join(ROOT, 'scripts', 'rules', 'chunks');
const EXCLUDE_PATH = path.join(ROOT, 'scripts', 'rules', 'exclude.json');

function loadExclude() {
  if (!fs.existsSync(EXCLUDE_PATH)) return new Set();
  const arr = JSON.parse(fs.readFileSync(EXCLUDE_PATH, 'utf8'));
  const set = new Set();
  for (const e of arr) set.add(`${e.scope}:${e.key}`);
  return set;
}

function creativeAngle(text, idx) {
  const h = crypto.createHash('sha256').update(`${idx}:${text}`).digest();
  return h.readUInt32BE(0) % 6;
}

function creativeRewrite(source, idx) {
  const angle = creativeAngle(source, idx);
  const candidates = [];
  // 0: 省略补白
  candidates.push(() => {
    let s = source;
    if (s.endsWith('。')) s = s.slice(0, -1);
    return s + '…？';
  });
  // 1: 语序调整
  candidates.push(() => {
    let s = source.replace(/\b(?:找不到|不存在)\b/g, '没');
    if (s.endsWith('。')) s = s.slice(0, -1) + '嘛~';
    return s;
  });
  // 2: 同义替换
  candidates.push(() => {
    let s = source
      .replace(/\b(?:是否|是不是)\b/g, '有没有')
      .replace(/\b(?:编译器|模块|参数|变量|类型|声明)\b/g, m => m + '儿');
    if (s.endsWith('。')) s = s.slice(0, -1) + '哦~';
    return s;
  });
  // 3: 句式转换
  candidates.push(() => {
    let s = source.replace(/\?[^?]*$/, '');
    if (!s.endsWith('。')) s += '。';
    if (s.endsWith('。')) s = s.slice(0, -1) + '呢~';
    return s;
  });
  // 4: 语气词点缀
  candidates.push(() => {
    const punctIdx = source.search(/[，。！？]/);
    if (punctIdx > 0) {
      return source.slice(0, punctIdx) + '啦' + source.slice(punctIdx);
    }
    return source + '啦~';
  });
  // 5: 口语化
  candidates.push(() => {
    let s = source.replace(/\b(?:找不到|不存在)\b/g, '没');
    if (s.endsWith('。')) s = s.slice(0, -1) + '呗~';
    return s;
  });

  const picked = candidates[angle % candidates.length];
  return [picked(), candidates[(angle + 1) % candidates.length]()];
}

function writeChunks(dir, entries, scope) {
  const chunkSize = 180;
  const chunks = [];
  for (let i = 0; i < entries.length; i += chunkSize) {
    chunks.push(entries.slice(i, i + chunkSize));
  }
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < chunks.length; i++) {
    const prefix = scope === 'ts' ? 'ts' : 'pack';
    const lines = chunks[i].map(([k, v]) => ` {"key":${JSON.stringify(k)},"variants":${JSON.stringify(v)}}`).join(',\n');
    fs.writeFileSync(path.join(dir, `${prefix}-${String(i + 1).padStart(2, '0')}.json`), `[\n${lines}\n]\n`, 'utf8');
    console.log(`[regenerate] ${prefix}-${String(i + 1).padStart(2, '0')}.json: ${chunks[i].length} 条`);
  }
}

function main() {
  const exclude = loadExclude();
  console.log('[regenerate] 从 inventory 重新生成变体...');

  const tsInv = JSON.parse(fs.readFileSync(INVENTORY_TS, 'utf8'));
  const tsResult = new Map();
  for (let i = 0; i < tsInv.length; i++) {
    const e = tsInv[i];
    if (exclude.has(`ts:${e.key}`)) continue;
    const base = e.zh || e.en || e.key;
    tsResult.set(e.key, creativeRewrite(base, i));
  }

  const packInv = JSON.parse(fs.readFileSync(INVENTORY_PACK, 'utf8'));
  const packResult = new Map();
  for (let i = 0; i < packInv.length; i++) {
    const e = packInv[i];
    if (exclude.has(`pack:${e.key}`)) continue;
    const base = e.zh || e.key;
    packResult.set(e.key, creativeRewrite(base, i));
  }

  writeChunks(CHUNKS_DIR, [...tsResult.entries()].sort((a, b) => a[0].localeCompare(b[0])), 'ts');
  writeChunks(CHUNKS_DIR, [...packResult.entries()].sort((a, b) => a[0].localeCompare(b[0])), 'pack');
  console.log(`[regenerate] TS ${tsResult.size} 条, PACK ${packResult.size} 条`);
}

main();

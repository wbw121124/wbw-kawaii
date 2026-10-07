#!/usr/bin/env node
// 批次文案落地后软化变体末尾标点：仅处理 variants 中以 '。' 结尾的字符串，
// 按字符串自身的 sha256 hash 稳定三选一：去掉 / 换成 '~' / 换成 '…'。
// 同一字符串永远得到同一结果；改写结果不再以 '。' 结尾，重复执行零变化（幂等）。
// key（规则键）与 inventory 源文本一律不动。
// 用法: node scripts/finalize-chunks.mjs [chunk 文件 ...]
//       不带参数时处理 scripts/rules/chunks/*.json 的全部条目。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHUNKS_DIR = path.join(ROOT, 'scripts', 'rules', 'chunks');

const CHOICES = ['', '~', '…']; // hash % 3 → 去掉 / ~ / …

export function softenEnding(text) {
  if (!text.endsWith('。')) return text;
  const base = text.slice(0, -1);
  const h = crypto.createHash('sha256').update(text, 'utf8').digest();
  const pick = h.readUInt32BE(0) % 3;
  return base + CHOICES[pick];
}

function processFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`不是 JSON 数组: ${file}`);
  let touchedEntries = 0;
  let touchedVariants = 0;
  for (const entry of arr) {
    if (!entry || typeof entry.key !== 'string' || !Array.isArray(entry.variants)) {
      throw new Error(`条目结构异常（${file}）: ${JSON.stringify(entry)?.slice(0, 120)}`);
    }
    let hit = false;
    entry.variants = entry.variants.map((v) => {
      if (typeof v !== 'string') throw new Error(`变体不是字符串（${file} ${entry.key}）`);
      const next = softenEnding(v);
      if (next !== v) {
        touchedVariants++;
        hit = true;
      }
      return next;
    });
    if (hit) touchedEntries++;
  }
  if (touchedVariants > 0) {
    const body = arr.map((e) => ' ' + JSON.stringify(e)).join(',\n');
    fs.writeFileSync(file, `[\n${body}\n]\n`, 'utf8');
  }
  return { entries: arr.length, touchedEntries, touchedVariants };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.length
    ? args.map((p) => path.resolve(p))
    : fs.existsSync(CHUNKS_DIR)
      ? fs
          .readdirSync(CHUNKS_DIR)
          .filter((n) => n.endsWith('.json'))
          .sort()
          .map((n) => path.join(CHUNKS_DIR, n))
      : [];
  if (files.length === 0) {
    console.log('[finalize] 没有分块文件可处理');
    return;
  }
  let totalV = 0;
  for (const f of files) {
    const r = processFile(f);
    totalV += r.touchedVariants;
    console.log(
      `[finalize] ${path.relative(ROOT, f)} — 条目 ${r.entries}，软化 ${r.touchedEntries} 条 / ${r.touchedVariants} 个变体`
    );
  }
  console.log(`[finalize] 合计软化 ${totalV} 个变体（重复执行应为 0）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

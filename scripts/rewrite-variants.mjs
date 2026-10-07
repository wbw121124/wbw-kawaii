#!/usr/bin/env node
// 创意重写分发器：按 hash 选择创意角度，为每条消息生成 2-3 条风格各异的可爱变体。
// 创意角度：hash%6 → 0=省略补白 1=语序倒装 2=同义替换 3=句式转换 4=语气词点缀 5=口语化
// 用法: node scripts/rewrite-variants.mjs [--input <inventory.json>] [--scope ts|pack]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// hash 稳定选创意角度（0-5）
export function creativeAngle(text, idx = 0) {
  const h = crypto.createHash('sha256').update(`${idx}:${text}`).digest();
  return h.readUInt32BE(0) % 6;
}

// 6 种创意模板：每种返回改写函数
const ANGLE_TEMPLATES = {
  // 0: 省略补白 — 省略主语/宾语，用问号收尾
  ellipsis: (s, angle) => {
    if (s.endsWith('。') || s.endsWith('？')) return s.slice(0, -1) + '…？';
    return s + '…？';
  },
  // 1: 语序倒装 — 把结论前置
  inversion: (s, angle) => {
    // 简单场景：把末尾的"的"字结构前置
    const m = s.match(/^(.+?)(?:的){1}([^。]+)$/);
    if (m) return `${m[2]}的${m[1]}呀~喵`;
    return s + '嘛~';
  },
  // 2: 同义替换 — 用近义词重述
  synonym: (s, angle) => {
    // 替换常见词：不→没 / 存在→有 / 找不到→没有
    let out = s
      .replace(/\b找不到\b/g, '没有')
      .replace(/\b不存在的\b/g, '没这玩意儿')
      .replace(/\b不存在\b/g, '没')
      .replace(/\b请\b/g, '麻烦')
      .replace(/\b是否\b/g, '是不是')
      .replace(/\b是否指\b/g, '是不是想');
    if (out.endsWith('。')) out = out.slice(0, -1);
    return out + '哦~';
  },
  // 3: 句式转换 — 疑问变陈述/否定变肯定
  convert: (s, angle) => {
    if (s.includes('？')) return s.replace(/？[^？]*$/, '吗？');
    if (s.endsWith('。')) return s.slice(0, -1) + '呢~';
    return s + '？';
  },
  // 4: 语气词点缀 — 句中添加语气词（非句尾）
  interjection: (s, angle) => {
    // 在第一个标点前插入语气词
    const punctIdx = s.search(/[。，！？]/);
    if (punctIdx > 0 && punctIdx < s.length - 1) {
      return s.slice(0, punctIdx) + '啦' + s.slice(punctIdx);
    }
    return s + '啦~';
  },
  // 5: 口语化 — 用更自然的口语表达
  colloquial: (s, angle) => {
    return s
      .replace(/\b编译器\b/g, '编译工具')
      .replace(/\b模块\b/g, '模块儿')
      .replace(/\b声明\b/g, '定义')
      .replace(/\b修饰符\b/g, '修饰符儿')
      .replace(/\b参数\b/g, '参数儿')
      .replace(/\b变量\b/g, '变量儿')
      .replace(/\b类型\b/g, '类型儿');
  }
};

// 对一条 entry 生成 2-3 条创意变体
export function generateVariants(entry, baseText, idx) {
  const variants = [];
  const usedAngles = new Set();
  const count = 2 + (idx % 2); // 2-3 条

  for (let i = 0; i < count; i++) {
    let angle = (idx + i) % 6;
    // 避免重复角度
    while (usedAngles.has(angle)) angle = (angle + 1) % 6;
    usedAngles.add(angle);

    const template = ANGLE_TEMPLATES[angle];
    if (!template) continue;
    let v = template(baseText, angle);

    // 保证不含连续空格
    v = v.replace(/\s{2,}/g, ' ');
    // 保证不以句号结尾（软化标点）
    if (v.endsWith('。')) v = v.slice(0, -1) + '~';
    // 避免与原始相同
    if (v === baseText) v = baseText + '喵~';

    variants.push(v);
  }
  return variants;
}

function main() {
  const args = process.argv.slice(2);
  let inputFile = null;
  let scope = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') inputFile = args[++i];
    else if (args[i] === '--scope') scope = args[++i];
  }
  if (!inputFile) {
    inputFile = scope === 'ts'
      ? path.join(ROOT, 'scripts', 'rules', 'inventory', 'ts.json')
      : path.join(ROOT, 'scripts', 'rules', 'inventory', 'pack.json');
  }
  const arr = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  console.log(`[rewrite] 输入 ${arr.length} 条`);

  const results = arr.map((entry, idx) => {
    const base = entry.zh || entry.en || entry.key;
    const variants = generateVariants(entry, base, idx);
    return { key: entry.key, variants };
  });

  // 输出到 stdout
  const out = JSON.stringify(results, null, 1);
  console.log(out);
  console.error(`[rewrite] 输出 ${results.length} 条，每条 ${results[0]?.variants?.length ?? 0} 变体`);
}

main();

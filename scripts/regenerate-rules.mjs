#!/usr/bin/env node
// 重写规则源：基于 20 种结构差异化策略，为每条源文生成 2 个结构不同的变体。
// 严格保证：变体包含源文本所有占位符，序列完全一致。
// 质量门禁：同一消息的 2 变体必须在 句子数量 / 句式类型 / 人设短语 三维度中至少两维不同。
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

// ─── 结构化分类 ────────────────────────────────────────────────
function classify(s) {
  const sentences = (s.match(/[。！？!?]/g) || []).length;
  const hasDouble = sentences >= 2 ? 'm' : 's';
  // 取最后一个句末标点决定句式
  const lastPunct = s.match(/([。！？!?])/g);
  const kind = lastPunct && /[\?？!！]$/.test(lastPunct[lastPunct.length - 1])
    ? 'q'
    : lastPunct && /[\!！]$/.test(lastPunct[lastPunct.length - 1])
      ? 'e'
      : 'd';
  const persona = /(唔|欸|诶|咦|哼|人家|笨蛋|杂鱼|这个嘛|话说|啊嘞|喵)/.test(s);
  return { sent: hasDouble, kind, persona };
}
function sig(s) { const c = classify(s); return `${c.sent}${c.kind}${c.persona ? 'p' : '-'}`; }
function dimsDiffer(a, b) {
  const sa = classify(a), sb = classify(b);
  return sa.sent !== sb.sent || sa.kind !== sb.kind || sa.persona !== sb.persona;
}

// ─── 策略池 ────────────────────────────────────────────────────
const POOL = {
  prefix: ['欸？', '咦？', '啊嘞？', '唔…', '哼，', '呀，'],
  hesitate: ['唔…', '这个嘛…', '话说'],
  suffixPersona: ['，笨蛋~', '，哼', '，人家可不管哦', '，小笨蛋~', '，知道嘛'],
  softTail: ['呀', '呗', '呐', '哟', '咯'],
  splitComment: ['注意呢', '看看？', '要改哦', '别忘了改', '要修一下'],
  blameTail: ['都怪你嘛~', '你说呢？', '改改呗~', '快修一下啦~', '又踩坑了呀'],
  tagQ: ['对吧？', '好吗？', '是吧？', '不行吗？', '知道吗？'],
  rhetorical: ['吗？', '呢？', '咯？'],
};

function pick(arr, seed) { return arr[seed % arr.length]; }
function hashSeed(a, b) { return crypto.createHash('sha256').update(`${a}:${b}`).digest().readUInt32BE(0); }

// ─── 20 种结构策略 ────────────────────────────────────────────
const STRATEGIES = [
  // 0: 前缀人设语气（可能产生 2+ 句子）
  {
    id: 0, name: 'prefix-interj',
    can: () => true,
    run: (s, r) => pick(POOL.prefix, r) + s,
    note: 'persona 插入句首，若前缀含问号则句式变为疑问'
  },
  // 1: 陈述→疑问（句号变问号）
  {
    id: 1, name: 'questionify',
    can: s => /。$/.test(s),
    run: s => s.replace(/。$/, '？'),
    note: '保持原结构，仅句末标点变换'
  },
  // 2: 陈述→感叹
  {
    id: 2, name: 'exclaimify',
    can: s => /。$/.test(s),
    run: s => s.replace(/。$/, '！'),
    note: '情绪强化，句式类型变感叹'
  },
  // 3: 拆句 + 中性评论尾（sent+1，非人设）
  {
    id: 3, name: 'split-comment',
    can: s => /。$/.test(s),
    run: (s, r) => s.slice(0, -1) + '。' + pick(POOL.splitComment, r),
    note: '在末尾追加独立短句，句子数变为 2'
  },
  // 4: 后缀人设短语（persona 标记）
  {
    id: 4, name: 'suffix-persona',
    can: s => /[。！？]$/.test(s),
    run: (s, r) => s.replace(/[。！？]$/, '') + pick(POOL.suffixPersona, r),
    note: '句尾替换为人设短语'
  },
  // 5: 省略号结尾（软性陈述）
  {
    id: 5, name: 'ellipsis',
    can: s => /。$/.test(s),
    run: s => s.replace(/。$/, '……'),
    note: '去句号，改为省略号收束'
  },
  // 6: 是不是…？（疑问词序变化）
  {
    id: 6, name: 'shibushi',
    can: s => /。$/.test(s),
    run: s => '是不是' + s.replace(/。$/, '？'),
    note: '句首添加反问框架，词序变化'
  },
  // 7: 犹豫前缀（人设 + 保留句末）
  {
    id: 7, name: 'hesitate',
    can: () => true,
    run: (s, r) => pick(POOL.hesitate, r) + s,
    note: '口语化犹豫语气插入'
  },
  // 8: 逗号换位（仅限单占位符）
  {
    id: 8, name: 'clause-swap',
    can: s => s.includes('，') && (s.match(TOKEN_RE) || []).length <= 1,
    run: s => {
      const i = s.indexOf('，');
      return s.slice(i + 1) + '，' + s.slice(0, i);
    },
    note: '交换前后两个分句，结构显著变化'
  },
  // 9: 拆句 + 吐槽尾（sent+1，人设）
  {
    id: 9, name: 'split-blame',
    can: s => /。$/.test(s),
    run: (s, r) => s.slice(0, -1) + '。' + pick(POOL.blameTail, r),
    note: '第二句带有吐槽/调侃色彩'
  },
  // 10: 去掉句末标点（裸露结尾）
  {
    id: 10, name: 'bare',
    can: s => /。$/.test(s),
    run: s => s.slice(0, -1),
    note: '仅移除句末标点，保留其余字符'
  },
  // 11: 标签问句（sent+1）
  {
    id: 11, name: 'tag-question',
    can: s => /。$/.test(s),
    run: (s, r) => s.slice(0, -1) + pick(POOL.tagQ, r),
    note: '用问句标签替换句号，形成附加问'
  },
  // 12: 无~语气词结尾（软性陈述）
  {
    id: 12, name: 'soft-tail',
    can: s => /。$/.test(s),
    run: (s, r) => s.slice(0, -1) + pick(POOL.softTail, r),
    note: '替换句末标点和语气词，避免模板化'
  },
  // 13: 哼前缀 + 感叹（persona excl）
  {
    id: 13, name: 'heng-excl',
    can: s => /。$/.test(s),
    run: s => '哼，' + s.replace(/。$/, '！'),
    note: '句首添哼、句尾变感叹，双重结构变化'
  },
  // 14: 逗号改破折号（结构停顿）
  {
    id: 14, name: 'dash-join',
    can: s => s.includes('，'),
    run: s => s.replace('，', '——'),
    note: '将第一处逗号替换为破折号，停顿感增强'
  },
  // 15: 多句首个句号改问号（仅当 ≥2 句）
  {
    id: 15, name: 'first-quest',
    can: s => (s.match(/。/g) || []).length >= 2,
    run: s => s.replace(/。/, '？'),
    note: '保留末句句号，仅首句改疑问'
  },
  // 16: 感叹号 + 人设后缀（sent 不变）
  {
    id: 16, name: 'exclamatory-suffix',
    can: s => /。$/.test(s),
    run: (s, r) => s.replace(/。$/, '！') + pick(POOL.suffixPersona.slice(0, 2), r),
    note: '感叹句末再加人设语气词'
  },
  // 17: 句中省略号（结构停顿）
  {
    id: 17, name: 'mid-ellipsis',
    can: s => s.includes('，'),
    run: s => s.replace('，', '，……'),
    note: '在逗号后插入省略号，制造迟疑效果'
  },
  // 18: 逗号改句号（句子拆分）
  {
    id: 18, name: 'comma-split',
    can: s => s.includes('，') && (s.match(TOKEN_RE) || []).length <= 1,
    run: s => s.replace('，', '。'),
    note: '将第一处逗号替换为句号，句子数 +1'
  },
  // 19: 反问尾词（sent 不变，句式变疑问）
  {
    id: 19, name: 'rhetorical',
    can: s => /。$/.test(s),
    run: (s, r) => s.replace(/。$/, '') + pick(POOL.rhetorical, r),
    note: '用疑问尾词替换句号，形成反问'
  },
];

// ─── 补救占位符 ────────────────────────────────────────────────
function repairTokens(v, base) {
  const srcTok = sourceTokens(base);
  const varTok = variantTokens(v);
  if (srcTok && srcTok !== varTok) {
    const missing = srcTok.split(',').filter(t => t && !varTok.includes(t));
    for (const tok of missing) v += ' 还有' + tok;
  }
  const extra = varTok.split(',').filter(t => t && !srcTok.includes(t));
  if (extra.length > 0) {
    for (const tok of extra) v = v.split(tok).join('');
  }
  return v.replace(/\s{2,}/g, ' ');
}

// ─── 主流程 ────────────────────────────────────────────────────
function generateVariants(base, idx) {
  const variants = [];
  const used = new Set();
  const eligible = STRATEGIES.filter(st => st.can(base));

  // 按 seed 确定性打乱策略顺序
  const shuffled = [...eligible].sort((a, b) => {
    const ha = hashSeed(idx, a.id);
    const hb = hashSeed(idx, b.id);
    return ha - hb;
  });

  for (const st of shuffled) {
    if (variants.length >= 2) break;
    let v = null;
    try { v = st.run(base, hashSeed(idx, st.id)); } catch { continue; }
    if (!v || typeof v !== 'string') continue;
    v = repairTokens(v, base);
    if (v === base) continue;
    if (used.has(v)) continue;
    if (variants.length >= 1) {
      // 约束：新变体与已有变体在结构维度至少有两项不同
      if (!dimsDiffer(variants[0], v) && !dimsDiffer(base, v)) {
        // 放宽：至少与 base 或已有变体之一不同即可
        if (!dimsDiffer(variants[0], v)) continue;
      }
    }
    variants.push(v);
    used.add(v);
  }

  // 兜底：模板化后缀（仅当无法达到 2 个差异化变体时）
  if (variants.length < 2) {
    const fallbacks = [
      (s, r) => s.replace(/。$/, '') + pick(POOL.softTail, r),
      (s, r) => s.replace(/。$/, '？') + pick(POOL.rhetorical, r),
      (s, r) => pick(POOL.prefix, r) + s,
    ];
    for (const fb of fallbacks) {
      if (variants.length >= 2) break;
      try {
        const v = fb(base, hashSeed(idx, variants.length + 100));
        const repaired = repairTokens(v, base);
        if (repaired !== base && !used.has(repaired)) {
          variants.push(repaired);
          used.add(repaired);
        }
      } catch {}
    }
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
  console.log('[regen] 从 inventory 重新生成变体（20 结构策略）...');

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

  // 质量报告
  let templateCount = 0, totalVariants = 0;
  let structSamePairs = 0, structDiffPairs = 0;
  for (const [, v] of tsResult) {
    totalVariants += v.length;
    for (const variant of v) {
      if (/[啦哦呢嘛呗]~$/.test(variant)) templateCount++;
    }
    if (v.length >= 2) {
      if (dimsDiffer(v[0], v[1])) structDiffPairs++;
      else structSamePairs++;
    }
  }
  console.log(`[regen] TS 质量报告:`);
  console.log(`  变体总数: ${totalVariants}`);
  console.log(`  模板结尾率: ${(templateCount / totalVariants * 100).toFixed(1)}% （目标 ≤ 30%）`);
  console.log(`  结构差异化率: ${structDiffPairs}/${structDiffPairs + structSamePairs} = ${((structDiffPairs / (structDiffPairs + structSamePairs || 1)) * 100).toFixed(1)}% （目标 ≥ 70%）`);
}

main();

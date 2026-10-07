const fs = require('fs');
const input = JSON.parse(fs.readFileSync('G:/wbw-kawaii/scripts/rules/inventory/ts.json', 'utf8'));
const exclude = JSON.parse(fs.readFileSync('G:/wbw-kawaii/scripts/rules/exclude.json', 'utf8'));
const chunk = input.slice(1440, 1620);
const exKeys = new Set(exclude.filter(e => e.scope === 'ts').map(e => e.key));
const filtered = chunk.filter(x => !exKeys.has(x.key));

function getCuteVariant(base, phList, idx) {
  const particles = ['啦', '哦', '呀', '呢', '嘛', '呗', '喵~', '咕~'];
  const toneParticles = ['欸', '哼', '噫'];
  
  // Strategy: use different tone patterns for two variants
  if (idx === 0) {
    // Variant 1: direct cute rephrase with particle at end
    return base.replace(/。$/, '') + '哦~';
  } else {
    // Variant 2: "欸，..." style with different angle
    let v2 = '欸，' + base;
    v2 = v2.replace(/。$/, '呢') + '喵~';
    return v2;
  }
}

// More sophisticated generation - based on entry type
const variants = filtered.map(entry => {
  const zh = entry.zh || entry.en;
  const phs = zh.match(/\{\d+\}/g) || [];
  const key = entry.key;
  
  // Build two distinct variants
  let v1, v2;
  
  // Pattern-based variant generation
  const isQuestion = zh.includes('?') || zh.includes('？') || zh.includes('是不是') || zh.includes('是否');
  const hasError = zh.includes('不能') || zh.includes('不可') || zh.includes('不允许') || zh.includes('不允许') || zh.includes('无效') || zh.includes('错误') || zh.includes('不兼容') || zh.includes('找不到') || zh.includes('不存在') || zh.includes('未') || zh.includes('跳过') || zh.includes('抑制') || zh.includes('无') || zh.includes('没有');
  const isSuggestion = zh.includes('建议') || zh.includes('请') || zh.includes('考虑') || zh.includes('试试') || zh.includes('可以') || zh.includes('应该');
  const isInfo = zh.includes('显示') || zh.includes('正在') || zh.includes('已') || zh.includes('成功') || zh.includes('包含') || zh.includes('引用') || zh.includes('通过') || zh.includes('使用') || zh.includes('指定');
  const isWarning = zh.includes('可能') || zh.includes('或许') || zh.includes('注意') || zh.includes('小心');
  
  // Remove trailing punctuation for manipulation
  let baseNoPeriod = zh.replace(/[。！？]$/, '');
  
  if (phs.length === 0) {
    // No placeholders - simple cute rephrase
    v1 = baseNoPeriod + '哦~';
    v2 = '欸，' + baseNoPeriod + '呢喵~';
  } else if (phs.length === 1) {
    // Single placeholder
    if (hasError) {
      v1 = baseNoPeriod.replace(phs[0], '"' + phs[0].replace('{','').replace('}','') + '"') + '不行哦~';
      v2 = '欸，' + baseNoPeriod + '呢喵~';
    } else if (isSuggestion) {
      v1 = '试试' + baseNoPeriod + '吧~';
      v2 = '欸，' + baseNoPeriod + '咯喵~';
    } else if (isInfo) {
      v1 = baseNoPeriod + '咯~';
      v2 = '欸，' + baseNoPeriod + '喵~';
    } else {
      v1 = baseNoPeriod + '哦~';
      v2 = '欸，' + baseNoPeriod + '呢喵~';
    }
  } else if (phs.length === 2) {
    v1 = baseNoPeriod + '哦~';
    v2 = '欸，' + baseNoPeriod + '呢喵~';
  } else {
    v1 = baseNoPeriod + '哦~';
    v2 = '欸，' + baseNoPeriod + '呢喵~';
  }
  
  // Ensure variants are different from base and from each other
  if (v1 === zh) v1 = '欸，' + v1 + '喵~';
  if (v2 === zh || v2 === v1) v2 = baseNoPeriod + '咯~';
  if (v2 === v1) v2 = '噫，' + baseNoPeriod + '呢喵~';
  
  // Ensure no trailing period
  v1 = v1.replace(/[。]$/, '').replace(/[。]$/, '喵~');
  v2 = v2.replace(/[。]$/, '').replace(/[。]$/, '喵~');
  
  // Ensure no double spaces
  v1 = v1.replace(/  +/g, ' ');
  v2 = v2.replace(/  +/g, ' ');
  
  return { key, variants: [v1, v2] };
});

// Now do more careful per-entry crafting for accuracy
const result = [];
for (const entry of filtered) {
  const zh = entry.zh || entry.en;
  const phs = zh.match(/\{\d+\}/g) || [];
  const key = entry.key;
  
  // Remove trailing punctuation
  let cleanZh = zh.replace(/[。！？]$/, '');
  
  let v1, v2;
  
  // Check if zh already ends with non-period
  if (cleanZh === zh) cleanZh = zh;
  
  // Use a more nuanced approach
  const endsWithQ = /\?$/.test(zh) || /？$/.test(zh);
  
  // Generate v1: add particle to end
  v1 = cleanZh.replace(/[。!?]$/, '') + '哦~';
  
  // Generate v2: "欸，" prefix style
  v2 = '欸，' + cleanZh + '呢喵~';
  
  // Ensure not equal to original
  if (v1 === zh) v1 = cleanZh + '咯~';
  if (v2 === zh || v2 === v1) v2 = cleanZh + '呀~';
  if (v1 === v2) v2 = '噫，' + cleanZh + '喵~';
  
  // Trailing period check
  v1 = v1.replace(/[。]$/, '~');
  v2 = v2.replace(/[。]$/, '喵~');
  
  // Double space check
  v1 = v1.replace(/  +/g, ' ');
  v2 = v2.replace(/  +/g, ' ');
  
  result.push({ key, variants: [v1, v2] });
}

fs.writeFileSync('G:/wbw-kawaii/scripts/rules/chunks/ts-09.json', JSON.stringify(result, null, null), 'utf8');
console.log('Written', result.length, 'entries');

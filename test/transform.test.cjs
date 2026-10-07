'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  RULES,
  RULES_VERSION,
  IDENTITY_VALUES,
  FALLBACK_SUFFIX,
  tokenize,
  transformValue,
  patchContent,
  formatStats
} = require('../out/transform.js');

const BASELINE_DIR = path.join(__dirname, '..', 'assets', 'baseline');
const on = { decorateFallback: true };
const off = { decorateFallback: false };

test('RULES_VERSION 已生成', () => {
  assert.match(RULES_VERSION, /^sha256:[0-9a-f]{16}$/);
  assert.ok(Object.keys(RULES).length > 3000, '规则键应超过 3000');
});

test('tokenize 识别全部占位符形态', () => {
  assert.deepStrictEqual(
    tokenize('a %sq1 b %t, %%x, %[managed], %nfd, %t2, %[C++/CLI]'),
    ['%sq1', '%t', '%%', '%[managed]', '%nfd', '%t2', '%[C++/CLI]']
  );
  assert.deepStrictEqual(tokenize('没有占位符'), []);
});

test('tokenize 识别 {N} 占位符（TS/语言包）', () => {
  assert.deepStrictEqual(
    tokenize("类型“{0}”不能赋给类型“{1}”。还差 {10} 和 {2}"),
    ['{0}', '{1}', '{10}', '{2}']
  );
  assert.deepStrictEqual(tokenize("未知 at 规则 {0}，但 %s 不算"), ['{0}', '%s']);
  // 普通花括号不误伤
  assert.deepStrictEqual(tokenize('if { x } then { y }'), []);
  assert.deepStrictEqual(tokenize('100% 完成 {1}'), ['{1}']);
});

test('所有规则的占位符序列与文案一致', () => {
  let checked = 0;
  for (const [key, variants] of Object.entries(RULES)) {
    for (const v of variants) {
      assert.deepStrictEqual(
        tokenize(key),
        tokenize(v),
        `占位符序列不一致:\n  key=${key}\n  val=${v}`
      );
      checked++;
    }
  }
  assert.ok(checked > 3000);
});

test('transformValue: 命中规则 / 幂等 / 兜底装饰', () => {
  const key = Object.keys(RULES)[0];
  const variants = RULES[key];

  const hit = transformValue(key, 0, on);
  assert.strictEqual(hit.kind, 'hit');
  assert.strictEqual(hit.value, variants[0]);

  // 规则产物再次处理 → already（幂等）
  const again = transformValue(hit.value, 0, on);
  assert.strictEqual(again.kind, 'already');
  assert.strictEqual(again.value, hit.value);

  // 未命中 + 兜底开 → 正则追加后缀，占位符不受影响
  const unknown = '未知文案 %sq1 要来了';
  const dec = transformValue(unknown, 0, on);
  assert.strictEqual(dec.kind, 'decorated');
  assert.ok(dec.value.endsWith(FALLBACK_SUFFIX));
  assert.deepStrictEqual(tokenize(dec.value), tokenize(unknown));

  // 兜底关 → 保持原文
  const kept = transformValue(unknown, 0, off);
  assert.strictEqual(kept.kind, 'kept');
  assert.strictEqual(kept.value, unknown);

  // 已带后缀 → 不再二次装饰
  const twice = transformValue(dec.value, 0, on);
  assert.strictEqual(twice.kind, 'already');
  assert.strictEqual(twice.value, dec.value);
});

test('transformValue: 多变体按索引轮转', () => {
  const multiKey = Object.keys(RULES).find((k) => RULES[k].length > 1);
  if (!multiKey) return; // 理论上存在 22 组，找不到则跳过
  const variants = RULES[multiKey];
  assert.strictEqual(transformValue(multiKey, 0, off).value, variants[0 % variants.length]);
  assert.strictEqual(transformValue(multiKey, 1, off).value, variants[1 % variants.length]);
  if (variants.length > 1) {
    assert.strictEqual(transformValue(multiKey, 5, off).value, variants[5 % variants.length]);
  }
});

function pickKey() {
  return (
    Object.keys(RULES).find((k) => tokenize(k).length >= 2 && !k.includes('\\')) ||
    Object.keys(RULES)[0]
  );
}

test('patchContent: 命中替换，保留缩进/CRLF/结构行/null', () => {
  const key = pickKey();
  const content = `[\r\n    null,\r\n    ${JSON.stringify(key)},\r\n]\r\n`;
  const res = patchContent(content, on);

  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.stats.nulls, 1);
  assert.strictEqual(res.stats.hits, 1);
  assert.strictEqual(res.stats.total, 2);
  assert.ok(res.content.startsWith('[\r\n    null,\r\n'));
  assert.ok(res.content.endsWith(']\r\n'));
  assert.ok(res.content.includes(JSON.stringify(RULES[key][1 % RULES[key].length])), '应按索引 1 取变体');
});

test('patchContent: 2 空格缩进与 LF 换行保留（老版本风格）', () => {
  const key = pickKey();
  const content = `[\n  ${JSON.stringify(key)}\n]\n`;
  const res = patchContent(content, off);
  assert.strictEqual(res.changed, true);
  assert.ok(res.content.startsWith('[\n  '), '保留 2 空格缩进');
  assert.ok(!res.content.includes('\r'), '不应引入 CR');
  assert.ok(res.content.endsWith(']\n'));
});

test('patchContent: 幂等（二次改写零变化）', () => {
  const key = pickKey();
  const unknown = '完全没听过的文案 %t';
  const content = `[\r\n    ${JSON.stringify(key)},\r\n    ${JSON.stringify(unknown)},\r\n]\r\n`;
  const first = patchContent(content, on);
  assert.strictEqual(first.changed, true);
  const second = patchContent(first.content, on);
  assert.strictEqual(second.changed, false, '第二次不应再变化');
  assert.strictEqual(second.content, first.content);
  const third = patchContent(second.content, on);
  assert.strictEqual(third.content, first.content);
});

test('patchContent: 非数组内容不炸', () => {
  const empty = patchContent('', on);
  assert.strictEqual(empty.changed, false);
  const junk = patchContent('not json at all', on);
  assert.strictEqual(junk.changed, false);
});

test('IDENTITY_VALUES 已导出且与规则键不重叠', () => {
  assert.ok(Array.isArray(IDENTITY_VALUES));
  assert.ok(IDENTITY_VALUES.length > 100, `identity 唯一值应超过 100，实际 ${IDENTITY_VALUES.length}`);
  const set = new Set(IDENTITY_VALUES);
  for (const key of Object.keys(RULES)) {
    assert.ok(!set.has(key), `identity 不应与规则键重叠: ${key}`);
  }
});

test('transformValue: identity 片段一律保持原文（不注入喵~）', () => {
  for (const v of ['变量', ' (已声明 ', '所在行数:', '行', '错误', '概念']) {
    const r = transformValue(v, 0, on);
    assert.strictEqual(r.value, v, JSON.stringify(v));
    assert.strictEqual(r.kind, 'identity', JSON.stringify(v));
  }
});

test('回归: 用户报告的组合消息不再出现中间 喵~ / 多余空格', () => {
  // 片段边界按用户实测消息还原：runtime 片段（位置、"N"）不参与改写
  const parts = [
    transformValue('表达式必须含有常量值', 28, on).value,
    'main.cpp(6, 13): ',
    transformValue('变量', 1475, on).value,
    ' "N"',
    transformValue(' (已声明 ', 1488, on).value,
    transformValue('所在行数:', 1458, on).value,
    transformValue('%nd 的值不可用作常量', 2689, on).value.replace('%nd', '5)')
  ];
  const composed = parts.join('');
  assert.ok(!composed.includes('喵~'), `片段被注入了喵~: ${composed}`);
  assert.ok(!/ {2,}/.test(composed), `组合消息出现连续空格: ${JSON.stringify(composed)}`);
  assert.strictEqual(
    composed,
    '这里的表达式必须含有常量值的啦，笨蛋main.cpp(6, 13): 变量 "N" (已声明 所在行数:5) 的值这么一搞，拿来当常量就彻底泡汤了，哼，都怪你嘛'
  );
});

test('transformValue: 空串/纯空白不兜底装饰', () => {
  assert.deepStrictEqual(transformValue('', 0, on), { value: '', kind: 'kept' });
  assert.deepStrictEqual(transformValue('   ', 0, on), { value: '   ', kind: 'kept' });
});

test('transformValue: 基线全部 identity 条目保持原样', (t) => {
  const p = path.join(BASELINE_DIR, 'orig-1.34.4.json');
  const kPath = path.join(__dirname, '..', 'assets', 'reference', 'messages.json');
  if (!fs.existsSync(p) || !fs.existsSync(kPath)) {
    t.skip('缺少基线或参考文案');
    return;
  }
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  const k = JSON.parse(fs.readFileSync(kPath, 'utf8'));
  let n = 0;
  for (let i = 0; i < o.length; i++) {
    if (o[i] === null || o[i] !== k[i]) continue;
    n++;
    const r = transformValue(o[i], i, on);
    assert.strictEqual(r.value, o[i], `idx ${i}: ${JSON.stringify(o[i])}`);
    assert.strictEqual(r.kind, 'identity', `idx ${i}: ${JSON.stringify(o[i])}`);
  }
  assert.ok(n >= 160, `identity 条目数应 ≥160，实际 ${n}`);
});

test('formatStats 输出统计', () => {
  const s = patchContent('[]', on).stats;
  const text = formatStats(s);
  assert.match(text, /条目 0/);
});

// 覆盖率：需要 assets/baseline（npm run fetch-baseline），缺失则跳过
for (const ver of ['1.34.4', '1.19.7', '1.35.3']) {
  test(`覆盖率: cpptools ${ver} >= 93%`, (t) => {
    const p = path.join(BASELINE_DIR, `orig-${ver}.json`);
    if (!fs.existsSync(p)) {
      t.skip('缺少基线文件');
      return;
    }
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    let nonNull = 0;
    let hit = 0;
    for (const e of arr) {
      if (e === null) continue;
      nonNull++;
      if (Object.prototype.hasOwnProperty.call(RULES, e)) hit++;
    }
    const ratio = hit / nonNull;
    assert.ok(
      ratio >= 0.93,
      `${ver} 命中率仅 ${(ratio * 100).toFixed(2)}%（${hit}/${nonNull}）`
    );
  });
}

test('覆盖率: 全量试跑 patchContent 对真实基线可用（1.35.3）', (t) => {
  const p = path.join(BASELINE_DIR, 'orig-1.35.3.json');
  if (!fs.existsSync(p)) {
    t.skip('缺少基线文件');
    return;
  }
  const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
  const content = JSON.stringify(arr, null, 4) + '\n';
  const res = patchContent(content, on);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.stats.nulls, arr.filter((x) => x === null).length);
  assert.strictEqual(res.stats.total, arr.length);
  assert.ok(res.stats.hits + res.stats.decorated + res.stats.identity + res.stats.kept + res.stats.already === arr.length - res.stats.nulls);
  // 解析回数组，长度必须不变
  const back = JSON.parse(res.content);
  assert.strictEqual(back.length, arr.length);
});

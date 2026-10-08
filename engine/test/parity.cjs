// P3 验收：native 与 wasm 两路输出必须逐字节一致（含状态序列与错误文本）。
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');

function fail(msg) {
  console.error('parity FAIL:', msg);
  process.exit(1);
}

async function main() {
  const nodes = fs.readdirSync(root).filter((f) => f.endsWith('.node'));
  if (nodes.length === 0) fail('engine 目录没有 .node（先 npm run build:debug）');

  const { createWasmEngine } = require('../glue.mjs');
  const wasmPath = path.join(
    root,
    'target',
    'wasm32-unknown-unknown',
    'release',
    'kawaii_wasm.wasm',
  );
  if (!fs.existsSync(wasmPath)) fail('缺少 engine.wasm（先 npm run build:wasm）');

  const { loadEngine } = require('../index.js');
  const native = await loadEngine();
  if (!native || native.path !== 'native') fail('loadEngine 未拿到 native 路径');
  const wasm = await createWasmEngine(wasmPath);

  let checks = 0;
  const eq = (a, b, ctx) => {
    checks++;
    if (a !== b) fail(`${ctx}\n  native: ${JSON.stringify(a)}\n  wasm:   ${JSON.stringify(b)}`);
  };
  // 对象/数组：结构化深比较（键序不敏感，与 node:assert deepStrictEqual 一致）
  const eqj = (a, b, ctx) => {
    checks++;
    try {
      assert.deepStrictEqual(a, b);
    } catch (e) {
      fail(`${ctx}\n  native: ${JSON.stringify(a)}\n  wasm:   ${JSON.stringify(b)}\n  ${e.message}`);
    }
  };

  const messages = [
    'are you ok?',
    'x is not defined',
    "Cannot find module 'foo'",
    'connect ECONNREFUSED 127.0.0.1:6379',
    '普通错误信息',
    '普通错误信息 ~',
    'TS2345: Argument of type {0} is not assignable',
    'Expected {0} spaces but found {1}',
    '找不到模块“bar”。请检查拼写。',
    'Unexpected console statement (no-console)',
    'Expected %d bytes but got %s',
    '  ',
    '',
    '是吗',
    '??!!……连续终止符',
  ];
  const mdSamples = [
    'MD013: Line too long [121 > 80]',
    'MD041/first-line-h1: First line in file should be a top level heading',
    'Line too long',
    'MD013: Line too long ~',
  ];
  const pylintSamples = [
    'Missing module docstring',
    'C0114: Missing module docstring',
    'Missing module docstring ~',
    '   ',
  ];
  const whimperSamples = ['呜呜我太菜了', '我太菜了', '正常说话', ''];

  const optsVariants = [
    undefined,
    { personaStyle: 'tsundere' },
    { personaStyle: 'derriere', intensity: 'subtle' },
    { personaStyle: 'cool' },
    { customFallback: '（乖）' },
    { decorateFallback: false },
    { intensity: 'bold' },
  ];

  for (const msg of messages) {
    for (const opts of optsVariants) {
      const ctx = `transformMessage(${JSON.stringify(msg)}, ${JSON.stringify(opts ?? null)})`;
      eq(
        native.transformMessage(msg, opts),
        wasm.transformMessage(msg, opts),
        ctx,
      );
    }
  }
  for (const msg of mdSamples) {
    for (const opts of optsVariants) {
      eq(
        native.transformMarkdownlint(msg, opts),
        wasm.transformMarkdownlint(msg, opts),
        `transformMarkdownlint(${JSON.stringify(msg)})`,
      );
    }
  }
  for (const msg of pylintSamples) {
    for (const opts of optsVariants) {
      eq(
        native.transformPylint(msg, opts),
        wasm.transformPylint(msg, opts),
        `transformPylint(${JSON.stringify(msg)})`,
      );
    }
  }
  for (const input of whimperSamples) {
    eq(
      native.transformWhimper(input),
      wasm.transformWhimper(input),
      `transformWhimper(${JSON.stringify(input)})`,
    );
  }

  // ── 状态序列（双方执行同样操作，状态必须同步）──
  eq(native.loadRules('builtin'), wasm.loadRules('builtin'), 'loadRules(builtin)');
  const custom = 'rule "t" { rewrite { prepend_text("嗨"); } }';
  const vN = native.loadRulesText(custom);
  const vW = wasm.loadRulesText(custom);
  eq(vN, vW, 'loadRulesText 版本');
  if (!vN.startsWith('dsl:')) fail(`自定义版本异常: ${vN}`);
  eq(
    native.transformMessage('你好'),
    wasm.transformMessage('你好'),
    '自定义规则生效',
  );

  // 坏规则：错误文本一致
  const errOf = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return String(e && e.message ? e.message : e);
    }
  };
  eq(
    errOf(() => native.loadRulesText('rule {')),
    errOf(() => wasm.loadRulesText('rule {')),
    '坏规则错误文本',
  );
  // 坏 opts：napi 层（rustc 类型转换）与 wasm 层（jsonlite）错误文本不同属预期，
  // 仅断言双方都抛错。
  checks++;
  if (errOf(() => native.transformMessage('x', { decorateFallback: 'no' })) === null)
    fail('native 坏 opts 未抛错');
  if (errOf(() => wasm.transformMessage('x', { decorateFallback: 'no' })) === null)
    fail('wasm 坏 opts 未抛错');

  eq(native.loadRules('builtin'), wasm.loadRules('builtin'), '回内置');

  // 人设轮转序列
  for (let i = 0; i < 5; i++) {
    eq(native.cyclePersona(), wasm.cyclePersona(), `cyclePersona #${i}`);
  }

  // ── P4 patch 级 API（native ↔ wasm 结构化深比较）──
  const tokenSamples = ['a %sq1 b %t, %%x, %[managed]', '类型“{0}”不能赋给类型“{1}”', '没有占位符', ''];
  for (const s of tokenSamples) {
    eqj(native.tokenize(s), wasm.tokenize(s), `tokenize(${JSON.stringify(s)})`);
  }

  const valueSamples = ['Hello world', '%s done', 'already ~', '   ', '超链接颜色不对', '{0} 无效'];
  for (const v of valueSamples) {
    for (const opts of optsVariants) {
      eqj(
        native.transformValue(v, 0, opts),
        wasm.transformValue(v, 0, opts),
        `transformValue(${JSON.stringify(v)}, ${JSON.stringify(opts ?? null)})`,
      );
    }
  }

  const patchInputs = [
    ['[', '  "Hello world",', '  "%s done",', '  null', ']'].join('\n'),
    ['{', '  "greeting": "hello",', '  "plug": "超链接颜色不对"', '}'].join('\r\n'),
    'not json at all',
    '',
  ];
  let lastStats = null;
  for (const input of patchInputs) {
    for (const opts of optsVariants) {
      const n = native.patchContent(input, opts);
      const w = wasm.patchContent(input, opts);
      eqj(n, w, `patchContent(${JSON.stringify(input)}, ${JSON.stringify(opts ?? null)})`);
      lastStats = n;
    }
  }
  eq(native.formatStats(lastStats.stats), wasm.formatStats(lastStats.stats), 'formatStats');
  eq(native.formatStats({ total: 3, nulls: 1, hits: 2, decorated: 4, identity: 5, kept: 6, already: 7, changed: 8 }), wasm.formatStats({ total: 3, nulls: 1, hits: 2, decorated: 4, identity: 5, kept: 6, already: 7, changed: 8 }), 'formatStats(样例)');

  const tsDiagRules = { 'Hello msg': ['你好呀~', '哈喽喵~'], key2: ['x~'] };
  const jsonRules = { greeting: ['你好呀~'], plug: ['超链接颜色不对啦~'] };
  const mdRules = { MD013: ['行太长了啦~'], 'Line too long': ['行太长了喵~'] };
  const pyRules = { C0114: ['缺少模块文档啦~'], 'missing-module-docstring': ['文档不见咯~'] };
  const patchOpts = [
    undefined,
    { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' },
    { personaStyle: 'tsundere', intensity: 'subtle' },
  ];

  const tsDiagInput = ['foo: diag(123, cat, "Hello msg", "Hello world");', 'bar: diag(1, c, "key2", "plain text");', 'baz: noMatch(1);'].join('\n');
  const jsonInput = ['{', '  "greeting": "hello",', '  "other": "x"', '}'].join('\n');
  const packInput = JSON.stringify({ contents: { bundle: { greeting: 'hello', other: 'yy' } }, top: 'no' });
  const tplInput = 'const s = `hi ${name} there`; const t = `${a}b`;';
  for (const opts of patchOpts) {
    eqj(native.patchTsDiag(tsDiagInput, tsDiagRules, opts), wasm.patchTsDiag(tsDiagInput, tsDiagRules, opts), `patchTsDiag(... ${JSON.stringify(opts ?? null)})`);
    eqj(native.patchJsonObject(jsonInput, jsonRules, opts), wasm.patchJsonObject(jsonInput, jsonRules, opts), `patchJsonObject(... ${JSON.stringify(opts ?? null)})`);
    eqj(native.patchPackBundle(packInput, jsonRules, opts), wasm.patchPackBundle(packInput, jsonRules, opts), `patchPackBundle(... ${JSON.stringify(opts ?? null)})`);
    eqj(native.patchPackBundle('{ not json', jsonRules, opts), wasm.patchPackBundle('{ not json', jsonRules, opts), 'patchPackBundle(坏 JSON 回落)');
    eqj(native.patchBundleTemplate(tplInput, null, opts), wasm.patchBundleTemplate(tplInput, null, opts), `patchBundleTemplate(... ${JSON.stringify(opts ?? null)})`);
    eq(native.transformMarkdownlintWithRules('MD013/line-length: Line too long [999 > 80]', mdRules, opts), wasm.transformMarkdownlintWithRules('MD013/line-length: Line too long [999 > 80]', mdRules, opts), 'transformMarkdownlintWithRules 带前缀');
    eq(native.transformMarkdownlintWithRules('Line too long', mdRules, opts, 'MD013'), wasm.transformMarkdownlintWithRules('Line too long', mdRules, opts, 'MD013'), 'transformMarkdownlintWithRules code 命中');
    eq(native.transformPylintWithRules('C0114: Missing module docstring', pyRules, opts), wasm.transformPylintWithRules('C0114: Missing module docstring', pyRules, opts), 'transformPylintWithRules 带前缀');
    eq(native.transformPylintWithRules('Missing module docstring', pyRules, opts, 'missing-module-docstring'), wasm.transformPylintWithRules('Missing module docstring', pyRules, opts, 'missing-module-docstring'), 'transformPylintWithRules code 命中');
  }
  // rules 传 {} / 未命中
  eqj(native.patchTsDiag('foo: diag(1, c, "k", "Hello world");', {}, undefined), wasm.patchTsDiag('foo: diag(1, c, "k", "Hello world");', {}, undefined), 'patchTsDiag 空表兜底');
  eq(native.transformMarkdownlintWithRules('MD999: Unknown rule', {}, undefined), wasm.transformMarkdownlintWithRules('MD999: Unknown rule', {}, undefined), 'md 空表兜底');

  // 统计（path 各自不同，其余必须一致）
  const sN = native.getStats();
  const sW = wasm.getStats();
  if (sN.path !== 'native') fail(`native stats.path=${sN.path}`);
  if (sW.path !== 'wasm') fail(`wasm stats.path=${sW.path}`);
  eq(sN.rulesVersion, sW.rulesVersion, 'stats.rulesVersion');
  eq(sN.persona, sW.persona, 'stats.persona');
  eq(sN.ruleCount, sW.ruleCount, 'stats.ruleCount');

  console.log(`parity OK: ${checks} 项一致（native ↔ wasm）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

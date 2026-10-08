// P3 验收：native 与 wasm 两路输出必须逐字节一致（含状态序列与错误文本）。
'use strict';

const fs = require('fs');
const path = require('path');

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

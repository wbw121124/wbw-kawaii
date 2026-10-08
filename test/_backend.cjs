'use strict';
// 三跑后端选择器：KBWW_ENGINE=ts（默认）| native | wasm。
// 只换函数实现，数据（RULES / RULES_VERSION / IDENTITY_VALUES / FALLBACK_SUFFIX）
// 恒从 TS（out/transform.js、out/rules.generated.js），保证三模式同一语料。
//
// 导出面与测试用到的两个模块对齐：
//   - transform.js：RULES, RULES_VERSION, IDENTITY_VALUES, FALLBACK_SUFFIX,
//                   tokenize, transformValue, patchContent, formatStats
//   - transform-new.js：patchTsDiag, patchJsonObject, patchPackBundle,
//                       patchBundleTemplate, transformMarkdownlint, transformPylint

const fs = require('node:fs');
const path = require('node:path');

const mode = process.env.KBWW_ENGINE || 'ts';
if (!['ts', 'native', 'wasm'].includes(mode)) {
  throw new Error(`未知 KBWW_ENGINE=${mode}（可选 ts | native | wasm）`);
}

const ts = require('../out/transform.js');
const tsNew = require('../out/transform-new.js');

const opts = { personaStyle: 'soft', intensity: 'normal' };
const rules = { 'k': ['v~'] };
let impl = null;

if (mode === 'native') {
  const nodeFile = (() => {
    const dir = path.join(__dirname, '..', 'engine');
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.node'));
    return f ? path.join(dir, f) : null;
  })();
  if (!nodeFile) {
    throw new Error('KBWW_ENGINE=native 但 engine/ 下没有 .node（先 npm run build:debug --prefix engine）');
  }
  const native = require(nodeFile);
  impl = {
    tokenize: (s) => native.tokenize(s),
    transformValue: (v, i, o) => native.transformValue(v, i, o),
    patchContent: (c, o) => native.patchContent(c, o),
    formatStats: (s) => native.formatStats(s),
    patchTsDiag: (c, r, o) => native.patchTsDiag(c, r, o),
    patchJsonObject: (c, r, o) => native.patchJsonObject(c, r, o),
    patchPackBundle: (c, r, o) => native.patchPackBundle(c, r, o),
    patchBundleTemplate: (c, r, o) => native.patchBundleTemplate(c, r, o),
    transformMarkdownlint: (m, r, o, cd) => native.transformMarkdownlintWithRules(m, r, o, cd),
    transformPylint: (m, r, o, cd) => native.transformPylintWithRules(m, r, o, cd),
  };
} else if (mode === 'wasm') {
  const wasmPath = (() => {
    const dir = path.join(__dirname, '..', 'engine');
    const candidates = [
      path.join(dir, 'kawaii_wasm.wasm'),
      path.join(dir, 'target', 'wasm32-unknown-unknown', 'release', 'kawaii_wasm.wasm'),
    ];
    return candidates.find((p) => fs.existsSync(p)) ?? null;
  })();
  if (!wasmPath) {
    throw new Error('KBWW_ENGINE=wasm 但找不到 kawaii_wasm.wasm（先 cargo build --release --target wasm32-unknown-unknown -p kawaii-wasm）');
  }
  // Node ≥22 require(esm) 同步取同步入口（glue.mjs 无顶层 await）
  const { engineFromInstance } = require('../engine/glue.mjs');
  const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasmPath)), {});
  const wasm = engineFromInstance(instance);
  impl = {
    tokenize: (s) => wasm.tokenize(s),
    transformValue: (v, i, o) => wasm.transformValue(v, i, o),
    patchContent: (c, o) => wasm.patchContent(c, o),
    formatStats: (s) => wasm.formatStats(s),
    patchTsDiag: (c, r, o) => wasm.patchTsDiag(c, r, o),
    patchJsonObject: (c, r, o) => wasm.patchJsonObject(c, r, o),
    patchPackBundle: (c, r, o) => wasm.patchPackBundle(c, r, o),
    patchBundleTemplate: (c, r, o) => wasm.patchBundleTemplate(c, r, o),
    transformMarkdownlint: (m, r, o, cd) => wasm.transformMarkdownlintWithRules(m, r, o, cd),
    transformPylint: (m, r, o, cd) => wasm.transformPylintWithRules(m, r, o, cd),
  };
} else {
  impl = {
    tokenize: ts.tokenize,
    transformValue: ts.transformValue,
    patchContent: ts.patchContent,
    formatStats: ts.formatStats,
    patchTsDiag: tsNew.patchTsDiag,
    patchJsonObject: tsNew.patchJsonObject,
    patchPackBundle: tsNew.patchPackBundle,
    patchBundleTemplate: tsNew.patchBundleTemplate,
    transformMarkdownlint: tsNew.transformMarkdownlint,
    transformPylint: tsNew.transformPylint,
  };
}

// 自检：证明所选后端真的在被用（防模式静默失效）
if (mode !== 'ts') {
  const probe = impl.patchContent('{\n  "x": 1\n}', opts);
  if (typeof probe?.content !== 'string') {
    throw new Error(`${mode} 后端自检失败：patchContent 未返回结构`);
  }
}

module.exports = {
  __engineMode: mode,
  // 数据（恒 TS）
  RULES: ts.RULES,
  RULES_VERSION: ts.RULES_VERSION,
  IDENTITY_VALUES: ts.IDENTITY_VALUES,
  FALLBACK_SUFFIX: ts.FALLBACK_SUFFIX,
  // 函数（按模式切换）
  ...impl,
};

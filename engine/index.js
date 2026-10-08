// 本地/单平台 loader：三级回退的第一、二级（native → wasm → null=交给 TS 兜底）。
// P4 接入 optionalDependencies 平台包时改用 napi --platform 生成的版本。
'use strict';

const fs = require('fs');
const path = require('path');

/** 加载 .node（无则 null）。 */
function loadNativeModule() {
  try {
    const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.node'));
    if (files.length === 0) return null;
    return require(path.join(__dirname, files[0]));
  } catch {
    return null;
  }
}

/** 原生模块 → 统一引擎对象（path: 'native'）。 */
function wrapNative(mod) {
  return {
    path: 'native',
    transformMessage: (msg, opts) => mod.transformMessage(msg, opts),
    transformMarkdownlint: (msg, opts, code) => mod.transformMarkdownlint(msg, opts, code),
    transformPylint: (msg, opts, code) => mod.transformPylint(msg, opts, code),
    transformWhimper: (input, opts) => mod.transformWhimper(input, opts),
    loadRules: (source) => mod.loadRules(source),
    loadRulesText: (text) => mod.loadRulesText(text),
    cyclePersona: () => mod.cyclePersona(),
    getStats: () => mod.getStats(),
    engineInfo: () => mod.engineInfo(),
    // ── P4 patch 级 API ──
    tokenize: (s) => mod.tokenize(s),
    transformValue: (value, index, opts) => mod.transformValue(value, index, opts),
    patchContent: (content, opts) => mod.patchContent(content, opts),
    formatStats: (stats) => mod.formatStats(stats),
    patchTsDiag: (content, rules, opts) => mod.patchTsDiag(content, rules, opts),
    patchJsonObject: (content, rules, opts) => mod.patchJsonObject(content, rules, opts),
    patchPackBundle: (content, rules, opts) => mod.patchPackBundle(content, rules, opts),
    patchBundleTemplate: (content, rules, opts) => mod.patchBundleTemplate(content, rules, opts),
    transformMarkdownlintWithRules: (msg, rules, opts, code) =>
      mod.transformMarkdownlintWithRules(msg, rules, opts, code),
    transformPylintWithRules: (msg, rules, opts, code) =>
      mod.transformPylintWithRules(msg, rules, opts, code),
  };
}

/** 定位 engine.wasm（打包位置优先，其次本地构建产物）。 */
function findWasmPath() {
  const candidates = [
    path.join(__dirname, 'kawaii_wasm.wasm'),
    path.join(__dirname, 'target', 'wasm32-unknown-unknown', 'release', 'kawaii_wasm.wasm'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** 加载 wasm 引擎（Node 侧补 file: 支持）。 */
async function loadWasmEngine() {
  const wasmPath = findWasmPath();
  if (!wasmPath) return null;
  const { createWasmEngine } = require('./glue.mjs');
  const engine = await createWasmEngine(wasmPath);
  const rawLoadRules = engine.loadRules.bind(engine);
  engine.loadRules = (source) => {
    if (typeof source === 'string' && source.startsWith('file:')) {
      const text = fs.readFileSync(source.slice(5), 'utf8');
      return engine.loadRulesText(text);
    }
    return rawLoadRules(source);
  };
  return engine;
}

/** 三级回退：native → engine.wasm → null（调用方走 TS 实现）。 */
async function loadEngine() {
  const native = loadNativeModule();
  if (native) return wrapNative(native);
  try {
    return await loadWasmEngine();
  } catch {
    return null;
  }
}

const nativeMod = loadNativeModule();
const api = { loadEngine, loadNativeModule, loadWasmEngine, findWasmPath };
if (nativeMod) {
  // P0 兼容：native 存在时顶层直通原生函数（require('@wbw/kawaii-engine').transformMessage）
  for (const [k, v] of Object.entries(nativeMod)) {
    if (typeof v === 'function') api[k] = v;
  }
}

module.exports = api;

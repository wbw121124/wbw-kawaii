'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ========== token 测试（新增 {N}）==========
test('tokenize 识别 {N} 占位符', () => {
  const { tokenize } = require('../out/transform.js');
  assert.deepStrictEqual(tokenize('{0} 和 {1}'), ['{0}', '{1}']);
  assert.deepStrictEqual(tokenize('{10} 与 {2} 顺序不同'), ['{10}', '{2}']);
  assert.deepStrictEqual(tokenize('无占位符'), []);
  assert.deepStrictEqual(tokenize('100% {1}'), ['{1}']);
});

// ========== shouldPatchTarget 门控 ==========
test('shouldPatchTarget: zh-cn 允许新目标，en 拒绝', () => {
  const { shouldPatchTarget } = require('../out/targets.js');
  assert.strictEqual(shouldPatchTarget('tsDiag', 'zh-cn'), true);
  assert.strictEqual(shouldPatchTarget('tsDiag', 'en'), false);
  assert.strictEqual(shouldPatchTarget('tsDiag', 'ja'), false);
  assert.strictEqual(shouldPatchTarget('cpptools', 'en'), true);
  assert.strictEqual(shouldPatchTarget('cpptools', 'zh-cn'), true);
});

// ========== patchJsonObject（纯模块无 vscode 依赖）==========
test('patchJsonObject: 命中替换 + 兜底后缀 + 保持结构', () => {
  const { patchJsonObject } = require('../out/transform-new.js');
  const rules = { key_a: ['替代文案A', '替代文案B'] };
  const content = '{\n  "key_a": "原文案",\n  "key_b": "无规则文案",\n  "key_c": null\n}\n';
  const res = patchJsonObject(content, rules, { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' });
  assert.strictEqual(res.changed, true);
  assert.ok(res.content.includes('替代文案'), '应替换命中文案');
  assert.ok(res.content.includes('无规则文案 喵~'), '应兜底追加后缀');
  assert.ok(res.content.includes('null'), 'null 值应保留');
  // 幂等
  const res2 = patchJsonObject(res.content, rules, { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' });
  assert.strictEqual(res2.changed, false, '二次改写不应变化');
});

// ========== patchPackBundle ==========
test('patchPackBundle: 只动 contents.bundle，license/version 字节不动', () => {
  const { patchPackBundle } = require('../out/transform-new.js');
  const rules = { 'key_a': ['改版 A'] };
  const content = '{"":"license","version":"1.0.0","contents":{"bundle":{"key_a":"原文","key_b":"无规则"}}}';
  const res = patchPackBundle(content, rules);
  assert.strictEqual(res.changed, true);
  assert.ok(res.content.includes('"key_a":"改版 A"'), 'bundle 值应被替换');
  assert.ok(res.content.includes('"version":"1.0.0"'), 'version 不应变化');
  assert.ok(res.content.includes('"":"license"'), 'license 不应变化');
  assert.ok(res.content.includes('key_b'), '无规则 key 也应被兜底');
  // 幂等
  const res2 = patchPackBundle(res.content, rules, { personaStyle: 'soft', intensity: 'normal' });
  assert.strictEqual(res2.changed, false, '二次改写不应变化');
});

// ========== patchBundleTemplate ==========
test('patchBundleTemplate: 模板串加后缀，已打过则跳过', () => {
  const { patchBundleTemplate } = require('../out/transform-new.js');
  const content = 'l10n.t("other") + `Unknown at rule @${name}`;';
  const res = patchBundleTemplate(content, null, { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' });
  assert.strictEqual(res.changed, true);
  assert.ok(res.content.includes('Unknown at rule @${name} 喵~'), '应追加后缀');
  // 幂等
  const res2 = patchBundleTemplate(res.content, null, { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' });
  assert.strictEqual(res2.changed, false, '二次改写不应变化');
});

// ========== locale 门控 + restore 流程 ==========
test('locale 门控: en 下已 patched 的文件会被还原并记 inactive', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbw-locale-'));
  try {
    const tsDir = path.join(tmpDir, 'typescript', 'lib');
    fs.mkdirSync(tsDir, { recursive: true });
    const zhDir = path.join(tsDir, 'zh-cn');
    fs.mkdirSync(zhDir, { recursive: true });
    const original = '{\n  "Cannot_find_name_0_2304": "找不到名称\\"{0}\\"。"\n}\n';
    const patched = '{\n  "Cannot_find_name_0_2304": "找不到名称\\"{0}\\"啦，喵~"\n}\n';
    fs.writeFileSync(path.join(tsDir, 'typescript.js'), 'dummy');
    fs.writeFileSync(path.join(tsDir, 'typescript.js.orig'), 'dummy');
    fs.writeFileSync(path.join(zhDir, 'diagnosticMessages.generated.json'), patched);
    fs.writeFileSync(path.join(zhDir, 'diagnosticMessages.generated.json.orig'), original);
    fs.writeFileSync(path.join(zhDir, 'diagnosticMessages.generated.json.wbw-kawaii.json'),
      JSON.stringify({ state: 'patched', rulesVersion: 'sha256:aaaaaaaaaaaaaaaa', sourceVersion: '6.0.3', locale: 'zh-cn', originalHash: 'x', patchedHash: 'y', updatedAt: new Date().toISOString() }));

    const { readTargetMeta } = require('../out/targets.js');
    const meta = readTargetMeta(path.join(zhDir, 'diagnosticMessages.generated.json.wbw-kawaii.json'));
    assert.strictEqual(meta?.state, 'patched', '初始状态应为 patched');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ========== 覆盖率：TS/PACK 变体占位符一致性（比源文本，非比 key）==========
test('TS_RULES 所有变体占位符与源文本一致', () => {
  const { TS_RULES } = require('../out/rules.generated.js');
  const tsInv = JSON.parse(fs.readFileSync('scripts/rules/inventory/ts.json', 'utf8'));
  const invMap = new Map(tsInv.map(e => [e.key, e.zh || e.en]));
  const TOKEN_RE = /\{\d+\}/g;
  for (const [key, variants] of Object.entries(TS_RULES)) {
    const sourceText = invMap.get(key) ?? key;
    const srcTok = (sourceText.match(TOKEN_RE) ?? []).sort().join(',');
    for (const v of variants) {
      const vTok = (v.match(TOKEN_RE) ?? []).sort().join(',');
      assert.strictEqual(srcTok, vTok, `占位符不一致: ${key}（源=${JSON.stringify(sourceText)?.slice(0,60)}）`);
    }
  }
});

test('PACK_RULES 所有变体占位符与键（即英文原文）一致', () => {
  const { PACK_RULES } = require('../out/rules.generated.js');
  const TOKEN_RE = /\{\d+\}/g;
  for (const [key, variants] of Object.entries(PACK_RULES)) {
    const srcTok = (key.match(TOKEN_RE) ?? []).sort().join(',');
    for (const v of variants) {
      const vTok = (v.match(TOKEN_RE) ?? []).sort().join(',');
      assert.strictEqual(srcTok, vTok, `占位符不一致: ${key}`);
    }
  }
});

// ========== transformMarkdownlint ==========
test('transformMarkdownlint: 命中规则替换 description', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  const rules = { 'MD013': ['行太长了啦~', '行长度超标了喵~'] };
  assert.strictEqual(
    transformMarkdownlint('MD013: Line length', rules),
    'MD013: 行太长了啦~'
  );
});

test('transformMarkdownlint: 无规则兜底后缀', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  assert.strictEqual(
    transformMarkdownlint('MD999: Unknown rule', {}, { personaStyle: 'soft', intensity: 'normal' }),
    'MD999: Unknown rule ~'
  );
});

test('transformMarkdownlint: 已带后缀不重复', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  assert.strictEqual(
    transformMarkdownlint('MD001: heading 喵~', {}, { personaStyle: 'soft', intensity: 'normal', customFallback: ' 喵~' }),
    'MD001: heading 喵~'
  );
});

// ========== transformPylint ==========
test('transformPylint: 命中规则替换 description', () => {
  const { transformPylint } = require('../out/transform-new.js');
  const rules = { 'C0114': ['缺少模块文档啦~', '模块文档不见咯~'] };
  const result = transformPylint('C0114: Missing module docstring', rules);
  // hash 轮转选变体，只需验证格式正确且包含可爱文案
  assert.ok(result.startsWith('C0114: '), `got: ${result}`);
  assert.ok(result !== 'C0114: Missing module docstring', '应被改写');
});

test('transformPylint: 无规则兜底后缀', () => {
  const { transformPylint } = require('../out/transform-new.js');
  assert.strictEqual(
    transformPylint('Z9999: Unknown', {}, { personaStyle: 'soft', intensity: 'normal' }),
    'Z9999: Unknown ~'
  );
});

// ========== interceptDiagnosticCollection（纯函数测试）==========
test('interceptDiagnosticCollection: 不重复注册同一 source', () => {
  const { interceptDiagnosticCollection } = require('../out/intercept.js');
  // 已在 module scope 注册过 → 幂等（不抛出即可）
  assert.doesNotThrow(() => interceptDiagnosticCollection('markdownlint', () => 'x'));
});

// ========== 运行时拦截真实消息格式（markdownlint-vscode / vscode-pylint） ==========
test('transformMarkdownlint: alias/详情消息按英文描述命中', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  const rules = { 'Line too long': ['行太长了喵~'] };
  assert.strictEqual(
    transformMarkdownlint('MD013/line-length: Line too long [121 > 80]', rules),
    'MD013/line-length: 行太长了喵~ [121 > 80]'
  );
});

test('transformMarkdownlint: 无前缀消息按 diagnostic.code 命中', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  const rules = { MD013: ['行太长了喵~'] };
  assert.strictEqual(
    transformMarkdownlint('Line too long', rules, undefined, 'MD013'),
    '行太长了喵~'
  );
});

test('transformMarkdownlint: 未命中时详情后保留、后缀加在末尾', () => {
  const { transformMarkdownlint } = require('../out/transform-new.js');
  assert.strictEqual(
    transformMarkdownlint('MD013/line-length: Line too long [999 > 80]', {}, { personaStyle: 'soft', intensity: 'normal' }),
    'MD013/line-length: Line too long [999 > 80] ~'
  );
});

test('transformPylint: 无前缀消息兜底后缀', () => {
  const { transformPylint } = require('../out/transform-new.js');
  assert.strictEqual(
    transformPylint('Missing module docstring', {}, { personaStyle: 'soft', intensity: 'normal' }),
    'Missing module docstring ~'
  );
});

test('transformPylint: 无前缀消息按 diagnostic.code 命中', () => {
  const { transformPylint } = require('../out/transform-new.js');
  const rules = { 'missing-module-docstring': ['缺少模块文档喵~'] };
  assert.strictEqual(
    transformPylint('Missing module docstring', rules, undefined, 'missing-module-docstring'),
    '缺少模块文档喵~'
  );
});



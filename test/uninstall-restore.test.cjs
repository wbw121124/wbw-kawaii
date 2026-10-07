'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'out', 'uninstall-restore.js');

// 模拟 VS Code 的扩展根目录：本扩展与 cpptools 是同级目录。
// cwd 故意指向无关目录 —— 脚本必须靠 __dirname 定位，不能依赖 cwd。
function makeWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wbw-uninstall-'));
  const extDir = path.join(root, 'wbw121124.wbw-kawaii-0.1.1');
  fs.mkdirSync(path.join(extDir, 'out'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(extDir, 'out', 'uninstall-restore.js'));
  return { root, extDir };
}

function run(extDir) {
  return execFileSync(process.execPath, [path.join(extDir, 'out', 'uninstall-restore.js')], {
    cwd: os.tmpdir(),
    encoding: 'utf8'
  });
}

function cpptoolsLocale(root, locale) {
  return path.join(root, 'ms-vscode.cpptools-1.34.4', 'bin', 'messages', locale);
}

test('卸载钩子: 已改写 → 还原 messages.json 并清理备份/meta', () => {
  const { root, extDir } = makeWorld();
  try {
    const dir = cpptoolsLocale(root, 'zh-cn');
    const other = cpptoolsLocale(root, 'ja');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    const original = '[\r\n    "原句",\r\n]\r\n';
    const patched = '[\r\n    "原句 喵~",\r\n]\r\n';
    fs.writeFileSync(path.join(dir, 'messages.json'), patched);
    fs.writeFileSync(path.join(dir, 'messages.json.orig'), original);
    fs.writeFileSync(path.join(dir, 'messages.json.wbw-kawaii.json'), JSON.stringify({ state: 'patched' }));
    // 没有备份的其他语言目录：不应被动过
    const otherContent = '[\r\n    "ja",\r\n]\r\n';
    fs.writeFileSync(path.join(other, 'messages.json'), otherContent);

    const out = run(extDir);

    assert.strictEqual(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), original, '应还原为备份内容');
    assert.ok(!fs.existsSync(path.join(dir, 'messages.json.orig')), '备份应被清理');
    assert.ok(!fs.existsSync(path.join(dir, 'messages.json.wbw-kawaii.json')), 'meta 应被清理');
    assert.strictEqual(fs.readFileSync(path.join(other, 'messages.json'), 'utf8'), otherContent, '无备份的语言目录不动');
    assert.match(out, /已还原/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('卸载钩子: 未改写 → 原文件不动、正常退出', () => {
  const { root, extDir } = makeWorld();
  try {
    const dir = cpptoolsLocale(root, 'zh-cn');
    fs.mkdirSync(dir, { recursive: true });
    const content = '[\r\n    null,\r\n]\r\n';
    fs.writeFileSync(path.join(dir, 'messages.json'), content);

    const out = run(extDir);

    assert.strictEqual(fs.readFileSync(path.join(dir, 'messages.json'), 'utf8'), content, '未改写文件保持原样');
    assert.ok(!out.includes('已还原'), '不应报告还原');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('卸载钩子: 没有 cpptools → 无副作用正常退出', () => {
  const { root, extDir } = makeWorld();
  try {
    const out = run(extDir);
    assert.strictEqual(typeof out, 'string');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

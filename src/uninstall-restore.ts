// package.json → scripts["vscode:uninstall"] 卸载钩子（VS Code 官方机制，1.21+）。
// 纯 Node 脚本：没有 vscode 模块，以独立子进程执行；时机是"卸载后的下一次完全重启"
// （关闭全部 VS Code 进程再启动，重载窗口不算）。
// 职责：
//   1. 读取 targets-manifest.json，按 state=patched 还原所有改写过的文件（含 TS/CSS/HTML/语言包）
//   2. 兜底扫描 cpptools 目录（兼容旧版本未写 manifest 的情况）
//   3. 清理所有 .orig / .wbw-kawaii.json 备份和 meta 文件
// 任何异常只记录不抛出，绝不阻塞卸载。
import * as fs from 'fs';
import * as path from 'path';

const BACKUP_NAME = 'messages.json.orig';
const META_NAME = 'messages.json.wbw-kawaii.json';
const CPPTOOLS_PREFIX = 'ms-vscode.cpptools';

interface ManifestTarget {
  id: string;
  file: string;
  backupFile: string;
  metaFile: string;
  state: 'patched' | 'restored' | 'inactive';
  sourceVersion: string;
}

interface Manifest {
  version: 1;
  updatedAt: string;
  locale: string;
  rulesVersion: string;
  targets: ManifestTarget[];
}

function readManifest(extDir: string): Manifest | null {
  const p = path.join(extDir, 'targets-manifest.json');
  try {
    if (!fs.existsSync(p)) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v && v.version === 1 && Array.isArray(v.targets)) return v as Manifest;
    return null;
  } catch { return null; }
}

function restoreOne(logs: string[], file: string, backupFile: string, metaFile: string, id: string): void {
  if (!fs.existsSync(backupFile)) {
    logs.push(`[${id}] 缺少备份 ${backupFile}，跳过还原`);
    return;
  }
  try {
    const backup = fs.readFileSync(backupFile);
    fs.writeFileSync(file, backup);
    logs.push(`已还原 ${id} → ${path.relative(path.dirname(file), file)}`);
  } catch (e) {
    logs.push(`[${id}] 还原失败: ${String(e)}`);
  }
  try { fs.unlinkSync(backupFile); } catch { /* 清理失败不阻塞 */ }
  try { fs.unlinkSync(metaFile); } catch { /* 清理失败不阻塞 */ }
}

function restoreFromManifest(extDir: string): string[] {
  const logs: string[] = [];
  const manifest = readManifest(extDir);
  if (!manifest) return logs;
  for (const t of manifest.targets) {
    if (t.state !== 'patched') continue;
    if (!fs.existsSync(t.file)) {
      logs.push(`[${t.id}] 文件已不存在，跳过`);
      continue;
    }
    restoreOne(logs, t.file, t.backupFile, t.metaFile, t.id);
  }
  // 清理 manifest 本身
  try { fs.unlinkSync(path.join(extDir, 'targets-manifest.json')); } catch { /* 清理失败不阻塞 */ }
  logs.push(`[manifest] 已处理 ${manifest.targets.length} 条目标（rulesVersion=${manifest.rulesVersion}）`);
  return logs;
}

function restoreCpptoolsFallback(extensionsRoot: string): string[] {
  const logs: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsRoot);
  } catch (e) {
    logs.push(`无法读取扩展目录 ${extensionsRoot}: ${String(e)}`);
    return logs;
  }
  for (const name of entries) {
    if (name.startsWith(CPPTOOLS_PREFIX) === false) continue;
    const messagesRoot = path.join(extensionsRoot, name, 'bin', 'messages');
    let locales: string[];
    try {
      locales = fs.readdirSync(messagesRoot);
    } catch {
      continue;
    }
    for (const locale of locales) {
      const dir = path.join(messagesRoot, locale);
      const file = path.join(dir, 'messages.json');
      const backup = path.join(dir, BACKUP_NAME);
      const meta = path.join(dir, META_NAME);
      let restored = false;
      if (fs.existsSync(backup)) {
        try {
          fs.copyFileSync(backup, file);
          restored = true;
          logs.push(`已还原 ${name} bin/messages/${locale}/messages.json`);
        } catch (e) {
          logs.push(`还原失败 ${name} ${locale}: ${String(e)}`);
        }
        try { fs.unlinkSync(backup); } catch { /* 清理失败不阻塞 */ }
      }
      if (fs.existsSync(meta)) {
        try { fs.unlinkSync(meta); } catch { /* 清理失败不阻塞 */ }
        if (!restored) {
          logs.push(`已清理 ${name} ${locale} 的 meta（没有备份：未改写过，或备份已被删除）`);
        }
      }
    }
  }
  return logs;
}

function main(): void {
  const extDir = path.resolve(__dirname, '..');
  const extensionsRoot = path.dirname(extDir);
  let logs: string[] = [];
  try {
    // 优先从 manifest 还原（0.2.0+ 写法）
    logs = restoreFromManifest(extDir);
    // 兜底：扫描 cpptools（旧版本可能没有 manifest）
    const cpLogs = restoreCpptoolsFallback(extensionsRoot);
    if (cpLogs.length > 0) logs = logs.concat(cpLogs);
  } catch (e) {
    logs = [`意外错误: ${String(e)}`];
  }
  if (logs.length === 0) logs.push('无需处理（没有发现可还原的文件）');
  for (const line of logs) {
    console.log(`[wbw-kawaii uninstall] ${line}`);
  }
}

main();

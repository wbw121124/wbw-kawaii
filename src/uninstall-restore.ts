// package.json → scripts["vscode:uninstall"] 卸载钩子（VS Code 官方机制，1.21+）。
// 纯 Node 脚本：没有 vscode 模块，以独立子进程执行；时机是“卸载后的下一次完全重启”
// （关闭全部 VS Code 进程再启动，重载窗口不算）。
// 职责：把 cpptools 的 messages.json 从备份还原，并清理本扩展留在 cpptools 目录的
// 备份/meta 文件。任何异常只记录不抛出，绝不阻塞卸载。
import * as fs from 'fs';
import * as path from 'path';

const BACKUP_NAME = 'messages.json.orig';
const META_NAME = 'messages.json.wbw-kawaii.json';
const CPPTOOLS_PREFIX = 'ms-vscode.cpptools';

function restoreAll(): string[] {
  const logs: string[] = [];
  // 本脚本位于 <扩展目录>/out/uninstall-restore.js，全部路径由自身位置推出，
  // 不依赖 cwd（VS Code 启动子进程时的 cwd 不作保证）。
  const extDir = path.resolve(__dirname, '..');
  const extensionsRoot = path.dirname(extDir);

  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsRoot);
  } catch (e) {
    logs.push(`无法读取扩展目录 ${extensionsRoot}: ${String(e)}`);
    return logs;
  }

  for (const name of entries) {
    if (name === path.basename(extDir) || !name.startsWith(CPPTOOLS_PREFIX)) continue;
    const messagesRoot = path.join(extensionsRoot, name, 'bin', 'messages');
    let locales: string[];
    try {
      locales = fs.readdirSync(messagesRoot);
    } catch {
      continue; // 该 cpptools 没有本地化目录（英文界面等）
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
        try {
          fs.unlinkSync(backup);
        } catch {
          // 清理失败不阻塞
        }
      }
      if (fs.existsSync(meta)) {
        try {
          fs.unlinkSync(meta);
        } catch {
          // 清理失败不阻塞
        }
        if (!restored) {
          logs.push(`已清理 ${name} ${locale} 的 meta（没有备份：未改写过，或备份已被删除）`);
        }
      }
    }
  }
  return logs;
}

function main(): void {
  let logs: string[];
  try {
    logs = restoreAll();
  } catch (e) {
    logs = [`意外错误: ${String(e)}`];
  }
  if (logs.length === 0) logs.push('无需处理（没有发现可还原的 cpptools 备份）');
  for (const line of logs) {
    console.log(`[wbw-kawaii uninstall] ${line}`);
  }
}

main();

import * as vscode from 'vscode';
import { KawaiiPatcher } from './patcher';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('wbw kawaii');
  const patcher = new KawaiiPatcher(channel, context.globalState);
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand('wbw-kawaii.patch', () => patcher.run('manual')),
    vscode.commands.registerCommand('wbw-kawaii.restore', () => patcher.restore()),
    vscode.commands.registerCommand('wbw-kawaii.status', () => patcher.status())
  );

  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      void patcher.run('extensions-changed');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wbw-kawaii.enabled')) {
        const on = vscode.workspace.getConfiguration('wbw-kawaii').get<boolean>('enabled', true);
        if (on) void patcher.run('config-enabled');
      }
    })
  );

  void patcher.run('startup');
}

export function deactivate(): void {
  // 卸载/关闭时不自动还原（避免启动竞态污染），备份与还原命令常驻可用
}

import * as vscode from 'vscode';
import { KawaiiPatcher } from './patcher';
import { KawaiiStatusBar } from './statusbar';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('wbw kawaii');
  const patcher = new KawaiiPatcher(channel, context.globalState);
  const statusBar = new KawaiiStatusBar();
  context.subscriptions.push(channel);
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('wbw-kawaii.patch', () => patcher.run('manual')),
    vscode.commands.registerCommand('wbw-kawaii.restore', () => patcher.restore()),
    vscode.commands.registerCommand('wbw-kawaii.status', () => patcher.status()),
    vscode.commands.registerCommand('wbw-kawaii.cyclePersona', () => patcher.cyclePersona()),
    vscode.commands.registerCommand('wbw-kawaii.whimper', () => patcher.whimper())
  );

  // Bind status bar click to quick pick via command
  statusBar.item.command = 'wbw-kawaii.statusbar.pick';
  context.subscriptions.push(
    vscode.commands.registerCommand('wbw-kawaii.statusbar.pick', () => void statusBar.pick())
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
      if (e.affectsConfiguration('wbw-kawaii.personaStyle')) {
        const style = vscode.workspace.getConfiguration('wbw-kawaii').get<string>('personaStyle', 'soft');
        statusBar.refresh(style as 'soft' | 'tsundere' | 'derriere' | 'cool');
      }
    })
  );

  void patcher.run('startup');
}

export function deactivate(): void {
  // 卸载还原走 package.json 的 vscode:uninstall 钩子
}

// Status bar widget for wbw-kawaii
import * as vscode from 'vscode';
import { getPersona, PersonaStyle } from './persona';

export class KawaiiStatusBar implements vscode.Disposable {
  readonly item: vscode.StatusBarItem;
  private disposed = false;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.tooltip = 'wbw kawaii: click to operate';
    this.refresh('soft');
    this.item.show();
  }

  refresh(personaStyle: PersonaStyle): void {
    const persona = getPersona(personaStyle);
    this.item.text = persona.statusEmoji + ' wbw-kawaii';
  }

  dismiss(): void {
    this.item.hide();
  }

  async pick(): Promise<void> {
    if (this.disposed) return;
    const items = ['Re-patch', 'Restore', 'Status', 'Cycle persona', 'Whimper'];
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'wbw kawaii' });
    if (choice === 'Re-patch') void vscode.commands.executeCommand('wbw-kawaii.patch');
    else if (choice === 'Restore') void vscode.commands.executeCommand('wbw-kawaii.restore');
    else if (choice === 'Status') void vscode.commands.executeCommand('wbw-kawaii.status');
    else if (choice === 'Cycle persona') void vscode.commands.executeCommand('wbw-kawaii.cyclePersona');
    else if (choice === 'Whimper') void vscode.commands.executeCommand('wbw-kawaii.whimper');
  }

  dispose(): void {
    this.disposed = true;
    this.item.dispose();
  }
}

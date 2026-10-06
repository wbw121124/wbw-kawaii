import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { patchContent, formatStats, RULES_VERSION, PatchOptions } from './transform';

const EXT_ID = 'ms-vscode.cpptools';
const BACKUP_NAME = 'messages.json.orig';
const META_NAME = 'messages.json.wbw-kawaii.json';

interface Meta {
  state: 'patched' | 'restored';
  rulesVersion: string;
  cpptoolsVersion: string;
  locale: string;
  originalHash: string;
  patchedHash: string;
  updatedAt: string;
}

export type RunReason = 'startup' | 'extensions-changed' | 'config-enabled' | 'manual';

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readMeta(metaPath: string): Meta | null {
  try {
    if (!fs.existsSync(metaPath)) return null;
    const v = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (v && typeof v === 'object' && typeof v.patchedHash === 'string') return v as Meta;
    return null;
  } catch {
    return null;
  }
}

function writeMeta(metaPath: string, meta: Meta): void {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

export class KawaiiPatcher {
  private busy = false;

  constructor(
    private readonly channel: vscode.OutputChannel,
    private readonly globalState: vscode.Memento
  ) {}

  private log(msg: string): void {
    this.channel.appendLine(`[${new Date().toISOString()}] ${msg}`);
  }

  async run(reason: RunReason): Promise<void> {
    if (this.busy) {
      this.log('已有任务执行中，跳过本次触发');
      return;
    }
    this.busy = true;
    try {
      await this.doRun(reason);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`错误: ${msg}`);
      if (reason === 'manual') {
        void vscode.window.showErrorMessage(`wbw kawaii 失败: ${msg}（详见输出面板 wbw kawaii）`);
      }
    } finally {
      this.busy = false;
    }
  }

  private locate(): { ext: vscode.Extension<unknown>; dir: string; file: string; version: string } | null {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (!ext) return null;
    const locale = (vscode.env.language || '').toLowerCase();
    const dir = path.join(ext.extensionPath, 'bin', 'messages', locale);
    const file = path.join(dir, 'messages.json');
    const version = String((ext.packageJSON as { version?: string }).version ?? 'unknown');
    return { ext, dir, file, version };
  }

  private async doRun(reason: RunReason): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');
    const enabled = cfg.get<boolean>('enabled', true);
    const auto = reason === 'startup' || reason === 'extensions-changed';
    if (auto && !enabled) {
      this.log('wbw-kawaii.enabled=false，跳过');
      return;
    }

    const located = this.locate();
    if (!located) {
      this.log('未检测到 ms-vscode.cpptools 扩展');
      if (reason === 'manual') {
        void vscode.window.showInformationMessage('wbw kawaii: 未安装 C/C++ (ms-vscode.cpptools) 扩展');
      }
      return;
    }

    const { dir, file, version } = located;
    if (!fs.existsSync(file)) {
      const locale = vscode.env.language;
      this.log(`未找到消息文件: ${file}`);
      const key = `wbw-kawaii.warned.${locale}`;
      if (!this.globalState.get<boolean>(key)) {
        await this.globalState.update(key, true);
        const isEn = locale === 'en' || locale === '';
        void vscode.window.showWarningMessage(
          isEn
            ? 'wbw kawaii: 英文界面下 cpptools 没有本地化消息文件，无法改写。请将 VS Code 显示语言切换为中文（zh-cn）后重启。'
            : `wbw kawaii: 当前语言 ${locale} 下没有 cpptools 消息文件（bin/messages/${locale}/messages.json）。`
        );
      }
      return;
    }

    const content = fs.readFileSync(file, 'utf8');
    const hash = sha256(content);
    const metaPath = path.join(dir, META_NAME);
    const backupPath = path.join(dir, BACKUP_NAME);
    const meta = readMeta(metaPath);

    if (meta && meta.state === 'restored' && auto) {
      this.log('检测到用户已手动还原（state=restored），自动改写暂停；可用命令“Kawaii: 重新改写”恢复');
      return;
    }
    if (meta && meta.rulesVersion === RULES_VERSION && meta.patchedHash === hash && meta.cpptoolsVersion === version) {
      this.log(`已是改写状态（cpptools ${version}, ${RULES_VERSION}），跳过`);
      return;
    }

    const opts: PatchOptions = {
      decorateFallback: cfg.get<boolean>('fallbackDecorate', true)
    };
    const res = patchContent(content, opts);

    if (!res.changed) {
      // 两种情形：文件已是改写产物（meta 丢失/规则版本变化）或规则零命中
      writeMeta(metaPath, {
        state: 'patched',
        rulesVersion: RULES_VERSION,
        cpptoolsVersion: version,
        locale: vscode.env.language,
        originalHash: meta ? meta.originalHash : hash,
        patchedHash: hash,
        updatedAt: new Date().toISOString()
      });
      this.log(`无需改写（文件未变化）。${formatStats(res.stats)}`);
      return;
    }

    // 此刻 content 是未被本次改写的输入：覆盖备份为“最近一次原始文件”
    fs.writeFileSync(backupPath, content, 'utf8');
    fs.writeFileSync(file, res.content, 'utf8');
    writeMeta(metaPath, {
      state: 'patched',
      rulesVersion: RULES_VERSION,
      cpptoolsVersion: version,
      locale: vscode.env.language,
      originalHash: hash,
      patchedHash: sha256(res.content),
      updatedAt: new Date().toISOString()
    });
    this.log(`改写完成（cpptools ${version}）。${formatStats(res.stats)}`);

    if (cfg.get<boolean>('promptReload', true)) {
      const choice = await vscode.window.showInformationMessage(
        `wbw kawaii: 已改写 cpptools 报错文案（命中 ${res.stats.hits}，兜底 ${res.stats.decorated}），重载窗口后生效。`,
        '重载窗口'
      );
      if (choice === '重载窗口') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
  }

  async restore(): Promise<void> {
    const located = this.locate();
    if (!located) {
      void vscode.window.showInformationMessage('wbw kawaii: 未检测到 cpptools 扩展');
      return;
    }
    const { dir, file } = located;
    const backupPath = path.join(dir, BACKUP_NAME);
    const metaPath = path.join(dir, META_NAME);
    if (!fs.existsSync(backupPath)) {
      void vscode.window.showInformationMessage('wbw kawaii: 没有找到备份（messages.json.orig），无法还原');
      return;
    }
    const original = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(file, original, 'utf8');
    const meta = readMeta(metaPath);
    writeMeta(metaPath, {
      state: 'restored',
      rulesVersion: meta?.rulesVersion ?? RULES_VERSION,
      cpptoolsVersion: meta?.cpptoolsVersion ?? 'unknown',
      locale: meta?.locale ?? vscode.env.language,
      originalHash: sha256(original),
      patchedHash: sha256(original),
      updatedAt: new Date().toISOString()
    });
    this.log('已从备份还原 cpptools 消息文件（state=restored，自动改写暂停）');
    const choice = await vscode.window.showInformationMessage(
      'wbw kawaii: 已还原原始报错文案，重载窗口后生效。若不希望下次启动再次改写，请保持 wbw-kawaii.enabled 关闭（当前已记录还原状态）。',
      '重载窗口'
    );
    if (choice === '重载窗口') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  async status(): Promise<void> {
    const located = this.locate();
    if (!located) {
      void vscode.window.showInformationMessage('wbw kawaii: 未检测到 cpptools 扩展');
      return;
    }
    const { dir, file, version } = located;
    const meta = readMeta(path.join(dir, META_NAME));
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');
    if (!fs.existsSync(file)) {
      void vscode.window.showInformationMessage(`wbw kawaii: 没有消息文件（语言 ${vscode.env.language}）`);
      return;
    }
    const content = fs.readFileSync(file, 'utf8');
    const res = patchContent(content, {
      decorateFallback: cfg.get<boolean>('fallbackDecorate', true)
    });
    const lines = [
      `cpptools 版本: ${version}`,
      `规则版本: ${RULES_VERSION}`,
      `当前状态: ${meta ? `${meta.state}（${meta.cpptoolsVersion}）` : '未记录'}`,
      `enabled: ${cfg.get('enabled', true)}, fallbackDecorate: ${cfg.get('fallbackDecorize', true)}`,
      `本次试算: ${formatStats(res.stats)}`
    ];
    for (const l of lines) this.channel.appendLine(l);
    this.channel.show(true);
    void vscode.window.showInformationMessage(`wbw kawaii: 详见输出面板 —— ${formatStats(res.stats)}`);
  }
}

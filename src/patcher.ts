import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RULES_VERSION, PatchOptions } from './transform';
import {
  patchContent, formatStats,
  patchTsDiag, patchJsonObject, patchPackBundle, patchBundleTemplate,
  transformMarkdownlint, transformPylint,
  initEngineBridge
} from './engine-bridge';
import { interceptDiagnosticCollection } from './intercept';
import {
  buildTargets, TargetDef, TargetMeta, readTargetMeta, writeTargetMeta,
  shouldPatchTarget
} from './targets';
import { buildManifest, readManifest, writeManifest, ManifestTarget } from './targets-manifest';
import { TS_RULES, PACK_RULES, MARKDOWNLINT_RULES } from './rules.generated';
import { getPersona, isWhimperInput, PersonaStyle } from './persona';

export type RunReason = 'startup' | 'extensions-changed' | 'config-enabled' | 'manual';

function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildOpts(cfg: vscode.WorkspaceConfiguration): PatchOptions {
  return {
    decorateFallback: cfg.get<boolean>('fallbackDecorate', true),
    personaStyle: cfg.get<PersonaStyle>('personaStyle', 'soft'),
    intensity: cfg.get<'subtle' | 'normal' | 'bold'>('kawaiiIntensity', 'normal'),
  };
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

  private async doRun(reason: RunReason): Promise<void> {
    const backend = await initEngineBridge();
    this.log(`patch 引擎后端: ${backend}`);
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');
    const enabled = cfg.get<boolean>('enabled', true);
    const auto = reason === 'startup' || reason === 'extensions-changed';
    if (auto && !enabled) {
      this.log('wbw-kawaii.enabled=false，跳过');
      return;
    }

    const locale = (vscode.env.language ?? '').toLowerCase();
    const isZhCn = locale === 'zh-cn';

    // 远端守卫
    if (vscode.env.remoteName && reason !== 'manual') {
      this.log(`远程环境（${vscode.env.remoteName}）跳过自动补丁`);
      return;
    }

    const opts = buildOpts(cfg);

    // ===== 运行时拦截：markdownlint / pylint DiagnosticCollection =====
    if (isZhCn && cfg.get<boolean>('enableMarkdownlint', true)) {
      
      interceptDiagnosticCollection('markdownlint', (source, message, code) =>
        transformMarkdownlint(message, MARKDOWNLINT_RULES, opts, code));
      this.log('[markdownlint] 运行时拦截已激活');
    }
    if (isZhCn && cfg.get<boolean>('enablePylint', true)) {
      
      interceptDiagnosticCollection('PyLinter', (source, message, code) =>
        transformPylint(message, PACK_RULES, opts, code));
      this.log('[pylint] 运行时拦截已激活');
    }

    // ===== 现有 cpptools 流程（locale 门控：非 zh-cn 时还原）=====
    if (!isZhCn) {
      await this.restoreCpptoolsSilent();
    } else {
      await this.runCpptools(reason, opts);
    }

    // ===== 新目标流程 =====
    if (!isZhCn) {
      // 非 zh-cn：还原所有新目标
      await this.restoreNewTargets(reason);
      return;
    }

    // zh-cn：补丁新目标
    const targets = buildTargets();
    let totalRestored = 0;
    let totalNotified = false;

    for (const t of targets) {
      if (t.id === 'cpptools') continue; // 已处理
      const fileHash = fs.existsSync(t.file) ? sha256(fs.readFileSync(t.file, 'utf8')) : null;
      const meta = readTargetMeta(t.metaFile);
      const backupExists = fs.existsSync(t.backupFile);

      // 版本/规则匹配检查
      const versionOk = !meta || meta.sourceVersion === (t.versionProvider?.() ?? 'unknown');
      const rulesOk = !meta || meta.rulesVersion === RULES_VERSION;
      const hashOk = !meta || meta.patchedHash === fileHash;

      if (meta && meta.state === 'restored' && auto) {
        this.log(`[${t.id}] 用户已手动还原，自动改写暂停`);
        continue;
      }
      if (meta && versionOk && rulesOk && hashOk && meta.state === 'patched') {
        this.log(`[${t.id}] 已是改写状态（${t.versionProvider?.() ?? '?'}），跳过`);
        continue;
      }

      // 行数门禁
      if (t.minLines && backupExists) {
        const backupLines = fs.readFileSync(t.backupFile, 'utf8').split('\n').length;
        if (backupLines < t.minLines) {
          this.log(`[${t.id}] 行数 ${backupLines} < 门禁 ${t.minLines}，中止补丁（源文件可能变化）`);
          continue;
        }
      }

      let input = fs.readFileSync(t.file, 'utf8');
      let inputHash = fileHash ?? '';

      // 规则版本变化 → 从备份取回原文
      if (meta && meta.state === 'patched' && meta.rulesVersion !== RULES_VERSION) {
        if (backupExists) {
          const backup = fs.readFileSync(t.backupFile, 'utf8');
          if (sha256(backup) === meta.originalHash) {
            input = backup;
            inputHash = meta.originalHash;
            this.log(`[${t.id}] 规则版本变化（${meta.rulesVersion} → ${RULES_VERSION}），从备份取回原文`);
          } else {
            this.log(`[${t.id}] 警告: 备份哈希不一致，按当前文件继续`);
          }
        } else {
          this.log(`[${t.id}] 警告: 缺少备份，按当前文件继续`);
        }
      }

      // 按目标类型打补丁
      let res: { content: string; stats: { hits: number; decorated: number }; changed: boolean };
      switch (t.kind) {
        case 'tsDiagTable':
          res = patchTsDiag(input, TS_RULES);
          break;
        case 'jsonObject':
          res = patchJsonObject(input, TS_RULES);
          break;
        case 'packBundle':
          res = patchPackBundle(input, PACK_RULES);
          break;
        case 'bundleTemplate':
          res = patchBundleTemplate(input, null, opts);
          break;
        default:
          this.log(`[${t.id}] 未知目标类型 ${t.kind}`);
          continue;
      }

      if (!res.changed) {
        writeTargetMeta(t.metaFile, {
          state: 'patched',
          rulesVersion: RULES_VERSION,
          sourceVersion: t.versionProvider?.() ?? 'unknown',
          locale,
          originalHash: meta?.originalHash ?? inputHash,
          patchedHash: inputHash,
          updatedAt: new Date().toISOString()
        });
        this.log(`[${t.id}] 无需改写（文件未变化）。命中 ${res.stats.hits}，兜底 ${res.stats.decorated}`);
        continue;
      }

      fs.writeFileSync(t.backupFile, input, 'utf8');
      fs.writeFileSync(t.file, res.content, 'utf8');
      writeTargetMeta(t.metaFile, {
        state: 'patched',
        rulesVersion: RULES_VERSION,
        sourceVersion: t.versionProvider?.() ?? 'unknown',
        locale,
        originalHash: inputHash,
        patchedHash: sha256(res.content),
        updatedAt: new Date().toISOString()
      });
      this.log(`[${t.id}] 改写完成。命中 ${res.stats.hits}，兜底 ${res.stats.decorated}`);
      totalRestored = 0; // 不打扰计数
    }

    // 写入 targets-manifest
    try {
      const manifestTargets: ManifestTarget[] = [];
      for (const t of targets) {
        if (t.id === 'cpptools') continue;
        const meta = readTargetMeta(t.metaFile);
        if (meta) {
          manifestTargets.push({
            id: t.id,
            file: t.file,
            backupFile: t.backupFile,
            metaFile: t.metaFile,
            state: meta.state,
            sourceVersion: meta.sourceVersion
          });
        }
      }
      if (manifestTargets.length > 0) {
        const extDir = path.resolve(__dirname, '..');
        const existing = readManifest(extDir);
        const merged = {
          ...buildManifest(manifestTargets),
          rulesVersion: RULES_VERSION
        };
        writeManifest(extDir, merged);
        this.log(`已写入 targets-manifest.json（${manifestTargets.length} 条目标）`);
      }
    } catch (e) {
      this.log(`[manifest] 写入失败: ${String(e)}`);
    }

    // 弹出重载提示
    if (cfg.get<boolean>('promptReload', true) && reason !== 'manual') {
      const choice = await vscode.window.showInformationMessage(
        'wbw kawaii: 已改写 TypeScript / CSS / HTML 报错文案，重载窗口后生效。',
        '重载窗口'
      );
      if (choice === '重载窗口') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
  }

  // ===== cpptools 原有逻辑（保持不变）=====
  private locateCpptools(): { dir: string; file: string; version: string } | null {
    const ext = vscode.extensions.getExtension('ms-vscode.cpptools');
    if (!ext) return null;
    const locale = (vscode.env.language || '').toLowerCase();
    const dir = path.join(ext.extensionPath, 'bin', 'messages', locale);
    const file = path.join(dir, 'messages.json');
    const version = String((ext.packageJSON as { version?: string }).version ?? 'unknown');
    return { dir, file, version };
  }

  private async runCpptools(reason: RunReason, opts: PatchOptions): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');
    const auto = reason === 'startup' || reason === 'extensions-changed';
    if (auto && !cfg.get<boolean>('enabled', true)) {
      this.log('wbw-kawaii.enabled=false，跳过 cpptools');
      return;
    }
    const located = this.locateCpptools();
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
    const metaPath = path.join(dir, 'messages.json.wbw-kawaii.json');
    const backupPath = path.join(dir, 'messages.json.orig');
    const meta = readTargetMeta(metaPath);

    if (meta && meta.state === 'restored' && auto) {
      this.log('检测到用户已手动还原（state=restored），自动改写暂停；可用命令"Kawaii: 重新改写"恢复');
      return;
    }
    if (meta && meta.rulesVersion === RULES_VERSION && meta.patchedHash === hash && meta.sourceVersion === version) {
      this.log(`已是改写状态（cpptools ${version}, ${RULES_VERSION}），跳过`);
      return;
    }

    let input = content;
    let inputHash = hash;
    if (meta && meta.state === 'patched' && meta.rulesVersion !== RULES_VERSION) {
      if (fs.existsSync(backupPath)) {
        const backup = fs.readFileSync(backupPath, 'utf8');
        if (sha256(backup) === meta?.originalHash) {
          input = backup;
          inputHash = meta?.originalHash;
          this.log(`规则版本变化（${meta.rulesVersion} → ${RULES_VERSION}），从备份取回原文后重新改写`);
        } else {
          this.log('警告: 备份与记录的原始哈希不一致，无法回退旧改写，按当前文件继续');
        }
      } else {
        this.log('警告: 缺少备份 messages.json.orig，无法回退旧改写，按当前文件继续');
      }
    }

    const res = patchContent(input, opts);
    if (!res.changed) {
      writeTargetMeta(metaPath, {
        state: 'patched',
        rulesVersion: RULES_VERSION,
        sourceVersion: version,
        locale: vscode.env.language,
        originalHash: meta ? meta?.originalHash : inputHash,
        patchedHash: inputHash,
        updatedAt: new Date().toISOString()
      } as TargetMeta);
      this.log(`无需改写（文件未变化）。${formatStats(res.stats)}`);
      return;
    }
    fs.writeFileSync(backupPath, input, 'utf8');
    fs.writeFileSync(file, res.content, 'utf8');
    writeTargetMeta(metaPath, {
      state: 'patched',
      rulesVersion: RULES_VERSION,
      sourceVersion: version,
      locale: vscode.env.language,
      originalHash: inputHash,
      patchedHash: sha256(res.content),
      updatedAt: new Date().toISOString()
    } as TargetMeta);
    this.log(`改写完成（cpptools ${version}）。${formatStats(res.stats)}`);
  }

  // ===== 非 zh-cn 时还原所有新目标 =====
  private async restoreNewTargets(reason: RunReason): Promise<void> {
    const targets = buildTargets();
    let restoredCount = 0;
    for (const t of targets) {
      if (t.id === 'cpptools') continue;
      const meta = readTargetMeta(t.metaFile);
      if (!meta || meta.state !== 'patched') continue;
      if (!fs.existsSync(t.backupFile)) {
        this.log(`[${t.id}] 缺少备份，跳过还原`);
        continue;
      }
      try {
        const backup = fs.readFileSync(t.backupFile, 'utf8');
        if (sha256(backup) === meta.originalHash) {
          fs.writeFileSync(t.file, backup, 'utf8');
          writeTargetMeta(t.metaFile, { ...meta, state: 'inactive', updatedAt: new Date().toISOString() });
          restoredCount++;
          this.log(`[${t.id}] 已还原为原文（locale=${vscode.env.language}）`);
        } else {
          this.log(`[${t.id}] 备份哈希不一致，跳过还原`);
        }
      } catch (e) {
        this.log(`[${t.id}] 还原失败: ${String(e)}`);
      }
    }
    if (restoredCount > 0 && reason !== 'manual') {
      void vscode.window.showInformationMessage(
        `wbw kawaii：界面语言不是简体中文（${vscode.env.language}），已还原 cpptools / TS / CSS / HTML 的可爱补丁（显示英文原文）。切回简体中文后会自动重新生效。`
      );
    }
  }

  // ===== 静默还原 cpptools（非 zh-cn 门控用，不弹通知）=====
  private async restoreCpptoolsSilent(): Promise<void> {
    const located = this.locateCpptools();
    if (!located) return;
    const { dir, file } = located;
    const backupPath = path.join(dir, 'messages.json.orig');
    const metaPath = path.join(dir, 'messages.json.wbw-kawaii.json');
    const meta = readTargetMeta(metaPath);
    if (!meta || meta.state !== 'patched') return;
    if (!fs.existsSync(backupPath)) {
      this.log('[cpptools] 缺少备份，跳过还原');
      return;
    }
    try {
      const backup = fs.readFileSync(backupPath, 'utf8');
      if (sha256(backup) === meta.originalHash) {
        fs.writeFileSync(file, backup, 'utf8');
        writeTargetMeta(metaPath, { ...meta, state: 'inactive', updatedAt: new Date().toISOString() });
        this.log('[cpptools] 已还原为原文（locale 非 zh-cn）');
      } else {
        this.log('[cpptools] 备份哈希不一致，跳过还原');
      }
    } catch (e) {
      this.log(`[cpptools] 还原失败: ${String(e)}`);
    }
  }

  async restore(): Promise<void> {
    // cpptools 还原（原有逻辑）
    const located = this.locateCpptools();
    if (!located) {
      void vscode.window.showInformationMessage('wbw kawaii: 未检测到 cpptools 扩展');
      return;
    }
    const { dir, file } = located;
    const backupPath = path.join(dir, 'messages.json.orig');
    const metaPath = path.join(dir, 'messages.json.wbw-kawaii.json');
    if (!fs.existsSync(backupPath)) {
      void vscode.window.showInformationMessage('wbw kawaii: 没有找到备份（messages.json.orig），无法还原');
      return;
    }
    const original = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(file, original, 'utf8');
    const meta = readTargetMeta(metaPath);
    writeTargetMeta(metaPath, {
      state: 'restored',
      rulesVersion: meta?.rulesVersion ?? RULES_VERSION,
      sourceVersion: meta?.sourceVersion ?? 'unknown',
      locale: meta?.locale ?? vscode.env.language,
      originalHash: sha256(original),
      patchedHash: sha256(original),
      updatedAt: new Date().toISOString()
    } as TargetMeta);
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
    const located = this.locateCpptools();
    const locale = vscode.env.language;
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');

    const lines: string[] = [
      `界面语言: ${locale}`,
      `enabled: ${cfg.get('enabled', true)}, fallbackDecorate: ${cfg.get('fallbackDecorate', true)}`,
      '',
      '=== cpptools ==='
    ];

    if (located) {
      const { dir, file, version } = located;
      const meta = readTargetMeta(path.join(dir, 'messages.json.wbw-kawaii.json'));
      if (!fs.existsSync(file)) {
        lines.push(`  状态: 没有消息文件（语言 ${locale}）`);
      } else {
        const content = fs.readFileSync(file, 'utf8');
        const res = patchContent(content, buildOpts(cfg));
        lines.push(
          `  版本: ${version}`,
          `  规则版本: ${RULES_VERSION}`,
          `  当前状态: ${meta ? `${meta.state}（${meta.sourceVersion}）` : '未记录'}`,
          `  本次试算: ${formatStats(res.stats)}`
        );
      }
    } else {
      lines.push('  未安装 cpptools');
    }

    lines.push('', '=== TS / CSS / HTML ===');
    try {
      const targets = buildTargets();
      for (const t of targets) {
        if (t.id === 'cpptools') continue;
        const meta = readTargetMeta(t.metaFile);
        const exists = fs.existsSync(t.file);
        if (!exists) {
          lines.push(`  [${t.id}] 文件不存在`);
          continue;
        }
        lines.push(
          `  [${t.id}]`,
          `    版本: ${t.versionProvider?.() ?? '?'}`,
          `    规则版本: ${RULES_VERSION}`,
          `    状态: ${meta ? meta.state : '未记录'}`,
          `    locale: ${meta?.locale ?? '-'}`
        );
      }
    } catch (e) {
      lines.push(`  构建目标失败: ${String(e)}`);
    }

    for (const l of lines) this.channel.appendLine(l);
    this.channel.show(true);
    void vscode.window.showInformationMessage(`wbw kawaii: 详见输出面板`);
  }

  async cyclePersona(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('wbw-kawaii');
    const current = cfg.get<string>('personaStyle', 'soft');
    const styles = ['soft', 'tsundere', 'derriere', 'cool'];
    const idx = styles.indexOf(current);
    const next = styles[(idx + 1) % styles.length];
    await cfg.update('personaStyle', next, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('wbw kawaii: persona changed to ' + next);
  }

  async whimper(): Promise<void> {
    const input = await vscode.window.showInputBox({ prompt: 'Say something...', placeHolder: 'Type here...' });
    if (!input) return;
    
    if (isWhimperInput(input)) {
      const style = vscode.workspace.getConfiguration('wbw-kawaii').get<string>('personaStyle', 'soft');
      
      const msg = getPersona(style as PersonaStyle).easterEggMessage;
      if (msg) void vscode.window.showWarningMessage('wbw kawaii: ' + msg);
    }
  }

}
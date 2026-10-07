// 目标定义与定位：每个目标对应一个可补丁的源文件 + 元数据。
// 类型：'jsonArray'（cpptools messages.json）| 'tsDiagTable'（typescript.js diag 表）
//      | 'jsonObject'（zh-cn JSON 键值对）| 'packBundle'（语言包 contents.bundle）
//      | 'bundleTemplate'（server bundle 内模板字面量）
import * as fs from 'node:fs';
import * as path from 'node:path';

export type TargetKind = 'jsonArray' | 'tsDiagTable' | 'jsonObject' | 'packBundle' | 'bundleTemplate';
export type TargetState = 'patched' | 'restored' | 'inactive';

export interface TargetMeta {
  state: TargetState;
  rulesVersion: string;
  sourceVersion: string; // 各源文件版本（cpptools/ts/language-pack）
  locale: string;
  originalHash: string;
  patchedHash: string;
  updatedAt: string;
}

export interface TargetDef {
  id: string;
  kind: TargetKind;
  // 文件路径
  file: string;
  backupFile: string;
  metaFile: string;
  // 版本来源（用于检测变化）
  versionProvider?: () => string;
  // 远端守卫：是否在远程环境跳过
  skipRemote?: boolean;
  // 行数门禁（低于此值视为源文件格式变化，中止补丁）
  minLines?: number;
  // 占位符规则（用于运行时变换）
  placeholderRule?: 'percent' | 'braced'; // percent=%s / braced={N}
}

// VS Code appRoot 候选链解析（哈希目录布局兼容）
function findExtensionsRoot(appRootOverride?: string): string | null {
  if (appRootOverride) {
    const cands = [
      appRootOverride,
      path.join(appRootOverride, 'resources', 'app', 'extensions'),
      path.join(appRootOverride, 'extensions')
    ];
    for (const c of cands) {
      if (fs.existsSync(path.join(c, 'node_modules', 'typescript', 'lib', 'typescript.js'))) return c;
    }
    return null;
  }
  const candidates: string[] = [];
  // LOCALAPPDATA / ProgramFiles
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'));
  if (process.env.PROGRAMFILES) candidates.push(path.join(process.env.PROGRAMFILES, 'Microsoft VS Code'));
  if (process.env['PROGRAMFILES(X86)']) candidates.push(path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft VS Code'));
  // 直接路径
  candidates.push('C:\\Program Files\\Microsoft VS Code');
  candidates.push('C:\\Program Files (x86)\\Microsoft VS Code');

  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const direct = path.join(root, 'resources', 'app', 'extensions');
    if (fs.existsSync(path.join(direct, 'node_modules', 'typescript', 'lib', 'typescript.js'))) return direct;
    // 哈希目录
    let entries: string[] = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const name of entries) {
      const r = path.join(root, name, 'resources', 'app', 'extensions');
      if (fs.existsSync(path.join(r, 'node_modules', 'typescript', 'lib', 'typescript.js'))) return r;
    }
  }
  // VS Code Insiders fallback
  if (process.env.LOCALAPPDATA) {
    const ir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders');
    if (fs.existsSync(ir)) {
      const direct = path.join(ir, 'resources', 'app', 'extensions');
      if (fs.existsSync(path.join(direct, 'node_modules', 'typescript', 'lib', 'typescript.js'))) return direct;
    }
  }
  return null;
}

// 语言包定位
function findPackTranslations(packDirOverride?: string): string | null {
  if (packDirOverride) {
    const cands = [packDirOverride, path.join(packDirOverride, 'translations', 'extensions'), path.join(packDirOverride, 'extensions')];
    for (const c of cands) {
      if (fs.existsSync(path.join(c, 'vscode.css-language-features.i18n.json')) &&
          fs.existsSync(path.join(c, 'vscode.html-language-features.i18n.json'))) return c;
    }
    return null;
  }
  const roots = [
    path.join(require('os').homedir(), '.vscode', 'extensions'),
    path.join(require('os').homedir(), '.vscode-insiders', 'extensions')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const packs = fs.readdirSync(root).filter(n => n.startsWith('ms-ceintl.vscode-language-pack-zh-hans-')).sort();
    for (let i = packs.length - 1; i >= 0; i--) {
      const cands = [
        path.join(root, packs[i], 'translations', 'extensions'),
        path.join(root, packs[i], 'extensions')
      ];
      for (const c of cands) {
        if (fs.existsSync(path.join(c, 'vscode.css-language-features.i18n.json')) &&
            fs.existsSync(path.join(c, 'vscode.html-language-features.i18n.json'))) return c;
      }
    }
  }
  return null;
}

// 目标清单
export function buildTargets(appRootOverride?: string, packDirOverride?: string): TargetDef[] {
  const extRoot = findExtensionsRoot(appRootOverride);
  if (!extRoot) throw new Error('无法定位 VS Code extensions 目录');

  const libDir = path.join(extRoot, 'node_modules', 'typescript', 'lib');
  const tsVersion = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(libDir, '..', 'package.json'), 'utf8')).version ?? '?'; }
    catch { return '?'; }
  })();

  const packTrans = findPackTranslations(packDirOverride);
  const packVersion = packTrans
    ? path.basename(path.dirname(path.dirname(packTrans))) // ms-ceintl...-version
    : 'unknown';

  const targets: TargetDef[] = [
    // cpptools（现有目标，locale 无关，始终处理）
    {
      id: 'cpptools',
      kind: 'jsonArray' as TargetKind,
      file: '', // 由 patcher 动态定位
      backupFile: '',
      metaFile: '',
      versionProvider: () => 'unknown',
      minLines: 0,
      placeholderRule: 'percent' as 'percent' | 'braced'
    } as TargetDef & { file: string; backupFile: string; metaFile: string },
    // TS/JS diag 表（typescript.js）
    {
      id: 'tsDiag',
      kind: 'tsDiagTable' as TargetKind,
      file: path.join(libDir, 'typescript.js'),
      backupFile: path.join(libDir, 'typescript.js.orig'),
      metaFile: path.join(libDir, 'typescript.js.wbw-kawaii.json'),
      versionProvider: () => tsVersion,
      minLines: 2000,
      placeholderRule: 'braced' as 'percent' | 'braced'
    },
    // TS zh-cn 本地化 JSON（主路径）
    {
      id: 'tsLocale',
      kind: 'jsonObject' as TargetKind,
      file: path.join(libDir, 'zh-cn', 'diagnosticMessages.generated.json'),
      backupFile: path.join(libDir, 'zh-cn', 'diagnosticMessages.generated.json.orig'),
      metaFile: path.join(libDir, 'zh-cn', 'diagnosticMessages.generated.json.wbw-kawaii.json'),
      versionProvider: () => tsVersion,
      minLines: 2000,
      placeholderRule: 'braced' as 'percent' | 'braced'
    },
    // CSS 语言包
    {
      id: 'packCss',
      kind: 'packBundle' as TargetKind,
      file: packTrans ? path.join(packTrans, 'vscode.css-language-features.i18n.json') : '',
      backupFile: packTrans ? path.join(packTrans, 'vscode.css-language-features.i18n.json.orig') : '',
      metaFile: packTrans ? path.join(packTrans, 'vscode.css-language-features.i18n.json.wbw-kawaii.json') : '',
      versionProvider: () => packVersion,
      placeholderRule: 'braced' as 'percent' | 'braced'
    },
    // HTML 语言包
    {
      id: 'packHtml',
      kind: 'packBundle' as TargetKind,
      file: packTrans ? path.join(packTrans, 'vscode.html-language-features.i18n.json') : '',
      backupFile: packTrans ? path.join(packTrans, 'vscode.html-language-features.i18n.json.orig') : '',
      metaFile: packTrans ? path.join(packTrans, 'vscode.html-language-features.i18n.json.wbw-kawaii.json') : '',
      versionProvider: () => packVersion,
      placeholderRule: 'braced' as 'percent' | 'braced'
    },
    // CSS server bundle 模板串
    {
      id: 'bundleCss',
      kind: 'bundleTemplate' as TargetKind,
      file: path.join(extRoot, 'css-language-features', 'server', 'dist', 'node', 'cssServerMain.js'),
      backupFile: path.join(extRoot, 'css-language-features', 'server', 'dist', 'node', 'cssServerMain.js.orig'),
      metaFile: path.join(extRoot, 'css-language-features', 'server', 'dist', 'node', 'cssServerMain.js.wbw-kawaii.json'),
      versionProvider: () => tsVersion,
      placeholderRule: 'braced' as 'percent' | 'braced'
    },
    // HTML server bundle 模板串
    {
      id: 'bundleHtml',
      kind: 'bundleTemplate' as TargetKind,
      file: path.join(extRoot, 'html-language-features', 'server', 'dist', 'node', 'htmlServerMain.js'),
      backupFile: path.join(extRoot, 'html-language-features', 'server', 'dist', 'node', 'htmlServerMain.js.orig'),
      metaFile: path.join(extRoot, 'html-language-features', 'server', 'dist', 'node', 'htmlServerMain.js.wbw-kawaii.json'),
      versionProvider: () => tsVersion,
      placeholderRule: 'braced' as 'percent' | 'braced'
    }
  ].filter(t => t.file && fs.existsSync(t.file));
  return targets;
}

// 门控：仅 zh-cn 下为新目标打补丁；非 zh-cn 下还原
export function shouldPatchTarget(targetId: string, locale: string): boolean {
  if (targetId === 'cpptools') return true; // cpptools 始终处理
  return locale === 'zh-cn';
}

// meta 读写
export function readTargetMeta(metaPath: string): TargetMeta | null {
  try {
    if (!fs.existsSync(metaPath)) return null;
    const v = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (v && typeof v === 'object' && typeof v.patchedHash === 'string') return v as TargetMeta;
    return null;
  } catch { return null; }
}

export function writeTargetMeta(metaPath: string, meta: TargetMeta): void {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

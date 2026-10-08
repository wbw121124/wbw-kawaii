// 三级回退桥：patch 系列函数在 native .node / engine.wasm 可用时走引擎，
// 否则回落 TS 实现（与引擎输出逐字节一致，golden 三跑保证）。
//
// 用法：patcher.doRun 开头 `await initEngineBridge()`；之后同步调用本模块导出的
// 与 transform / transform-new 同名函数。
import {
  patchContent as tsPatchContent,
  formatStats as tsFormatStats,
  PatchOptions,
  PatchResult,
  PatchStats,
} from './transform';
import {
  patchTsDiag as tsPatchTsDiag,
  patchJsonObject as tsPatchJsonObject,
  patchPackBundle as tsPatchPackBundle,
  patchBundleTemplate as tsPatchBundleTemplate,
  transformMarkdownlint as tsTransformMarkdownlint,
  transformPylint as tsTransformPylint,
} from './transform-new';

type RuleTable = Record<string, string[]>;

/** transform-new 系列结果（TS 形状 `{content, stats:{hits,decorated}, changed}`）。 */
export interface NewPatchResult {
  content: string;
  stats: { hits: number; decorated: number };
  changed: boolean;
}

/** 引擎对象的 patch 级 API（engine/index.js loadEngine 返回值的结构化子集）。 */
interface EnginePatchApi {
  path: string;
  patchContent(content: string, opts?: PatchOptions): PatchResult;
  formatStats(stats: PatchStats): string;
  patchTsDiag(content: string, rules: RuleTable, opts?: PatchOptions): NewPatchResult;
  patchJsonObject(content: string, rules: RuleTable, opts?: PatchOptions): NewPatchResult;
  patchPackBundle(content: string, rules: RuleTable, opts?: PatchOptions): NewPatchResult;
  patchBundleTemplate(
    content: string,
    rules: RuleTable | null,
    opts?: PatchOptions,
  ): NewPatchResult;
  transformMarkdownlintWithRules(
    msg: string,
    rules: RuleTable,
    opts?: PatchOptions,
    code?: string,
  ): string;
  transformPylintWithRules(
    msg: string,
    rules: RuleTable,
    opts?: PatchOptions,
    code?: string,
  ): string;
}

let engine: EnginePatchApi | null = null;
let loading: Promise<string> | null = null;

/**
 * 加载引擎（幂等）：native → wasm → 全程 TS。
 * @returns 生效后端路径（'native' | 'wasm' | 'ts'）
 */
export function initEngineBridge(): Promise<string> {
  if (!loading) {
    loading = (async () => {
      try {
        // 相对 out/engine-bridge.js → 扩展根目录 engine/（CJS loader，wasm 走异步）
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const loader = require('../engine/index.js') as {
          loadEngine(): Promise<EnginePatchApi | null>;
        };
        const e = await loader.loadEngine();
        if (e && typeof e.patchContent === 'function') {
          engine = e;
          return e.path;
        }
      } catch {
        // 产物缺失 / 版本不匹配 → 静默回落 TS
      }
      return 'ts';
    })();
  }
  return loading;
}

/** 当前后端（未初始化时为 'ts'）。 */
export function enginePath(): string {
  return engine ? engine.path : 'ts';
}

export function patchContent(content: string, opts: PatchOptions): PatchResult {
  return engine ? engine.patchContent(content, opts) : tsPatchContent(content, opts);
}

export function formatStats(stats: PatchStats): string {
  return engine ? engine.formatStats(stats) : tsFormatStats(stats);
}

export function patchTsDiag(content: string, rules: RuleTable, opts?: PatchOptions): NewPatchResult {
  return engine ? engine.patchTsDiag(content, rules, opts) : tsPatchTsDiag(content, rules, opts);
}

export function patchJsonObject(
  content: string,
  rules: RuleTable,
  opts?: PatchOptions,
): NewPatchResult {
  return engine ? engine.patchJsonObject(content, rules, opts) : tsPatchJsonObject(content, rules, opts);
}

export function patchPackBundle(
  content: string,
  rules: RuleTable,
  opts?: PatchOptions,
): NewPatchResult {
  return engine ? engine.patchPackBundle(content, rules, opts) : tsPatchPackBundle(content, rules, opts);
}

export function patchBundleTemplate(
  content: string,
  rules: RuleTable | null,
  opts?: PatchOptions,
): NewPatchResult {
  return engine
    ? engine.patchBundleTemplate(content, rules, opts)
    : tsPatchBundleTemplate(content, rules, opts);
}

export function transformMarkdownlint(
  message: string,
  rules: RuleTable,
  opts?: PatchOptions,
  code?: string,
): string {
  return engine
    ? engine.transformMarkdownlintWithRules(message, rules, opts, code)
    : tsTransformMarkdownlint(message, rules, opts, code);
}

export function transformPylint(
  message: string,
  rules: RuleTable,
  opts?: PatchOptions,
  code?: string,
): string {
  return engine
    ? engine.transformPylintWithRules(message, rules, opts, code)
    : tsTransformPylint(message, rules, opts, code);
}

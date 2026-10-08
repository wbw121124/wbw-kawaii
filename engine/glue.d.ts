// engine.wasm 胶水类型（glue.mjs）。

/** 每次调用的可选参数（缺省回落引擎状态/默认值）。 */
export interface EngineOpts {
  personaStyle?: string
  intensity?: string
  customFallback?: string | null
  decorateFallback?: boolean
}

/** 引擎统计。 */
export interface EngineStats {
  path: 'native' | 'wasm'
  rulesVersion: string
  persona: string
  ruleCount: number
}

/** 规则表（TS `Record<string, string[]>`）。 */
export type RuleTable = Record<string, string[]>

/** 单条目结果（TS `EntryResult`；null 条目 value 为 null）。 */
export interface EntryResult {
  value: string | null
  kind: 'null' | 'hit' | 'decorated' | 'kept' | 'already' | 'identity'
}

/** patchContent 统计（8 字段，与 TS 一致）。 */
export interface PatchStats {
  total: number
  nulls: number
  hits: number
  decorated: number
  identity: number
  kept: number
  already: number
  changed: number
}

/** patchContent 结果。 */
export interface PatchResult {
  content: string
  stats: PatchStats
  changed: boolean
}

/** transform-new 系列结果（stats 仅 hits/decorated）。 */
export interface NewPatchResult {
  content: string
  hits: number
  decorated: number
  changed: boolean
}

/** wasm 引擎对象（与 native 壳 API 镜像）。 */
export interface WasmEngine {
  path: 'wasm'
  transformMessage(msg: string, opts?: EngineOpts): string
  transformMarkdownlint(msg: string, opts?: EngineOpts, code?: string): string
  transformPylint(msg: string, opts?: EngineOpts, code?: string): string
  transformWhimper(input: string, opts?: EngineOpts): string
  loadRules(source: string): string
  loadRulesText(text: string): string
  cyclePersona(): string
  getStats(): EngineStats
  // ── P4 patch 级 API ──
  tokenize(s: string): string[]
  transformValue(value: string, index: number, opts?: EngineOpts): EntryResult
  patchContent(content: string, opts?: EngineOpts): PatchResult
  formatStats(stats: PatchStats): string
  patchTsDiag(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  patchJsonObject(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  patchPackBundle(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  patchBundleTemplate(content: string, rules: RuleTable | null, opts?: EngineOpts): NewPatchResult
  transformMarkdownlintWithRules(msg: string, rules: RuleTable, opts?: EngineOpts, code?: string): string
  transformPylintWithRules(msg: string, rules: RuleTable, opts?: EngineOpts, code?: string): string
}

/**
 * 实例化 engine.wasm 并返回引擎对象。
 * @param wasmSource wasm 字节 / 文件路径（Node）/ URL（浏览器）
 */
export declare function createWasmEngine(
  wasmSource: string | URL | Uint8Array | ArrayBuffer,
): Promise<WasmEngine>

/**
 * 由已实例化的 instance 构造引擎对象（同步；Node 侧可先 WebAssembly.Module.compile）。
 */
export declare function engineFromInstance(instance: WebAssembly.Instance): WasmEngine

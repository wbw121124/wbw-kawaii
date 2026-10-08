// loader 类型（index.js）。原生直通函数的原始类型见 kawaii-napi.d.ts（napi build 生成）。

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

/** transform-new 系列统计（与 TS `{hits, decorated}` 一致）。 */
export interface NewPatchStats {
  hits: number
  decorated: number
}

/** transform-new 系列结果（与 TS `{content, stats, changed}` 一致）。 */
export interface NewPatchResult {
  content: string
  stats: NewPatchStats
  changed: boolean
}

/** 统一引擎对象（native 与 wasm 两路镜像）。 */
export interface Engine {
  path: 'native' | 'wasm'
  /** 消息主入口。 */
  transformMessage(msg: string, opts?: EngineOpts): string
  /** MarkdownLint 消息（结构化兜底保留前缀/详情）。 */
  transformMarkdownlint(msg: string, opts?: EngineOpts, code?: string): string
  /** PyLint 消息（结构化兜底保留规则码前缀）。 */
  transformPylint(msg: string, opts?: EngineOpts, code?: string): string
  /** 颤音彩蛋：命中关键词返回彩蛋文案，否则空串。 */
  transformWhimper(input: string, opts?: EngineOpts): string
  /** 规则热加载：`builtin` / `file:<路径>` / 原始 DSL 文本，返回新规则版本。 */
  loadRules(source: string): string
  /** 直接加载规则 DSL 文本。 */
  loadRulesText(text: string): string
  /** 人设轮转：soft → tsundere → derriere → cool → soft，返回新风格。 */
  cyclePersona(): string
  /** 引擎统计。 */
  getStats(): EngineStats
  /** 自述串（仅 native 路径）。 */
  engineInfo?(): string
  // ── P4 patch 级 API（native 直通 / wasm 镜像） ──
  /** 占位符切分（TS `tokenize`）。 */
  tokenize(s: string): string[]
  /** 单条目转换（TS `transformValue(value, index, opts)`）。 */
  transformValue(value: string, index: number, opts?: EngineOpts): EntryResult
  /** 整段内容改写（TS `patchContent`）。 */
  patchContent(content: string, opts?: EngineOpts): PatchResult
  /** 统计文案（TS `formatStats`）。 */
  formatStats(stats: PatchStats): string
  /** TS diag 表补丁。 */
  patchTsDiag(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  /** zh JSON 行补丁。 */
  patchJsonObject(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  /** 语言包 bundle 补丁。 */
  patchPackBundle(content: string, rules: RuleTable, opts?: EngineOpts): NewPatchResult
  /** bundle 模板串补丁。 */
  patchBundleTemplate(content: string, rules: RuleTable | null, opts?: EngineOpts): NewPatchResult
  /** MarkdownLint 消息 + 指定规则表。 */
  transformMarkdownlintWithRules(msg: string, rules: RuleTable, opts?: EngineOpts, code?: string): string
  /** PyLint 消息 + 指定规则表。 */
  transformPylintWithRules(msg: string, rules: RuleTable, opts?: EngineOpts, code?: string): string
}

/** 三级回退加载：native → engine.wasm → null（调用方走 TS 实现）。 */
export declare function loadEngine(): Promise<Engine | null>

/** 直接取 .node 模块（无则 null）。 */
export declare function loadNativeModule(): Record<string, unknown> | null

/** 直接加载 wasm 引擎（无产物则 null）。 */
export declare function loadWasmEngine(): Promise<Engine | null>

/** 定位 engine.wasm（打包位置优先，其次本地构建产物）。 */
export declare function findWasmPath(): string | null

// ── 原生直通（native 存在时的顶层导出；类型随 kawaii-napi.d.ts 生成） ──
export * from './kawaii-napi'

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

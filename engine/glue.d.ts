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
}

/**
 * 实例化 engine.wasm 并返回引擎对象。
 * @param wasmSource wasm 字节 / 文件路径（Node）/ URL（浏览器）
 */
export declare function createWasmEngine(
  wasmSource: string | URL | Uint8Array | ArrayBuffer,
): Promise<WasmEngine>

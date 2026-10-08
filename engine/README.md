# @wbw/kawaii-engine

通用可爱化引擎（Rust 核心）。计划见 `.opencode/plans/rust-napi-engine.md`。

- `kawaii-core`：纯 Rust 核心（消息 CST / 规则 DSL / 引擎状态机），可编 wasm32
- `kawaii-napi`：N-API 薄壳 → `.node`（扩展原生层）
- `kawaii-wasm`：手工 C-ABI wasm 薄壳 → `kawaii_wasm.wasm`（浏览器 / Node 中间回退层）

## 命令

```bash
npm install
npm run build        # 原生 .node
npm run build:debug  # 原生 .node（debug）
npm run build:wasm   # engine.wasm（target/wasm32-unknown-unknown/release/）
npm test             # smoke(native) + smoke(wasm) + parity(native↔wasm)
cargo test --workspace
```

Windows 本地使用 gnu 工具链（`.cargo/config.toml`，链接 `vendor/win32-gnu/libnode`）。

## 用法（三级回退）

```js
const { loadEngine } = require('@wbw/kawaii-engine');
const engine = await loadEngine();   // native → wasm → null
if (!engine) throw new Error('引擎不可用（走 TS 兜底）');

engine.transformMessage('are you ok?', { personaStyle: 'tsundere' });
engine.transformMarkdownlint('MD013: Line too long [121 > 80]', {}, 'MD013');
engine.transformPylint('Missing module docstring', {});
engine.transformWhimper('我太菜了');
engine.loadRules('builtin');                    // 或 'file:<路径>' / 原始 DSL 文本
engine.loadRulesText('rule "t" { ... }');
engine.cyclePersona();                          // soft → tsundere → derriere → cool → soft
engine.getStats();                              // { path, rulesVersion, persona, ruleCount }
```

- opts（camelCase，缺省回落引擎状态）：`personaStyle` / `intensity` / `customFallback` / `decorateFallback`
- `path: 'native' | 'wasm'` 标识当前生效的产物

### wasm 直连（浏览器 / ESM）

```js
import { createWasmEngine } from '@wbw/kawaii-engine/wasm';
const engine = await createWasmEngine(new URL('./kawaii_wasm.wasm', import.meta.url));
```

浏览器演示：`demo/index.html`（构建 wasm 后起静态服务打开，例如
`npx serve .`，访问 `/demo/`）。`file:` 规则源在浏览器不可用（无同步 fs），
请先 `fetch` 文本再 `loadRulesText`；Node 端经 `loadEngine()` 自动补 `file:` 支持。

## parity（P3 验收）

`test/parity.cjs` 对同一输入序列断言 native 与 wasm 输出逐字节一致
（消息 / MD / PyLint / whimper / 规则热加载 / 人设轮转 / 统计 / 错误路径）。
napi 层与 jsonlite 层的 opts 类型错误文本不同属预期，仅断言双方都抛。

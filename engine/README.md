# @wbw/kawaii-engine

通用可爱化引擎（Rust 核心）。计划见 `.opencode/plans/rust-napi-engine.md`。

- `kawaii-core`：纯 Rust 核心（P1 起含消息 CST / 规则 DSL），可编 wasm32
- `kawaii-napi`：N-API 薄壳 → `.node`（扩展原生层）
- `kawaii-wasm`：手工 C-ABI wasm 薄壳 → `engine.wasm`（浏览器 / Node 中间回退层）

## 命令

```bash
npm install
npm run build        # 原生 .node
npm run build:wasm   # engine.wasm
npm test             # smoke：加载 .node 与 .wasm
cargo test --workspace
```

Windows 本地使用 gnu 工具链（`.cargo/config.toml` 已开 `+crt-static`）。

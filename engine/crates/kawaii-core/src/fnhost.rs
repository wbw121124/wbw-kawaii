//! 自定义规则函数宿主：core 只依赖 trait，具体实现按目标切换。
//!
//! - native（`.node`）→ `kawaii-fn-wasmtime::WasmtimeHost`（Wasmtime 沙箱执行用户 wasm 模块）；
//! - wasm32（`engine.wasm`）→ 默认 `NoFnHost`，调用 `call(...)` 即拒绝（浏览器不链 Wasmtime）；
//! - 测试 → mock 实现。
//!
//! ABI v1（guest 导出，core wasm module，无 WASI、禁止 import）：
//! `alloc(n) -> ptr`、`transform(in_ptr, in_len, ctx_ptr, ctx_len) -> i64`
//! （打包 `(len << 32) | ptr`，`-1` 表示 guest 主动报错）、可选 `dealloc(ptr, len)`。

/// 宿主调用自定义函数的能力。`Send + Sync`：引擎被放进全局 `Mutex` 跨线程共享。
pub trait CustomFnHost: Send + Sync {
    /// 执行 `name`：`input` = 当前消息候选，`ctx_json` = 规则侧上下文
    /// （`{"fn":..., "args":[...], ...}`）。返回值**整体替换** `input`。
    fn call(&self, name: &str, input: &str, ctx_json: &str) -> Result<String, String>;

    /// 宿主标识（统计 / 调试用），默认 `custom`。
    fn kind(&self) -> &'static str {
        "custom"
    }
}

/// 空宿主：未注册任何自定义函数。引擎未 `set_fn_host` 时使用。
#[derive(Debug, Default, Clone, Copy)]
pub struct NoFnHost;

impl CustomFnHost for NoFnHost {
    fn call(&self, name: &str, _input: &str, _ctx_json: &str) -> Result<String, String> {
        Err(format!("未注册的自定义函数 `{name}`（需要先 loadCustomFunctions）"))
    }

    fn kind(&self) -> &'static str {
        "none"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_fn_host_rejects_everything() {
        let h = NoFnHost;
        let err = h.call("whatever", "x", "{}").expect_err("必须拒绝");
        assert!(err.contains("whatever"), "{}", err);
        assert_eq!(h.kind(), "none");
    }
}

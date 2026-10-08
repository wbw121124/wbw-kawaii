//! kawaii-core：纯 Rust 核心，零 napi / 零 wasmtime 依赖，可编译到 wasm32。
//!
//! P1 起在此堆叠：消息 CST 解析（cst/message）、规则 DSL（cst/rule）、求值（eval）。

/// 引擎版本（与 workspace 同步）。
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 返回核心自述串。P0 骨架占位，P1 起替换为消息 CST 解析入口。
pub fn engine_info() -> String {
    format!("kawaii-core {ENGINE_VERSION}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_info_contains_version() {
        let info = engine_info();
        assert!(info.starts_with("kawaii-core "));
        assert!(info.contains(ENGINE_VERSION));
    }
}

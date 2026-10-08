//! kawaii-core：纯 Rust 核心，零 napi / 零 wasmtime 依赖，可编译到 wasm32。
//!
//! - `cst`：消息 lossless 解析 + 占位符不变量（P1）；
//! - `dsl`：规则 DSL 无损解析与求值（P2）；
//! - `persona`：人设 / 强度（与 TS 对齐）；
//! - `jsonlite`：扁平 opts JSON 解析（零依赖）；
//! - `fastpath`：内置规则表 TSV（与 TS rules.generated 同源）；
//! - `fnhost`：自定义规则函数宿主 trait（native=Wasmtime / wasm=空宿主）；
//! - `patch` / `patch_new`：TS transform/transform-new 忠实移植（P4）；
//! - `engine`：有状态门面（规则热加载 / 人设轮转 / 统计，napi+wasm 镜像）。
#![deny(warnings)]

pub mod cst;
pub mod dsl;
pub mod engine;
pub mod fastpath;
pub mod fnhost;
pub mod jsonlite;
pub mod patch;
pub mod patch_new;
pub mod persona;

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

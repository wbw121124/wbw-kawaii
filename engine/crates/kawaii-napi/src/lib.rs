//! N-API 薄壳：仅做类型转换与状态持有，业务逻辑全部委托 kawaii-core。
#![deny(warnings)]

use napi_derive::napi;

/// P0 骨架自述串；P1 起暴露 transformMessage 等完整 API。
#[napi]
pub fn engine_info() -> String {
    format!("{} (napi)", kawaii_core::engine_info())
}

//! wasm 薄壳：手工 C-ABI（不用 wasm-bindgen，免去 CLI 与 crate 版本配套成本），
//! 浏览器与 Node 共用同一套 glue：指针 + 长度读字符串，P3 补 alloc/free 与完整 API。
#![deny(warnings)]

/// 自述串，供 JS 通过指针/长度读取。
static INFO: &str = concat!("kawaii-wasm ", env!("CARGO_PKG_VERSION"), " (wasm)");

#[no_mangle]
pub extern "C" fn kawaii_engine_info_ptr() -> *const u8 {
    INFO.as_ptr()
}

#[no_mangle]
pub extern "C" fn kawaii_engine_info_len() -> u32 {
    INFO.len() as u32
}

#[cfg(test)]
mod tests {
    #[test]
    fn core_dep_is_linked() {
        assert!(kawaii_core::engine_info().starts_with("kawaii-core"));
    }

    #[test]
    fn info_is_static_utf8() {
        let info = super::INFO;
        assert!(info.starts_with("kawaii-wasm "));
        assert!(info.ends_with("(wasm)"));
    }
}

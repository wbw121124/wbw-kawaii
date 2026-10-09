//! 生成 `engine/test/fixtures/shout.wasm`（JS 冒烟用）。
//!
//! 用法：`cargo run -p kawaii-fn-wasmtime --example gen_fixture -- <输出路径>`

fn main() {
    let out = std::env::args()
        .nth(1)
        .expect("用法: gen_fixture <输出路径>");
    let wat = include_str!("../fixtures/shout.wat");
    let wasm = wat::parse_str(wat).expect("WAT 合法");
    if let Some(parent) = std::path::Path::new(&out).parent() {
        std::fs::create_dir_all(parent).expect("建目录");
    }
    std::fs::write(&out, &wasm).expect("写 wasm");
    println!("wrote {out} ({} bytes)", wasm.len());
}

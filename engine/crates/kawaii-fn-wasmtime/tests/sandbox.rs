//! Wasmtime 沙箱集成测试：用 WAT fixture guest 覆盖 ABI v1 全部路径。

use kawaii_core::fnhost::CustomFnHost;
use kawaii_fn_wasmtime::WasmtimeHost;

fn host_with(wat: &str) -> WasmtimeHost {
    let host = WasmtimeHost::new();
    let wasm = wat::parse_str(wat).expect("WAT 合法");
    host.load_module("g", &wasm).expect("加载成功");
    host
}

#[test]
fn shout_uppercases_ascii() {
    let host = host_with(include_str!("../fixtures/shout.wat"));
    assert_eq!(
        host.call("g", "Hello, Wasm!", "{}"),
        Ok("HELLO, WASM!".to_string())
    );
    // 多字节 UTF-8 原样（只处理 ASCII 小写）
    assert_eq!(
        host.call("g", "café OK", "{}"),
        Ok("CAFé OK".to_string())
    );
    assert_eq!(host.names(), vec!["g".to_string()]);
}

#[test]
fn ctx_json_reaches_guest() {
    let host = host_with(include_str!("../fixtures/echo_ctx.wat"));
    let ctx = r#"{"fn":"echo","args":[],"persona":"soft"}"#;
    assert_eq!(host.call("g", "unused", ctx), Ok(ctx.to_string()));
}

#[test]
fn unknown_function_rejected() {
    let host = WasmtimeHost::new();
    let err = host
        .call("nobody", "x", "{}")
        .expect_err("未注册必须报错");
    assert!(err.contains("nobody"), "{err}");
}

#[test]
fn guest_error_sentinel_rejected() {
    let host = host_with(include_str!("../fixtures/ret_error.wat"));
    let err = host.call("g", "x", "{}").expect_err("-1 必须报错");
    assert!(err.contains("guest 报错"), "{err}");
}

#[test]
fn infinite_loop_hits_fuel_budget() {
    let host = host_with(include_str!("../fixtures/loop_forever.wat"));
    let err = host.call("g", "x", "{}").expect_err("死循环必须被掐");
    assert!(err.contains("燃料"), "{err}");
}

#[test]
fn memory_grow_beyond_limit_rejected() {
    let host = host_with(include_str!("../fixtures/grow_bomb.wat"));
    // 内存上限挡住 grow → guest 返回 -1
    let err = host.call("g", "x", "{}").expect_err("越限 grow 必须失败");
    assert!(err.contains("guest 报错"), "{err}");
}

#[test]
fn alloc_failure_rejected() {
    let host = host_with(include_str!("../fixtures/alloc_zero.wat"));
    let err = host.call("g", "x", "{}").expect_err("alloc=0 必须失败");
    assert!(err.contains("分配"), "{err}");
}

#[test]
fn invalid_utf8_output_rejected() {
    let host = host_with(include_str!("../fixtures/bad_utf8.wat"));
    let err = host.call("g", "x", "{}").expect_err("非法 UTF-8 必须失败");
    assert!(err.contains("UTF-8"), "{err}");
}

#[test]
fn import_rejected_at_load_time() {
    let host = WasmtimeHost::new();
    let wasm = wat::parse_str(include_str!("../fixtures/has_import.wat")).expect("WAT 合法");
    let err = host.load_module("bad", &wasm).expect_err("带 import 必须被拒");
    assert!(err.contains("import"), "{err}");
    assert!(host.names().is_empty(), "拒绝的模块不得进入注册表");
}

#[test]
fn missing_exports_rejected_at_load_time() {
    let host = WasmtimeHost::new();
    // 只有 memory，没有 alloc/transform
    let wasm = wat::parse_str(r#"(module (memory (export "memory") 1))"#).expect("WAT 合法");
    let err = host.load_module("bad", &wasm).expect_err("缺导出必须被拒");
    assert!(err.contains("transform"), "{err}");

    // 坏字节
    let err = host
        .load_module("junk", &[0u8, 1, 2, 3])
        .expect_err("非 wasm 必须被拒");
    assert!(err.contains("编译失败"), "{err}");
}

#[test]
fn load_dir_registers_wasm_files() {
    let dir = std::env::temp_dir().join(format!("kawaii-fn-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("建临时目录");
    let shout = wat::parse_str(include_str!("../fixtures/shout.wat")).expect("WAT 合法");
    std::fs::write(dir.join("shout.wasm"), &shout).expect("写 wasm");
    std::fs::write(dir.join("notes.txt"), "忽略我").expect("写杂项");

    let host = WasmtimeHost::new();
    let names = host.load_dir(&dir).expect("加载目录");
    assert_eq!(names, vec!["shout".to_string()], "只收 .wasm");
    assert_eq!(
        host.call("shout", "hi", "{}"),
        Ok("HI".to_string()),
        "按文件名 stem 注册即可调用"
    );

    // 非目录
    let err = host
        .load_dir(&dir.join("shout.wasm"))
        .expect_err("文件当目录必须报错");
    assert!(err.contains("不是目录"), "{err}");

    // 覆盖同名
    std::fs::write(dir.join("shout.wasm"), &shout).expect("重写");
    host.load_dir(&dir).expect("二次加载");

    let _ = std::fs::remove_dir_all(&dir);
}

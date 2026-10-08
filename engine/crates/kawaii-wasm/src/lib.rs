//! wasm 壳：手写 C-ABI（不用 wasm-bindgen，避开 CLI 与 crate 版本配套成本）。
//!
//! 协议：
//! - 输入字符串：JS 侧 `kawaii_alloc` → 写入内存 → 传 `(ptr, len)` → 用完 `kawaii_free`；
//! - 输出：调用返回 `i32` 状态（0 成功，非 0 失败），结果字节在**结果槽**
//!   （`kawaii_result_ptr/len`，下次调用覆盖），JS 复制后可 `kawaii_result_free`；
//! - 失败时结果槽放错误文本。
#![deny(warnings)]

use std::cell::RefCell;

use kawaii_core::engine::{Engine, EngineOpts};

thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::new());
    static RESULT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
}

fn set_result(bytes: Vec<u8>) -> i32 {
    RESULT.with(|r| *r.borrow_mut() = bytes);
    0
}

fn set_err(msg: impl AsRef<str>) -> i32 {
    RESULT.with(|r| {
        let mut r = r.borrow_mut();
        r.clear(); // 先清掉上一次调用的残留
        r.extend_from_slice(msg.as_ref().as_bytes());
    });
    1
}

/// # Safety
/// 调用方保证 `(ptr, len)` 来自 `kawaii_alloc` 且未释放。
unsafe fn read_bytes<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len as usize)
    }
}

/// 解析可选 opts（len==0 或空白 → None）。
unsafe fn parse_opts(
    ptr: *const u8,
    len: u32,
) -> Result<Option<EngineOpts>, String> {
    if len == 0 {
        return Ok(None);
    }
    let raw = read_bytes(ptr, len);
    let s = std::str::from_utf8(raw).map_err(|e| format!("opts 不是合法 UTF-8: {e}"))?;
    if s.trim().is_empty() {
        return Ok(None);
    }
    EngineOpts::from_json(s).map(Some)
}

unsafe fn read_str(ptr: *const u8, len: u32) -> Result<&'static str, String> {
    std::str::from_utf8(read_bytes(ptr, len)).map_err(|e| format!("输入不是合法 UTF-8: {e}"))
}

// ── 内存管理 ────────────────────────────────────────────────

/// JS 侧申请输入缓冲（Box 精确长度，free 时按 len 还原）。
#[no_mangle]
pub extern "C" fn kawaii_alloc(len: u32) -> *mut u8 {
    let boxed = vec![0u8; len as usize].into_boxed_slice();
    Box::into_raw(boxed) as *mut u8
}

/// # Safety
/// `(ptr, len)` 必须来自配对的 `kawaii_alloc(len)`。
#[no_mangle]
pub unsafe extern "C" fn kawaii_free(ptr: *mut u8, len: u32) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr,
            len as usize,
        )));
    }
}

/// 结果槽起始地址（JS 立即复制；下次调用会覆盖/释放）。
#[no_mangle]
pub extern "C" fn kawaii_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn kawaii_result_len() -> u32 {
    RESULT.with(|r| r.borrow().len() as u32)
}

/// 主动清空结果槽（可选，JS 复制后调用省显存）。
#[no_mangle]
pub extern "C" fn kawaii_result_free() {
    RESULT.with(|r| r.borrow_mut().clear());
}

/// P0 自述串（smoke 用，静态无需结果槽）。
static INFO: &str = concat!("kawaii-wasm ", env!("CARGO_PKG_VERSION"), " (wasm)");

#[no_mangle]
pub extern "C" fn kawaii_engine_info_ptr() -> *const u8 {
    INFO.as_ptr()
}

#[no_mangle]
pub extern "C" fn kawaii_engine_info_len() -> u32 {
    INFO.len() as u32
}

// ── 转换 API（与 napi 壳镜像） ─────────────────────────────

#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_message(
    msg_ptr: *const u8,
    msg_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let msg = match read_str(msg_ptr, msg_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let out = ENGINE.with(|e| e.borrow().transform_message(msg, opts.as_ref()));
    set_result(out.into_bytes())
}

#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_markdownlint(
    msg_ptr: *const u8,
    msg_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
    code_ptr: *const u8,
    code_len: u32,
) -> i32 {
    let msg = match read_str(msg_ptr, msg_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let code = match read_optional_str(code_ptr, code_len) {
        Ok(c) => c,
        Err(e) => return set_err(e),
    };
    let out = ENGINE.with(|e| e.borrow().transform_markdownlint(msg, opts.as_ref(), code));
    set_result(out.into_bytes())
}

#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_pylint(
    msg_ptr: *const u8,
    msg_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
    code_ptr: *const u8,
    code_len: u32,
) -> i32 {
    let msg = match read_str(msg_ptr, msg_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let code = match read_optional_str(code_ptr, code_len) {
        Ok(c) => c,
        Err(e) => return set_err(e),
    };
    let out = ENGINE.with(|e| e.borrow().transform_pylint(msg, opts.as_ref(), code));
    set_result(out.into_bytes())
}

#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_whimper(
    input_ptr: *const u8,
    input_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let input = match read_str(input_ptr, input_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let out = ENGINE.with(|e| e.borrow().transform_whimper(input, opts.as_ref()));
    set_result(out.into_bytes())
}

unsafe fn read_optional_str(
    ptr: *const u8,
    len: u32,
) -> Result<Option<&'static str>, String> {
    if len == 0 || ptr.is_null() {
        return Ok(None);
    }
    // 'static 绑定只是为了让生命周期穿过本函数栈（结果随即拷贝使用）。
    let s = std::str::from_utf8(read_bytes(ptr, len)).map_err(|e| format!("code 非法 UTF-8: {e}"))?;
    Ok(Some(s))
}

// ── 状态 API ────────────────────────────────────────────────

/// 规则热加载：`builtin` / 原始 DSL 文本（`file:` 需调用方先取文本）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_load_rules(
    source_ptr: *const u8,
    source_len: u32,
) -> i32 {
    let source = match read_str(source_ptr, source_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    if source == "builtin" {
        return ENGINE.with(|e| set_result(e.borrow_mut().load_builtin().into_bytes()));
    }
    if source.starts_with("file:") {
        return set_err("wasm 端不支持 file:，请先读取文本再调用 loadRulesText");
    }
    ENGINE.with(|e| match e.borrow_mut().load_rules_text(source) {
        Ok(v) => set_result(v.into_bytes()),
        Err(r) => set_err(r.message),
    })
}

#[no_mangle]
pub unsafe extern "C" fn kawaii_load_rules_text(text_ptr: *const u8, text_len: u32) -> i32 {
    let text = match read_str(text_ptr, text_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    ENGINE.with(|e| match e.borrow_mut().load_rules_text(text) {
        Ok(v) => set_result(v.into_bytes()),
        Err(r) => set_err(r.message),
    })
}

#[no_mangle]
pub extern "C" fn kawaii_load_builtin() -> i32 {
    ENGINE.with(|e| set_result(e.borrow_mut().load_builtin().into_bytes()))
}

#[no_mangle]
pub extern "C" fn kawaii_cycle_persona() -> i32 {
    ENGINE.with(|e| {
        let style = e.borrow_mut().cycle_persona();
        set_result(style.as_str().as_bytes().to_vec())
    })
}

#[no_mangle]
pub extern "C" fn kawaii_get_stats() -> i32 {
    ENGINE.with(|e| {
        let s = e.borrow().stats();
        // 字段全部 ASCII（persona 名 / 版本哈希），无需转义。
        let json = format!(
            r#"{{"path":"wasm","rulesVersion":"{}","persona":"{}","ruleCount":{}}}"#,
            s.rules_version, s.persona, s.rule_count
        );
        set_result(json.into_bytes())
    })
}

// ── P4 patch 级 API（与 napi 壳镜像；对象结果走 JSON 结果槽） ──

use kawaii_core::dsl::EvalOptions;
use kawaii_core::patch as core_patch;
use kawaii_core::patch_new as core_new;
use std::collections::HashMap;

type RuleTable = HashMap<String, Vec<String>>;

/// opts JSON → 求值选项（空/None → soft/normal/decorate=true 默认）。
fn opts_eval(opts: Option<EngineOpts>) -> EvalOptions {
    opts.unwrap_or_default().to_eval()
}

/// 规则表 JSON（`""` / `"null"` → 空表或 None）。
unsafe fn parse_rules(
    ptr: *const u8,
    len: u32,
) -> Result<RuleTable, String> {
    if len == 0 {
        return Ok(RuleTable::new());
    }
    let s = read_str(ptr, len)?;
    serde_json::from_str(s).map_err(|e| format!("rules 不是合法 JSON: {e}"))
}

unsafe fn parse_optional_rules(
    ptr: *const u8,
    len: u32,
) -> Result<Option<RuleTable>, String> {
    if len == 0 {
        return Ok(None);
    }
    let s = read_str(ptr, len)?;
    if s.trim().is_empty() || s.trim() == "null" {
        return Ok(None);
    }
    serde_json::from_str(s).map_err(|e| format!("rules 不是合法 JSON: {e}"))
}

fn json_result<T: serde::Serialize>(v: &T) -> i32 {
    match serde_json::to_string(v) {
        Ok(s) => set_result(s.into_bytes()),
        Err(e) => set_err(format!("序列化失败: {e}")),
    }
}

/// 占位符切分（TS `tokenize`；结果槽 = JSON 字符串数组）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_tokenize(s_ptr: *const u8, s_len: u32) -> i32 {
    let s = match read_str(s_ptr, s_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    json_result(&core_patch::tokenize(s))
}

/// 单条目转换（TS `transformValue`；结果槽 = `{value,kind}`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_value(
    value_ptr: *const u8,
    value_len: u32,
    _index: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let value = match read_str(value_ptr, value_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_patch::transform_value(value, &opts_eval(opts)))
}

/// 整段内容改写（TS `patchContent`；结果槽 = `{content,stats,changed}`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_patch_content(
    content_ptr: *const u8,
    content_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let content = match read_str(content_ptr, content_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_patch::patch_content(content, &opts_eval(opts)))
}

/// 统计文案（TS `formatStats`；stats JSON 入参）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_format_stats(
    stats_ptr: *const u8,
    stats_len: u32,
) -> i32 {
    let s = match read_str(stats_ptr, stats_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    match serde_json::from_str::<core_patch::PatchStats>(s) {
        Ok(stats) => set_result(core_patch::format_stats(&stats).into_bytes()),
        Err(e) => set_err(format!("stats 不是合法 JSON: {e}")),
    }
}

/// TS diag 表补丁（TS `patchTsDiag`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_patch_ts_diag(
    content_ptr: *const u8,
    content_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let content = match read_str(content_ptr, content_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_new::patch_ts_diag(content, &rules, &opts_eval(opts)))
}

/// zh JSON 行补丁（TS `patchJsonObject`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_patch_json_object(
    content_ptr: *const u8,
    content_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let content = match read_str(content_ptr, content_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_new::patch_json_object(content, &rules, &opts_eval(opts)))
}

/// 语言包 bundle 补丁（TS `patchPackBundle`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_patch_pack_bundle(
    content_ptr: *const u8,
    content_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let content = match read_str(content_ptr, content_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_new::patch_pack_bundle(content, &rules, &opts_eval(opts)))
}

/// bundle 模板串补丁（TS `patchBundleTemplate`；rules 可为 null/缺省）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_patch_bundle_template(
    content_ptr: *const u8,
    content_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
) -> i32 {
    let content = match read_str(content_ptr, content_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_optional_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    json_result(&core_new::patch_bundle_template(
        content,
        rules.as_ref(),
        &opts_eval(opts),
    ))
}

/// MarkdownLint + 指定规则表（TS `transformMarkdownlint`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_markdownlint_rules(
    msg_ptr: *const u8,
    msg_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
    code_ptr: *const u8,
    code_len: u32,
) -> i32 {
    let msg = match read_str(msg_ptr, msg_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let code = match read_optional_str(code_ptr, code_len) {
        Ok(c) => c,
        Err(e) => return set_err(e),
    };
    let out = core_new::transform_markdownlint(msg, &rules, &opts_eval(opts), code);
    set_result(out.into_bytes())
}

/// PyLint + 指定规则表（TS `transformPylint`）。
#[no_mangle]
pub unsafe extern "C" fn kawaii_transform_pylint_rules(
    msg_ptr: *const u8,
    msg_len: u32,
    rules_ptr: *const u8,
    rules_len: u32,
    opts_ptr: *const u8,
    opts_len: u32,
    code_ptr: *const u8,
    code_len: u32,
) -> i32 {
    let msg = match read_str(msg_ptr, msg_len) {
        Ok(s) => s,
        Err(e) => return set_err(e),
    };
    let rules = match parse_rules(rules_ptr, rules_len) {
        Ok(r) => r,
        Err(e) => return set_err(e),
    };
    let opts = match parse_opts(opts_ptr, opts_len) {
        Ok(o) => o,
        Err(e) => return set_err(e),
    };
    let code = match read_optional_str(code_ptr, code_len) {
        Ok(c) => c,
        Err(e) => return set_err(e),
    };
    let out = core_new::transform_pylint(msg, &rules, &opts_eval(opts), code);
    set_result(out.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(f: impl FnOnce() -> i32) -> (i32, String) {
        let status = f();
        let out = RESULT.with(|r| String::from_utf8_lossy(&r.borrow()).to_string());
        (status, out)
    }

    #[test]
    fn info_is_static_utf8() {
        assert!(INFO.starts_with("kawaii-wasm "));
        assert!(INFO.ends_with("(wasm)"));
    }

    #[test]
    fn abi_transform_message() {
        let msg = "are you ok?";
        let (status, out) = run(|| unsafe {
            kawaii_transform_message(msg.as_ptr(), msg.len() as u32, std::ptr::null(), 0)
        });
        assert_eq!(status, 0);
        assert_eq!(out, "are you ok? ~");

        // opts JSON 生效
        let opts = r#"{"personaStyle":"tsundere"}"#;
        let (status, out) = run(|| unsafe {
            kawaii_transform_message(
                msg.as_ptr(),
                msg.len() as u32,
                opts.as_ptr(),
                opts.len() as u32,
            )
        });
        assert_eq!(status, 0);
        assert_eq!(out, "are you ok? 哼~");

        // 坏 opts → 报错
        let (status, out) = run(|| unsafe {
            kawaii_transform_message(
                msg.as_ptr(),
                msg.len() as u32,
                b"not json".as_ptr(),
                8,
            )
        });
        assert_eq!(status, 1);
        assert!(!out.is_empty(), "错误文本入结果槽");
    }

    #[test]
    fn abi_markdownlint_and_pylint() {
        let msg = "MD013: Line too long [121 > 80]";
        let (status, out) = run(|| unsafe {
            kawaii_transform_markdownlint(
                msg.as_ptr(),
                msg.len() as u32,
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
            )
        });
        assert_eq!(status, 0);
        assert_eq!(out, "MD013: Line too long [121 > 80] ~");

        let msg = "Missing module docstring";
        let (status, out) = run(|| unsafe {
            kawaii_transform_pylint(
                msg.as_ptr(),
                msg.len() as u32,
                std::ptr::null(),
                0,
                std::ptr::null(),
                0,
            )
        });
        assert_eq!(status, 0);
        assert_eq!(out, "Missing module docstring ~");
    }

    #[test]
    fn abi_whimper_and_stats() {
        let input = "我太菜了";
        let (status, out) = run(|| unsafe {
            kawaii_transform_whimper(input.as_ptr(), input.len() as u32, std::ptr::null(), 0)
        });
        assert_eq!(status, 0);
        assert!(!out.is_empty());

        let (status, out) = run(|| kawaii_get_stats());
        assert_eq!(status, 0);
        assert!(out.contains(r#""path":"wasm""#), "{}", out);
        assert!(out.contains(r#""ruleCount":4"#), "{}", out);
    }

    #[test]
    fn abi_load_rules_cycle_and_alloc() {
        // 自定义规则文本
        let text = r#"rule "t" { rewrite { prepend_text("嗨"); } }"#;
        let (status, out) = run(|| unsafe { kawaii_load_rules_text(text.as_ptr(), text.len() as u32) });
        assert_eq!(status, 0);
        assert!(out.starts_with("dsl:"), "{}", out);

        let msg = "你好";
        let (status, out) = run(|| unsafe {
            kawaii_transform_message(msg.as_ptr(), msg.len() as u32, std::ptr::null(), 0)
        });
        assert_eq!(status, 0);
        assert_eq!(out, "嗨你好");

        // 坏规则报错
        let bad = "rule {";
        let (status, out) = run(|| unsafe { kawaii_load_rules_text(bad.as_ptr(), bad.len() as u32) });
        assert_eq!(status, 1);
        assert!(!out.is_empty());

        // 回内置 + file: 拒绝
        let (status, _) = run(|| kawaii_load_builtin());
        assert_eq!(status, 0);
        let src = "file:/x.kawaii";
        let (status, out) = run(|| unsafe {
            kawaii_load_rules(src.as_ptr(), src.len() as u32)
        });
        assert_eq!(status, 1);
        assert!(out.contains("file:"), "{}", out);

        // 人设轮转
        let (status, out) = run(|| kawaii_cycle_persona());
        assert_eq!(status, 0);
        assert_eq!(out, "tsundere");

        // alloc/free 往返
        let ptr = kawaii_alloc(4);
        assert!(!ptr.is_null());
        unsafe {
            std::ptr::copy_nonoverlapping(b"abcd".as_ptr(), ptr, 4);
            assert_eq!(std::slice::from_raw_parts(ptr, 4), b"abcd");
            kawaii_free(ptr, 4);
        }
    }
}

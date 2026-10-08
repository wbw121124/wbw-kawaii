//! N-API 壳：薄转换 + 静态状态，业务逻辑全在 kawaii-core（与 wasm 壳镜像）。
#![deny(warnings)]

use std::sync::{Mutex, MutexGuard, OnceLock};

use kawaii_core::engine::{Engine, EngineOpts, Stats};
use napi_derive::napi;

/// 全进程唯一引擎状态（JS 单线程调用；锁中毒时继续用现有状态）。
fn engine_mutex() -> &'static Mutex<Engine> {
    static ENGINE: OnceLock<Mutex<Engine>> = OnceLock::new();
    ENGINE.get_or_init(|| Mutex::new(Engine::new()))
}

fn with_engine<F, T>(f: F) -> T
where
    F: FnOnce(&mut Engine) -> T,
{
    let mut guard: MutexGuard<'_, Engine> =
        engine_mutex().lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard)
}

fn read_engine<F, T>(f: F) -> T
where
    F: FnOnce(&Engine) -> T,
{
    let guard: MutexGuard<'_, Engine> = engine_mutex().lock().unwrap_or_else(|e| e.into_inner());
    f(&guard)
}

/// JS 侧可选参数（camelCase 字段）。
#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct EngineOptsJs {
    pub persona_style: Option<String>,
    pub intensity: Option<String>,
    pub custom_fallback: Option<String>,
    pub decorate_fallback: Option<bool>,
}

impl EngineOptsJs {
    fn to_core(&self) -> EngineOpts {
        EngineOpts {
            persona_style: self.persona_style.clone(),
            intensity: self.intensity.clone(),
            custom_fallback: self.custom_fallback.clone(),
            decorate_fallback: self.decorate_fallback,
        }
    }
}

/// 统计对象（path 固定 native，wasm 壳镜像为 wasm）。
#[napi(object)]
pub struct StatsJs {
    pub path: String,
    pub rules_version: String,
    pub persona: String,
    pub rule_count: u32,
}

fn to_js_opts(opts: Option<EngineOptsJs>) -> Option<EngineOpts> {
    opts.map(|o| o.to_core())
}

fn stats_js(s: Stats) -> StatsJs {
    StatsJs {
        path: "native".to_string(),
        rules_version: s.rules_version,
        persona: s.persona,
        rule_count: s.rule_count as u32,
    }
}

/// P0 骨架自述串（smoke 用）。
#[napi]
pub fn engine_info() -> String {
    format!("{} (napi)", kawaii_core::engine_info())
}

/// 消息主入口。
#[napi]
pub fn transform_message(msg: String, opts: Option<EngineOptsJs>) -> String {
    let o = to_js_opts(opts);
    read_engine(|e| e.transform_message(&msg, o.as_ref()))
}

/// MarkdownLint 消息（结构化兜底保留前缀/详情）。
#[napi]
pub fn transform_markdownlint(
    msg: String,
    opts: Option<EngineOptsJs>,
    code: Option<String>,
) -> String {
    let o = to_js_opts(opts);
    read_engine(|e| e.transform_markdownlint(&msg, o.as_ref(), code.as_deref()))
}

/// PyLint 消息（结构化兜底保留规则码前缀）。
#[napi]
pub fn transform_pylint(msg: String, opts: Option<EngineOptsJs>, code: Option<String>) -> String {
    let o = to_js_opts(opts);
    read_engine(|e| e.transform_pylint(&msg, o.as_ref(), code.as_deref()))
}

/// 颤音彩蛋：命中关键词返回彩蛋文案，否则空串。
#[napi]
pub fn transform_whimper(input: String, opts: Option<EngineOptsJs>) -> String {
    let o = to_js_opts(opts);
    read_engine(|e| e.transform_whimper(&input, o.as_ref()))
}

/// 规则热加载：`builtin` / `file:<路径>` / 原始 DSL 文本，返回新规则版本。
#[napi]
pub fn load_rules(source: String) -> Result<String, napi::Error> {
    let err = |m: String| napi::Error::from_reason(m);
    if source == "builtin" {
        return Ok(with_engine(|e| e.load_builtin()));
    }
    if let Some(path) = source.strip_prefix("file:") {
        let text = std::fs::read_to_string(path)
            .map_err(|e| err(format!("读取规则文件 {path} 失败: {e}")))?;
        return with_engine(|e| e.load_rules_text(&text).map_err(|r| err(r.message)));
    }
    with_engine(|e| e.load_rules_text(&source).map_err(|r| err(r.message)))
}

/// 直接加载规则 DSL 文本（浏览器端 file: 由调用方先取文本）。
#[napi]
pub fn load_rules_text(text: String) -> Result<String, napi::Error> {
    with_engine(|e| {
        e.load_rules_text(&text)
            .map_err(|r| napi::Error::from_reason(r.message))
    })
}

/// 人设轮转：soft → tsundere → derriere → cool → soft，返回新风格。
#[napi]
pub fn cycle_persona() -> String {
    with_engine(|e| e.cycle_persona().as_str().to_string())
}

/// 引擎统计（含规则版本与规则数）。
#[napi]
pub fn get_stats() -> StatsJs {
    read_engine(|e| stats_js(e.stats()))
}

//! N-API 壳：薄转换 + 静态状态，业务逻辑全在 kawaii-core（与 wasm 壳镜像）。
#![deny(warnings)]

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

use kawaii_core::engine::{Engine, EngineOpts, Stats};
use kawaii_core::patch as core_patch;
use kawaii_core::patch_new as core_new;
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

// ── P4 patch 级 API（与 TS transform/transform-new 一一对应） ──

/// 单条目结果（TS `EntryResult`；null 条目 value 为 null）。
#[napi(object)]
pub struct EntryResultJs {
    pub value: Option<String>,
    pub kind: String,
}

/// patchContent 统计（8 字段，字段名与 TS 一致）。
#[napi(object)]
pub struct PatchStatsJs {
    pub total: u32,
    pub nulls: u32,
    pub hits: u32,
    pub decorated: u32,
    pub identity: u32,
    pub kept: u32,
    pub already: u32,
    pub changed: u32,
}

impl From<core_patch::PatchStats> for PatchStatsJs {
    fn from(s: core_patch::PatchStats) -> Self {
        PatchStatsJs {
            total: s.total,
            nulls: s.nulls,
            hits: s.hits,
            decorated: s.decorated,
            identity: s.identity,
            kept: s.kept,
            already: s.already,
            changed: s.changed,
        }
    }
}

impl From<PatchStatsJs> for core_patch::PatchStats {
    fn from(s: PatchStatsJs) -> Self {
        core_patch::PatchStats {
            total: s.total,
            nulls: s.nulls,
            hits: s.hits,
            decorated: s.decorated,
            identity: s.identity,
            kept: s.kept,
            already: s.already,
            changed: s.changed,
        }
    }
}

/// patchContent 结果。
#[napi(object)]
pub struct PatchResultJs {
    pub content: String,
    pub stats: PatchStatsJs,
    pub changed: bool,
}

/// transform-new 系列统计（与 TS `{hits, decorated}` 一致）。
#[napi(object)]
pub struct NewPatchStatsJs {
    pub hits: u32,
    pub decorated: u32,
}

/// transform-new 系列结果（与 TS `{content, stats, changed}` 一致）。
#[napi(object)]
pub struct NewPatchResultJs {
    pub content: String,
    pub stats: NewPatchStatsJs,
    pub changed: bool,
}

impl From<core_new::NewPatchResult> for NewPatchResultJs {
    fn from(r: core_new::NewPatchResult) -> Self {
        NewPatchResultJs {
            content: r.content,
            stats: NewPatchStatsJs {
                hits: r.stats.hits,
                decorated: r.stats.decorated,
            },
            changed: r.changed,
        }
    }
}

type RuleTable = HashMap<String, Vec<String>>;

fn eval_from_js(opts: Option<EngineOptsJs>) -> kawaii_core::dsl::EvalOptions {
    opts.map(|o| o.to_core()).unwrap_or_default().to_eval()
}

/// 占位符切分（TS `tokenize`）。
#[napi]
pub fn tokenize(s: String) -> Vec<String> {
    core_patch::tokenize(&s)
}

/// 单条目转换（TS `transformValue(value, index, opts)`；index 仅兼容签名，不参与选变体）。
#[napi]
pub fn transform_value(value: String, index: u32, opts: Option<EngineOptsJs>) -> EntryResultJs {
    let _ = index;
    let r = core_patch::transform_value(&value, &eval_from_js(opts));
    EntryResultJs {
        value: r.value,
        kind: r.kind.as_str().to_string(),
    }
}

/// 整段内容改写（TS `patchContent`）。
#[napi]
pub fn patch_content(content: String, opts: Option<EngineOptsJs>) -> PatchResultJs {
    let r = core_patch::patch_content(&content, &eval_from_js(opts));
    PatchResultJs {
        content: r.content,
        stats: r.stats.into(),
        changed: r.changed,
    }
}

/// 统计文案（TS `formatStats`）。
#[napi]
pub fn format_stats(stats: PatchStatsJs) -> String {
    core_patch::format_stats(&stats.into())
}

/// TS diag 表补丁（TS `patchTsDiag`，含原样保留的命中重建分支）。
#[napi]
pub fn patch_ts_diag(
    content: String,
    rules: RuleTable,
    opts: Option<EngineOptsJs>,
) -> NewPatchResultJs {
    core_new::patch_ts_diag(&content, &rules, &eval_from_js(opts)).into()
}

/// zh JSON 行补丁（TS `patchJsonObject`）。
#[napi]
pub fn patch_json_object(
    content: String,
    rules: RuleTable,
    opts: Option<EngineOptsJs>,
) -> NewPatchResultJs {
    core_new::patch_json_object(&content, &rules, &eval_from_js(opts)).into()
}

/// 语言包 bundle 补丁（TS `patchPackBundle`；解析失败回落 patchJsonObject）。
#[napi]
pub fn patch_pack_bundle(
    content: String,
    rules: RuleTable,
    opts: Option<EngineOptsJs>,
) -> NewPatchResultJs {
    core_new::patch_pack_bundle(&content, &rules, &eval_from_js(opts)).into()
}

/// bundle 模板串补丁（TS `patchBundleTemplate`；rules 参数 TS 内未使用，此处仅兼容签名）。
#[napi]
pub fn patch_bundle_template(
    content: String,
    rules: Option<RuleTable>,
    opts: Option<EngineOptsJs>,
) -> NewPatchResultJs {
    core_new::patch_bundle_template(&content, rules.as_ref(), &eval_from_js(opts)).into()
}

/// MarkdownLint 消息 + 指定规则表（TS `transformMarkdownlint`；data 表恒从 JS 传入）。
#[napi]
pub fn transform_markdownlint_with_rules(
    msg: String,
    rules: RuleTable,
    opts: Option<EngineOptsJs>,
    code: Option<String>,
) -> String {
    core_new::transform_markdownlint(&msg, &rules, &eval_from_js(opts), code.as_deref())
}

/// PyLint 消息 + 指定规则表（TS `transformPylint`）。
#[napi]
pub fn transform_pylint_with_rules(
    msg: String,
    rules: RuleTable,
    opts: Option<EngineOptsJs>,
    code: Option<String>,
) -> String {
    core_new::transform_pylint(&msg, &rules, &eval_from_js(opts), code.as_deref())
}

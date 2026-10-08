//! 规则求值：按 priority 降序逐条应用，每条改写后做占位符不变量校验。

use super::ast::{CtxVal, CmpOp, Matcher, RewriteOp, RuleAst, RuleSet};
use crate::cst::{self, ParsedMessage};
use crate::fnhost::{CustomFnHost, NoFnHost};
use crate::persona::{
    get_fallback_suffix, should_skip_decorate, KawaiiIntensity, PersonaStyle,
};

/// 求值选项（对齐 TS `KawaiiOptions`）。
#[derive(Debug, Clone)]
pub struct EvalOptions {
    pub persona: PersonaStyle,
    pub intensity: KawaiiIntensity,
    /// 自定义兜底后缀（覆盖人设后缀）
    pub custom_fallback: Option<String>,
    /// 是否允许兜底装饰（TS `decorateFallback`，默认开）
    pub decorate_fallback: bool,
}

impl Default for EvalOptions {
    fn default() -> Self {
        Self {
            persona: PersonaStyle::Soft,
            intensity: KawaiiIntensity::Normal,
            custom_fallback: None,
            decorate_fallback: true,
        }
    }
}

/// 单次转换结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransformOutcome {
    pub output: String,
    /// 成功应用的规则名（按应用顺序）
    pub applied: Vec<String>,
    /// 被拒绝的规则名（占位符不变量违规，或自定义函数调用失败——整条规则回滚）
    pub rejected: Vec<String>,
    /// 是否走了人设兜底
    pub fell_back: bool,
}

/// 把 `original` 过一遍 `rules`（无自定义函数宿主）。
pub fn transform(original: &str, rules: &RuleSet, opts: &EvalOptions) -> TransformOutcome {
    transform_with_host(original, rules, opts, &NoFnHost)
}

/// 把 `original` 过一遍 `rules`，`call(...)` 操作交给 `host` 执行。
///
/// - 每条 match 命中的规则依次改写当前结果；
/// - 每条改写后用原文 vs 候选做占位符校验，违规则**拒绝该规则**（候选回滚）；
/// - `call` 报错（未注册 / 沙箱超限 / guest 报错）同样**整条规则回滚**并记入 `rejected`；
/// - 无任何规则命中且兜底开启时追加人设后缀（跳过条件对齐 TS）。
pub fn transform_with_host(
    original: &str,
    rules: &RuleSet,
    opts: &EvalOptions,
    host: &dyn CustomFnHost,
) -> TransformOutcome {
    let parsed = cst::parse(original);
    let mut order: Vec<&RuleAst> = rules.rules.iter().collect();
    order.sort_by(|a, b| b.priority.cmp(&a.priority)); // 稳定排序：同优先级保持声明序

    let mut out = original.to_string();
    let mut applied: Vec<String> = Vec::new();
    let mut rejected: Vec<String> = Vec::new();

    for rule in order {
        if !rule.matchers.is_empty() && !rule
            .matchers
            .iter()
            .all(|m| eval_match(m, &parsed, original))
        {
            // 空 matchers 视为无条件规则；非空则全部满足（顶层已是折叠后的单条）
            continue;
        }
        let mut cand = out.clone();
        let mut failed = false;
        for op in &rule.rewrites {
            if let Err(_e) = apply_op(&mut cand, op, opts, host) {
                failed = true;
                break;
            }
        }
        if failed {
            rejected.push(rule.name.clone());
            continue;
        }
        if cand == out {
            continue; // 空改写不记账
        }
        if cst::placeholders_unchanged(original, &cand) {
            out = cand;
            applied.push(rule.name.clone());
        } else {
            rejected.push(rule.name.clone());
        }
    }

    let mut fell_back = false;
    if applied.is_empty() && opts.decorate_fallback {
        let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
        if !suffix.is_empty()
            && !should_skip_decorate(original, opts.intensity)
            && !original.ends_with(&suffix)
        {
            // 对齐 TS transformValue：尾部空白修剪后再挂后缀
            let cand = format!("{}{}", out.trim_end(), suffix);
            if cst::placeholders_unchanged(original, &cand) {
                out = cand;
                fell_back = true;
            }
        }
    }

    TransformOutcome {
        output: out,
        applied,
        rejected,
        fell_back,
    }
}

fn eval_match(m: &Matcher, parsed: &ParsedMessage, text: &str) -> bool {
    match m {
        Matcher::TextContains(s) => text.contains(s.as_str()),
        Matcher::ClauseEndsWith(s) => parsed
            .clause_texts()
            .last()
            .map(|c| c.trim_end().ends_with(s.as_str()))
            .unwrap_or(false),
        Matcher::PlaceholderCount(op, n) => {
            let cnt = parsed.placeholder_signature().len() as u32;
            match op {
                CmpOp::Eq => cnt == *n,
                CmpOp::Ne => cnt != *n,
                CmpOp::Gt => cnt > *n,
                CmpOp::Ge => cnt >= *n,
                CmpOp::Lt => cnt < *n,
                CmpOp::Le => cnt <= *n,
            }
        }
        Matcher::HasCodePrefix => parsed.has_code_prefix(),
        Matcher::HasPlaceholder => !parsed.placeholder_signature().is_empty(),
        Matcher::Not(inner) => !eval_match(inner, parsed, text),
        Matcher::All(v) => v.iter().all(|x| eval_match(x, parsed, text)),
        Matcher::Any(v) => v.iter().any(|x| eval_match(x, parsed, text)),
        Matcher::Const(b) => *b,
    }
}

fn apply_op(
    cand: &mut String,
    op: &RewriteOp,
    opts: &EvalOptions,
    host: &dyn CustomFnHost,
) -> Result<(), String> {
    match op {
        RewriteOp::ReplaceText { from, to } => {
            if !from.is_empty() {
                *cand = cand.replace(from.as_str(), to.as_str());
            }
        }
        RewriteOp::AppendText(s) => cand.push_str(s),
        RewriteOp::PrependText(s) => {
            let mut next = String::with_capacity(cand.len() + s.len());
            next.push_str(s);
            next.push_str(cand);
            *cand = next;
        }
        RewriteOp::AppendPersona => {
            let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
            if !suffix.is_empty() && !cand.ends_with(&suffix) {
                cand.push_str(&suffix);
            }
        }
        RewriteOp::Call { name, args, ctx } => {
            let ctx_json = build_ctx_json(name, args, ctx, opts);
            let out = host.call(name, cand, &ctx_json)?;
            *cand = out;
        }
    }
    Ok(())
}

/// `call` 上下文 → JSON：`{"fn": 名, "args": [...], ...对象键值}`。
/// `persona` / `intensity` 引用求值期解析成字符串。
fn build_ctx_json(
    name: &str,
    args: &[String],
    ctx: &[(String, CtxVal)],
    opts: &EvalOptions,
) -> String {
    let mut map = serde_json::Map::with_capacity(2 + ctx.len());
    map.insert("fn".into(), serde_json::Value::String(name.to_string()));
    map.insert(
        "args".into(),
        serde_json::Value::Array(
            args.iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
        ),
    );
    for (k, v) in ctx {
        let val = match v {
            CtxVal::Str(s) => serde_json::Value::String(s.clone()),
            CtxVal::Num(n) => {
                let num = n
                    .parse::<i64>()
                    .map(serde_json::Number::from)
                    .ok()
                    .or_else(|| n.parse::<f64>().ok().and_then(serde_json::Number::from_f64))
                    .unwrap_or_else(|| serde_json::Number::from(0));
                serde_json::Value::Number(num)
            }
            CtxVal::Bool(b) => serde_json::Value::Bool(*b),
            CtxVal::Persona => serde_json::Value::String(opts.persona.as_str().to_string()),
            CtxVal::Intensity => serde_json::Value::String(opts.intensity.as_str().to_string()),
        };
        map.insert(k.clone(), val);
    }
    serde_json::Value::Object(map).to_string()
}

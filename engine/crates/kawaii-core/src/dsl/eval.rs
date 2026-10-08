//! 规则求值：按 priority 降序逐条应用，每条改写后做占位符不变量校验。

use super::ast::{CmpOp, Matcher, RewriteOp, RuleAst, RuleSet};
use crate::cst::{self, ParsedMessage};
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
    /// 因占位符不变量被拒绝的规则名
    pub rejected: Vec<String>,
    /// 是否走了人设兜底
    pub fell_back: bool,
}

/// 把 `original` 过一遍 `rules`。
///
/// - 每条 match 命中的规则依次改写当前结果；
/// - 每条改写后用原文 vs 候选做占位符校验，违规则**拒绝该规则**（候选回滚）；
/// - 无任何规则命中且兜底开启时追加人设后缀（跳过条件对齐 TS）。
pub fn transform(original: &str, rules: &RuleSet, opts: &EvalOptions) -> TransformOutcome {
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
        for op in &rule.rewrites {
            apply_op(&mut cand, op, opts);
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
            && original.chars().count() > 3
            && !original.ends_with(&suffix)
        {
            let cand = format!("{}{}", out, suffix);
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

fn apply_op(cand: &mut String, op: &RewriteOp, opts: &EvalOptions) {
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
    }
}

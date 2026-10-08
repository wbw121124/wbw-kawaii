//! 引擎门面：有状态 API（规则热加载 / 人设轮转 / 统计），napi 与 wasm 壳镜像调用。

use crate::dsl::{parse_rules, transform, EvalOptions, RuleError, RuleSet};
use crate::jsonlite::{parse_flat_object, JVal};
use crate::persona::{get_persona, is_whimper_input, KawaiiIntensity, PersonaStyle};

/// 内置结构规则（0.9.0 语料编译后在此扩充）。
pub const BUILTIN_RULES: &str = include_str!("../../../data/builtin.kawaii");

/// 每次调用的可选参数（JS 侧 camelCase 字段；缺省回落引擎状态/默认值）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EngineOpts {
    pub persona_style: Option<String>,
    pub intensity: Option<String>,
    pub custom_fallback: Option<String>,
    pub decorate_fallback: Option<bool>,
}

impl EngineOpts {
    /// 从扁平 JSON 文本解析（wasm 壳入口）；未知字段忽略，类型错误报错。
    pub fn from_json(json: &str) -> Result<Self, String> {
        let entries = parse_flat_object(json)?;
        let mut o = Self::default();
        for (k, v) in &entries {
            match (k.as_str(), v) {
                ("personaStyle", JVal::Str(s)) => o.persona_style = Some(s.clone()),
                ("intensity", JVal::Str(s)) => o.intensity = Some(s.clone()),
                ("customFallback", JVal::Str(s)) => o.custom_fallback = Some(s.clone()),
                ("customFallback", JVal::Null) => o.custom_fallback = None,
                ("decorateFallback", JVal::Bool(b)) => o.decorate_fallback = Some(*b),
                (key @ ("personaStyle" | "intensity" | "customFallback" | "decorateFallback"), other) => {
                    return Err(format!("字段 `{}` 类型不对：{:?}", key, other))
                }
                _ => {} // 未知字段前向兼容：忽略
            }
        }
        Ok(o)
    }

    /// 独立（无引擎状态）求值选项：缺省 persona=soft / intensity=normal /
    /// decorate=true——对齐 TS `getPersona(undefined) ?? soft` 与 `getOpts` 默认。
    pub fn to_eval(&self) -> EvalOptions {
        EvalOptions {
            persona: match self.persona_style.as_deref() {
                Some(s) => PersonaStyle::parse(s),
                None => PersonaStyle::Soft,
            },
            intensity: match self.intensity.as_deref() {
                Some(s) => KawaiiIntensity::parse(s),
                None => KawaiiIntensity::Normal,
            },
            custom_fallback: self.custom_fallback.clone(),
            decorate_fallback: self.decorate_fallback.unwrap_or(true),
        }
    }
}

/// 引擎统计（shell 层补 `path`：native | wasm）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stats {
    pub persona: String,
    pub rules_version: String,
    pub rule_count: usize,
}

/// 有状态引擎：规则集 + 当前人设。
pub struct Engine {
    rules: RuleSet,
    rules_version: String,
    persona: PersonaStyle,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    /// 加载内置规则，soft 人设。
    pub fn new() -> Self {
        Self {
            rules: builtin_rules(),
            rules_version: version_of(BUILTIN_RULES, "builtin"),
            persona: PersonaStyle::Soft,
        }
    }

    /// 热加载规则文本：原子替换求值状态，返回新规则版本。
    pub fn load_rules_text(&mut self, text: &str) -> Result<String, RuleError> {
        let rules = parse_rules(text)?;
        let version = version_of(text, "dsl");
        self.rules = rules;
        self.rules_version = version.clone();
        Ok(version)
    }

    /// 回到内置规则（保留当前人设）。
    pub fn load_builtin(&mut self) -> String {
        self.rules = builtin_rules();
        self.rules_version = version_of(BUILTIN_RULES, "builtin");
        self.rules_version.clone()
    }

    pub fn rules_version(&self) -> &str {
        &self.rules_version
    }

    pub fn rule_count(&self) -> usize {
        self.rules.rules.len()
    }

    pub fn persona(&self) -> PersonaStyle {
        self.persona
    }

    /// soft → tsundere → derriere → cool → soft，返回新风格。
    pub fn cycle_persona(&mut self) -> PersonaStyle {
        let styles = crate::persona::all_persona_styles();
        let idx = styles.iter().position(|s| *s == self.persona).unwrap_or(0);
        self.persona = styles[(idx + 1) % styles.len()];
        self.persona
    }

    /// 统计（path 由 shell 补）。
    pub fn stats(&self) -> Stats {
        Stats {
            persona: self.persona.as_str().to_string(),
            rules_version: self.rules_version.clone(),
            rule_count: self.rules.rules.len(),
        }
    }

    /// 解析本次调用的求值选项：opts 覆盖引擎状态，其余走默认。
    fn eval_opts(&self, opts: Option<&EngineOpts>) -> EvalOptions {
        let o = opts.cloned().unwrap_or_default();
        EvalOptions {
            persona: match o.persona_style.as_deref() {
                Some(s) => PersonaStyle::parse(s),
                None => self.persona,
            },
            intensity: match o.intensity.as_deref() {
                Some(s) => KawaiiIntensity::parse(s),
                None => KawaiiIntensity::Normal,
            },
            custom_fallback: o.custom_fallback,
            decorate_fallback: o.decorate_fallback.unwrap_or(true),
        }
    }

    /// 消息主入口：内置/已加载 DSL 规则 + 人设兜底。
    pub fn transform_message(&self, msg: &str, opts: Option<&EngineOpts>) -> String {
        let o = self.eval_opts(opts);
        transform(msg, &self.rules, &o).output
    }

    /// MarkdownLint 消息：DSL 规则优先；未命中走结构化兜底
    /// （保留 `MD013:` 前缀与 ` [detail]`，后缀挂 lookup 之后——对齐 TS `transformMarkdownlint`）。
    pub fn transform_markdownlint(
        &self,
        msg: &str,
        opts: Option<&EngineOpts>,
        _code: Option<&str>,
    ) -> String {
        let mut o = self.eval_opts(opts);
        o.decorate_fallback = false; // 结构化兜底自己控制后缀位置
        let out = transform(msg, &self.rules, &o);
        if !out.applied.is_empty() {
            return out.output;
        }
        let suffix = crate::persona::get_fallback_suffix(o.persona, o.custom_fallback.as_deref());
        if suffix.is_empty() {
            return msg.to_string();
        }
        match split_md(msg) {
            Some((prefix, desc)) => {
                let detail = trailing_detail(desc);
                let lookup = &desc[..desc.len() - detail.len()];
                if lookup.trim().is_empty() || lookup.ends_with(&suffix) {
                    return msg.to_string();
                }
                format!("{}: {}{}{}", prefix, lookup, detail, suffix)
            }
            None => {
                if msg.trim().is_empty() || msg.ends_with(&suffix) {
                    return msg.to_string();
                }
                format!("{}{}", msg, suffix)
            }
        }
    }

    /// PyLint 消息：DSL 规则优先；未命中保留 `C0114:` 前缀追加后缀
    /// （对齐 TS `transformPylint` 的兜底分支；`code` 仅服务于 TS 规则表，结构路径不需要）。
    pub fn transform_pylint(
        &self,
        msg: &str,
        opts: Option<&EngineOpts>,
        _code: Option<&str>,
    ) -> String {
        let mut o = self.eval_opts(opts);
        o.decorate_fallback = false;
        let out = transform(msg, &self.rules, &o);
        if !out.applied.is_empty() {
            return out.output;
        }
        let suffix = crate::persona::get_fallback_suffix(o.persona, o.custom_fallback.as_deref());
        if suffix.is_empty() {
            return msg.to_string();
        }
        match split_pylint(msg) {
            Some((prefix, desc)) => {
                if desc.trim().is_empty() || desc.ends_with(&suffix) {
                    return msg.to_string();
                }
                format!("{}: {}{}", prefix, desc, suffix)
            }
            None => {
                if msg.trim().is_empty() || msg.ends_with(&suffix) {
                    return msg.to_string();
                }
                format!("{}{}", msg, suffix)
            }
        }
    }

    /// 颤音彩蛋：命中关键词返回当前人设彩蛋文案，否则空串。
    pub fn transform_whimper(&self, input: &str, opts: Option<&EngineOpts>) -> String {
        if !is_whimper_input(input) {
            return String::new();
        }
        let o = self.eval_opts(opts);
        get_persona(o.persona).easter_egg_message.to_string()
    }
}

fn builtin_rules() -> RuleSet {
    parse_rules(BUILTIN_RULES).expect("内置规则必须始终合法")
}

/// 规则版本号：FNV-1a(文本) 的 8 位十六进制 + 来源前缀。
fn version_of(text: &str, kind: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in text.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{kind}:{h:08x}")
}

/// `MD013: desc` / `MD013/rule-name: desc` → (前缀含冒号前部分, 剩余描述)。
fn split_md(msg: &str) -> Option<(&str, &str)> {
    let b = msg.as_bytes();
    if b.len() < 5
        || !b[0].is_ascii_uppercase()
        || !b[1].is_ascii_uppercase()
        || !b[2..5].iter().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let mut i = 5usize;
    if i < b.len() && b[i] == b'/' {
        i += 1;
        let start = i;
        while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'-') {
            i += 1;
        }
        if i == start {
            return None;
        }
    }
    if i >= b.len() || b[i] != b':' {
        return None;
    }
    Some((&msg[..i], msg[i + 1..].trim_start()))
}

/// 描述尾部的 ` [detail]`（无内嵌 `]`），没有则空串。
fn trailing_detail(desc: &str) -> &str {
    if !desc.ends_with(']') {
        return "";
    }
    match desc.rfind(" [") {
        Some(p) if !desc[p + 2..desc.len() - 1].contains(']') => &desc[p..],
        _ => "",
    }
}

/// `C0114: desc` / `C0114 desc` / 纯 desc → Some((码, 描述)) 或 None。
fn split_pylint(msg: &str) -> Option<(&str, &str)> {
    let b = msg.as_bytes();
    if b.len() < 5 || !b[0].is_ascii_alphabetic() || !b[1..5].iter().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut i = 5usize;
    if i < b.len() && b[i] == b':' {
        i += 1;
    }
    Some((&msg[..5], msg[i..].trim_start()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eng() -> Engine {
        Engine::new()
    }

    #[test]
    fn builtin_rules_load_and_count() {
        let e = eng();
        assert_eq!(e.rule_count(), 4, "内置四条规则");
        assert!(e.rules_version().starts_with("builtin:"), "{}", e.rules_version());
    }

    #[test]
    fn transform_message_builtin_hits() {
        let e = eng();
        assert_eq!(e.transform_message("are you ok?", None), "are you ok? ~");
        assert_eq!(e.transform_message("x is not defined", None), "x 不存在啦");
        assert_eq!(
            e.transform_message("Cannot find module 'foo'", None),
            "找不到模块 'foo'"
        );
        assert_eq!(
            e.transform_message("connect ECONNREFUSED 127.0.0.1:6379", None),
            "connect 连接被拒 127.0.0.1:6379"
        );
        // 规则未命中 + 兜底
        assert_eq!(e.transform_message("普通错误信息", None), "普通错误信息 ~");
        // 已带后缀幂等
        assert_eq!(e.transform_message("普通错误信息 ~", None), "普通错误信息 ~");
    }

    #[test]
    fn transform_message_opts_override_persona() {
        let e = eng();
        let o = EngineOpts {
            persona_style: Some("tsundere".into()),
            ..Default::default()
        };
        assert_eq!(e.transform_message("are you ok?", Some(&o)), "are you ok? 哼~");
        // 自定义后缀覆盖人设
        let o = EngineOpts {
            custom_fallback: Some("（喵）".into()),
            ..Default::default()
        };
        assert_eq!(e.transform_message("是吗", Some(&o)), "是吗（喵）");
        // decorateFallback=false 不兜底
        let o = EngineOpts {
            decorate_fallback: Some(false),
            ..Default::default()
        };
        assert_eq!(e.transform_message("是吗", Some(&o)), "是吗");
    }

    #[test]
    fn builtin_rules_keep_placeholders() {
        let e = eng();
        let out = e.transform_message("TS2345: foo is not defined", None);
        assert_eq!(out, "TS2345: foo 不存在啦");
        // 追加问题后缀时占位符原样
        let out = e.transform_message("MD013: 这个超长的标题要被问吗", None);
        assert_eq!(out, "MD013: 这个超长的标题要被问吗 ~");
    }

    #[test]
    fn markdownlint_structural_fallback() {
        let e = eng();
        // 带前缀 + detail：后缀挂 detail 之后（对齐 TS）
        assert_eq!(
            e.transform_markdownlint("MD013: Line too long [121 > 80]", None, None),
            "MD013: Line too long [121 > 80] ~"
        );
        // 带斜杠子规则名
        assert_eq!(
            e.transform_markdownlint("MD041/first-line-h1: First line in file should be a top level heading", None, None),
            "MD041/first-line-h1: First line in file should be a top level heading ~"
        );
        // 无前缀：整体追加
        assert_eq!(
            e.transform_markdownlint("Line too long", None, None),
            "Line too long ~"
        );
        // 已带后缀幂等
        assert_eq!(
            e.transform_markdownlint("MD013: Line too long ~", None, None),
            "MD013: Line too long ~"
        );
        // 毒舌人设
        let o = EngineOpts {
            persona_style: Some("derriere".into()),
            ..Default::default()
        };
        assert_eq!(
            e.transform_markdownlint("MD013: Line too long", Some(&o), None),
            "MD013: Line too long ……真是的"
        );
    }

    #[test]
    fn pylint_structural_fallback() {
        let e = eng();
        assert_eq!(
            e.transform_pylint("Missing module docstring", None, Some("C0114")),
            "Missing module docstring ~"
        );
        assert_eq!(
            e.transform_pylint("C0114: Missing module docstring", None, None),
            "C0114: Missing module docstring ~"
        );
        // 幂等
        assert_eq!(
            e.transform_pylint("Missing module docstring ~", None, None),
            "Missing module docstring ~"
        );
        // 纯空白不动
        assert_eq!(e.transform_pylint("   ", None, None), "   ");
    }

    #[test]
    fn whimper_easter_egg() {
        let e = eng();
        assert_eq!(e.transform_whimper("呜呜我太菜了", None), "你不要再批话了，不然我就不理你了~");
        assert_eq!(e.transform_whimper("正常说话", None), "");
        let o = EngineOpts {
            persona_style: Some("cool".into()),
            ..Default::default()
        };
        assert_eq!(e.transform_whimper("我太菜了", Some(&o)), "", "cool 人设无彩蛋");
    }

    #[test]
    fn cycle_persona_wraps() {
        let mut e = eng();
        assert_eq!(e.persona(), PersonaStyle::Soft);
        assert_eq!(e.cycle_persona(), PersonaStyle::Tsundere);
        assert_eq!(e.cycle_persona(), PersonaStyle::Derriere);
        assert_eq!(e.cycle_persona(), PersonaStyle::Cool);
        assert_eq!(e.cycle_persona(), PersonaStyle::Soft, "循环回 soft");
        // 状态影响默认人设
        e.cycle_persona(); // tsundere
        assert_eq!(e.transform_message("是吗", None), "是吗 哼~");
    }

    #[test]
    fn load_rules_text_swaps_state() {
        let mut e = eng();
        let v = e
            .load_rules_text(
                r#"namespace custom;
rule "only" { rewrite { prepend_text("哇！"); } }
"#,
            )
            .expect("合法规则");
        assert!(v.starts_with("dsl:"), "{}", v);
        assert_eq!(e.rule_count(), 1);
        assert_eq!(e.transform_message("你好", None), "哇！你好");

        // 原子性：坏规则不破坏现态
        let err = e.load_rules_text("rule { broken").expect_err("应报错");
        assert!(!err.message.is_empty());
        assert_eq!(e.rule_count(), 1, "加载失败保留旧规则");
        assert_eq!(e.transform_message("你好", None), "哇！你好");

        // 回到内置
        e.load_builtin();
        assert_eq!(e.rule_count(), 4);
        assert_eq!(e.transform_message("是吗", None), "是吗 ~");
    }

    #[test]
    fn stats_shape() {
        let e = eng();
        let s = e.stats();
        assert_eq!(s.persona, "soft");
        assert_eq!(s.rule_count, 4);
        assert!(s.rules_version.starts_with("builtin:"));
    }

    #[test]
    fn opts_from_json() {
        let o = EngineOpts::from_json(r#"{"personaStyle": "cool", "intensity": "subtle", "customFallback": null, "decorateFallback": false}"#)
            .expect("合法");
        assert_eq!(o.persona_style.as_deref(), Some("cool"));
        assert_eq!(o.intensity.as_deref(), Some("subtle"));
        assert_eq!(o.custom_fallback, None);
        assert_eq!(o.decorate_fallback, Some(false));

        // 未知字段忽略
        assert!(EngineOpts::from_json(r#"{"unknown": 1, "personaStyle": "soft"}"#).is_ok());
        // 类型错误
        assert!(EngineOpts::from_json(r#"{"decorateFallback": "yes"}"#).is_err());
        assert!(EngineOpts::from_json("not json").is_err());
        // 空对象 = 全默认
        assert_eq!(EngineOpts::from_json("{}").expect("空对象"), EngineOpts::default());
    }

    #[test]
    fn split_helpers_match_ts_regexes() {
        let (p, d) = split_md("MD013: Line too long [121 > 80]").expect("命中");
        assert_eq!(p, "MD013");
        assert_eq!(d, "Line too long [121 > 80]");
        assert!(split_md("short message").is_none());
        assert!(split_md("xx013: nope").is_none(), "前缀必须两字母三数字");
        assert_eq!(trailing_detail(d), " [121 > 80]");
        assert_eq!(trailing_detail("no detail]"), "");

        let (p, d) = split_pylint("C0114: Missing module docstring").expect("命中");
        assert_eq!(p, "C0114");
        assert_eq!(d, "Missing module docstring");
        assert!(split_pylint("missing-module-docstring").is_none());
    }
}

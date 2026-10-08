//! 规则 DSL：`.kawaii` 风格规则文件的无损解析与求值。
//!
//! 双 lossless 设计：消息侧 `crate::cst` 保证改写不破坏占位符；
//! 规则侧本模块保证规则文件 roundtrip 完整（注释 / 空白全保留）。

mod ast;
mod eval;
mod kinds;
mod lexer;
mod parser;

pub use ast::{
    parse_rules, CmpOp, CtxVal, Matcher, RewriteOp, RuleAst, RuleError, RuleSet,
};
pub use eval::{transform, transform_with_host, EvalOptions, TransformOutcome};
pub use kinds::{RuleLang, RuleSyntaxKind};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persona::{KawaiiIntensity, PersonaStyle};
    use rowan::NodeOrToken;

    const FIXTURE: &str = r#"// 示例规则集
namespace demo;

// 问句软萌化
rule "question" priority 10 {
  match {
    clause_ends_with("?") || clause_ends_with("？")
  }
  rewrite {
    append_text(" 嘿嘿");
  }
}

rule "missing" {
  match { text_contains("is not defined") }
  rewrite {
    replace_text("is not defined", "不存在啦");
  }
}
"#;

    fn print_tree(node: &rowan::SyntaxNode<RuleLang>) -> String {
        let mut out = String::new();
        for el in node.children_with_tokens() {
            match el {
                NodeOrToken::Node(n) => out.push_str(&print_tree(&n)),
                NodeOrToken::Token(t) => out.push_str(t.text()),
            }
        }
        out
    }

    #[test]
    fn rule_file_roundtrip_is_lossless() {
        let root = parser::parse_root(FIXTURE);
        assert_eq!(print_tree(&root), FIXTURE);
    }

    #[test]
    fn parses_namespace_rules_and_priority() {
        let set = parse_rules(FIXTURE).expect("规则合法");
        assert_eq!(set.namespace.as_deref(), Some("demo"));
        assert_eq!(set.rules.len(), 2);
        assert_eq!(set.rules[0].name, "question");
        assert_eq!(set.rules[0].priority, 10);
        assert_eq!(set.rules[1].priority, 0); // 缺省 0
        assert_eq!(
            set.rules[0].matchers,
            vec![Matcher::Any(vec![
                Matcher::ClauseEndsWith("?".into()),
                Matcher::ClauseEndsWith("？".into()),
            ])]
        );
        assert_eq!(
            set.rules[0].rewrites,
            vec![RewriteOp::AppendText(" 嘿嘿".into())]
        );
        assert_eq!(
            set.rules[1].rewrites,
            vec![RewriteOp::ReplaceText {
                from: "is not defined".into(),
                to: "不存在啦".into(),
            }]
        );
    }

    #[test]
    fn and_binds_tighter_than_or() {
        // a || b && c  =>  Any[a, All[b, c]]
        let set = parse_rules(
            r#"rule "x" { match { text_contains("a") || text_contains("b") && has_code_prefix } rewrite { append_text("!"); } }"#,
        )
        .expect("合法");
        assert_eq!(
            set.rules[0].matchers,
            vec![Matcher::Any(vec![
                Matcher::TextContains("a".into()),
                Matcher::All(vec![
                    Matcher::TextContains("b".into()),
                    Matcher::HasCodePrefix,
                ]),
            ])]
        );
    }

    #[test]
    fn not_chain_wraps_term() {
        let set = parse_rules(
            r#"rule "x" { match { !has_placeholder } rewrite { append_text("!"); } }"#,
        )
        .expect("合法");
        assert_eq!(
            set.rules[0].matchers,
            vec![Matcher::Not(Box::new(Matcher::HasPlaceholder))]
        );
    }

    #[test]
    fn placeholder_count_compare() {
        let set = parse_rules(
            r#"rule "x" { match { placeholder_count >= 2 } rewrite { append_text("!"); } }"#,
        )
        .expect("合法");
        assert_eq!(
            set.rules[0].matchers,
            vec![Matcher::PlaceholderCount(CmpOp::Ge, 2)]
        );
    }

    #[test]
    fn unknown_function_is_error() {
        let err = parse_rules(r#"rule "x" { match { frobnicate("a") } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("frobnicate"), "{}", err.message);

        let err = parse_rules(r#"rule "x" { rewrite { explode("a"); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("explode"), "{}", err.message);
    }

    #[test]
    fn missing_string_arg_is_error() {
        let err = parse_rules(r#"rule "x" { match { text_contains(42) } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("双引号"), "{}", err.message);

        let err = parse_rules(r#"rule "x" { rewrite { replace_text("only-one"); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("需要 2 个参数"), "{}", err.message);
    }

    #[test]
    fn missing_rule_name_is_error() {
        let err = parse_rules(r#"rule { match { true } }"#).err().expect("应报错");
        assert!(err.message.contains("缺少名字"), "{}", err.message);
    }

    // ── 求值 ────────────────────────────────────────────────────

    fn opts() -> EvalOptions {
        EvalOptions::default()
    }

    #[test]
    fn eval_append_on_question() {
        let set = parse_rules(FIXTURE).expect("规则合法");
        let out = transform("are you ok?", &set, &opts());
        assert_eq!(out.output, "are you ok? 嘿嘿");
        assert_eq!(out.applied, vec!["question"]);
        assert!(out.rejected.is_empty());
        assert!(!out.fell_back);

        // 中文问号同样命中
        let out = transform("你谁啊？", &set, &opts());
        assert!(out.applied.contains(&"question".to_string()));
        assert_eq!(out.output, "你谁啊？ 嘿嘿");
    }

    #[test]
    fn eval_replace_text_and_no_double_fallback() {
        let set = parse_rules(FIXTURE).expect("规则合法");
        let out = transform("x is not defined", &set, &opts());
        assert_eq!(out.output, "x 不存在啦");
        assert_eq!(out.applied, vec!["missing"]);
        assert!(!out.fell_back, "已有规则命中就不走兜底");
    }

    #[test]
    fn violation_is_rejected_and_original_kept() {
        let set =
            parse_rules(r#"rule "bad" { rewrite { replace_text("{0}", "X"); } }"#)
                .expect("规则合法");
        // 关掉兜底，单独验证回滚
        let mut o = opts();
        o.decorate_fallback = false;
        let out = transform("hello {0} world", &set, &o);
        assert_eq!(out.output, "hello {0} world", "违规改写必须回滚");
        assert_eq!(out.rejected, vec!["bad"]);
        assert!(out.applied.is_empty());
        // 开兜底 → 无规则命中走人设后缀
        let out = transform("hello {0} world", &set, &opts());
        assert!(out.fell_back);
        assert_eq!(out.output, "hello {0} world ~");
    }

    #[test]
    fn priority_descending_order() {
        let set = parse_rules(
            r#"
rule "low" priority 1 { rewrite { append_text("-L"); } }
rule "high" priority 9 { rewrite { append_text("-H"); } }
"#,
        )
        .expect("规则合法");
        let out = transform("base", &set, &opts());
        assert_eq!(out.output, "base-H-L", "高优先级先应用");
        assert_eq!(out.applied, vec!["high", "low"]);
    }

    #[test]
    fn fallback_appends_persona_suffix() {
        let set = parse_rules("").expect("空集合法");
        let out = transform("这不是错误", &set, &opts());
        assert!(out.fell_back);
        assert_eq!(out.output, "这不是错误 ~");

        // 毒舌人设
        let mut o = opts();
        o.persona = PersonaStyle::Derriere;
        let out = transform("这不是错误", &set, &o);
        assert_eq!(out.output, "这不是错误 ……真是的");

        // 自定义兜底覆盖人设
        o.custom_fallback = Some("（乖）".into());
        let out = transform("这不是错误", &set, &o);
        assert_eq!(out.output, "这不是错误（乖）");

        // decorateFallback 关闭 → 不兜底
        o.decorate_fallback = false;
        let out = transform("这不是错误", &set, &o);
        assert!(!out.fell_back);
        assert_eq!(out.output, "这不是错误");

        // 已带后缀不重复加
        o.persona = PersonaStyle::Soft;
        o.decorate_fallback = true;
        o.custom_fallback = None;
        let out = transform("这不是错误 ~", &set, &o);
        assert!(!out.fell_back);
        assert_eq!(out.output, "这不是错误 ~");
    }

    #[test]
    fn subtle_intensity_skips_short_fallback() {
        let set = parse_rules("").expect("空集合法");
        let mut o = opts();
        o.intensity = KawaiiIntensity::Subtle;
        let out = transform("找不到", &set, &o);
        assert!(!out.fell_back, "subtle + 短文本不装饰");
        assert_eq!(out.output, "找不到");

        let out = transform("这句文案明显超过八个字符了", &set, &o);
        assert!(out.fell_back);
    }

    #[test]
    fn append_persona_respects_custom_suffix() {
        let set = parse_rules(r#"rule "p" { rewrite { append_persona(); } }"#)
            .expect("规则合法");
        let mut o = opts();
        o.persona = PersonaStyle::Tsundere;
        let out = transform("哼哼", &set, &o);
        assert_eq!(out.output, "哼哼 哼~");

        o.custom_fallback = Some("（自定义）".into());
        let out = transform("哼哼", &set, &o);
        assert_eq!(out.output, "哼哼（自定义）");

        // 已带后缀不重复（自定义清空回退到人设后缀）
        o.custom_fallback = None;
        let out = transform("哼哼 哼~", &set, &o);
        assert_eq!(out.output, "哼哼 哼~");
        assert!(out.applied.is_empty(), "去重后 cand==out 不记账");
    }

    #[test]
    fn unconditional_rule_matches_everything() {
        let set = parse_rules(r#"rule "always" { rewrite { prepend_text(">> "); } }"#)
            .expect("规则合法");
        let out = transform("whatever", &set, &opts());
        assert_eq!(out.output, ">> whatever");
        assert_eq!(out.applied, vec!["always"]);
    }

    #[test]
    fn match_on_has_code_prefix_bare_ident() {
        let set = parse_rules(
            r#"rule "ts" { match { has_code_prefix && placeholder_count >= 1 } rewrite { append_text("～"); } }"#,
        )
        .expect("规则合法");
        let out = transform("TS2345: 参数类型错误", &set, &opts());
        assert!(out.applied.contains(&"ts".to_string()));

        let out = transform("普通文本没有前缀", &set, &opts());
        assert!(out.applied.is_empty());
    }

    // ── call() 自定义规则函数 ──────────────────────────────────

    use crate::fnhost::CustomFnHost;
    use std::sync::Mutex;

    /// 测试宿主：记录收到的 ctx_json，按构造结果回写。
    struct MockHost {
        /// 每次调用收到的 ctx_json
        seen: Mutex<Vec<String>>,
        /// 返回值（每次克隆）；None = 输入原样返回
        out: Option<String>,
        /// 强制错误（优先于 out）
        fail: Option<String>,
    }

    impl MockHost {
        fn new() -> Self {
            Self { seen: Mutex::new(Vec::new()), out: None, fail: None }
        }
        fn with_out(out: &str) -> Self {
            Self { seen: Mutex::new(Vec::new()), out: Some(out.to_string()), fail: None }
        }
        fn failing(msg: &str) -> Self {
            Self { seen: Mutex::new(Vec::new()), out: None, fail: Some(msg.to_string()) }
        }
    }

    impl CustomFnHost for MockHost {
        fn call(&self, _name: &str, input: &str, ctx_json: &str) -> Result<String, String> {
            self.seen.lock().expect("锁").push(ctx_json.to_string());
            if let Some(e) = &self.fail {
                return Err(e.clone());
            }
            Ok(match &self.out {
                Some(o) => o.clone(),
                None => input.to_string(),
            })
        }
        fn kind(&self) -> &'static str {
            "mock"
        }
    }

    #[test]
    fn parses_call_with_args_and_ctx_object() {
        let set = parse_rules(
            r#"rule "c" { rewrite { call("ts_hint", "a", "b", { mode: persona, n: 42, on: true, inten: intensity }); } }"#,
        )
        .expect("规则合法");
        assert_eq!(
            set.rules[0].rewrites,
            vec![RewriteOp::Call {
                name: "ts_hint".into(),
                args: vec!["a".into(), "b".into()],
                ctx: vec![
                    ("mode".into(), CtxVal::Persona),
                    ("n".into(), CtxVal::Num("42".into())),
                    ("on".into(), CtxVal::Bool(true)),
                    ("inten".into(), CtxVal::Intensity),
                ],
            }]
        );

        // 最简形态
        let set = parse_rules(r#"rule "c" { rewrite { call("shout"); } }"#).expect("合法");
        assert_eq!(
            set.rules[0].rewrites,
            vec![RewriteOp::Call {
                name: "shout".into(),
                args: vec![],
                ctx: vec![],
            }]
        );
    }

    #[test]
    fn call_shape_errors() {
        // 缺函数名
        let err = parse_rules(r#"rule "c" { rewrite { call(); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("函数名"), "{}", err.message);

        // 裸标识符参数（非字符串 / 非对象）
        let err = parse_rules(r#"rule "c" { rewrite { call("f", whatever); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("双引号"), "{}", err.message);

        // 对象后还有参数
        let err = parse_rules(r#"rule "c" { rewrite { call("f", { a: 1 }, "x"); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("最后一个参数"), "{}", err.message);

        // 上下文键必须是标识符
        let err = parse_rules(r#"rule "c" { rewrite { call("f", { 1: 2 }); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("键必须是标识符"), "{}", err.message);

        // 上下文裸变量不支持
        let err = parse_rules(r#"rule "c" { rewrite { call("f", { mode: whatever }); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("whatever"), "{}", err.message);

        // 嵌套对象不支持
        let err = parse_rules(r#"rule "c" { rewrite { call("f", { a: { b: 1 } }); } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("嵌套"), "{}", err.message);

        // match 里的 call 不是选择器
        let err = parse_rules(r#"rule "c" { match { call("f") } }"#)
            .err()
            .expect("应报错");
        assert!(err.message.contains("call"), "{}", err.message);
    }

    #[test]
    fn eval_call_rewrites_via_host_and_passes_ctx() {
        let set = parse_rules(
            r#"rule "c" { rewrite { call("hint", "extra", { mode: persona, level: 3 }); } }"#,
        )
        .expect("规则合法");
        let host = MockHost::with_out("改写后的消息");
        let mut o = opts();
        o.persona = PersonaStyle::Derriere;
        let out = transform_with_host("原始消息", &set, &o, &host);
        assert_eq!(out.output, "改写后的消息");
        assert_eq!(out.applied, vec!["c"]);
        assert!(out.rejected.is_empty());

        let seen = host.seen.lock().expect("锁");
        assert_eq!(seen.len(), 1);
        let ctx = &seen[0];
        assert!(ctx.contains(r#""fn":"hint""#), "{}", ctx);
        assert!(ctx.contains(r#""args":["extra"]"#), "{}", ctx);
        assert!(ctx.contains(r#""mode":"derriere""#), "{}", ctx);
        assert!(ctx.contains(r#""level":3"#), "{}", ctx);
    }

    #[test]
    fn eval_unregistered_call_rejects_rule() {
        let set = parse_rules(r#"rule "c" { rewrite { call("nobody"); } }"#).expect("合法");
        let mut o = opts();
        o.decorate_fallback = false;
        let out = transform_with_host("消息", &set, &o, &crate::fnhost::NoFnHost);
        assert_eq!(out.output, "消息", "失败必须整条回滚");
        assert_eq!(out.rejected, vec!["c"]);
        assert!(out.applied.is_empty());

        // 走 transform() 默认也是 NoFnHost
        let out = transform("消息", &set, &o);
        assert_eq!(out.rejected, vec!["c"]);
    }

    #[test]
    fn eval_host_error_rolls_back_whole_rule() {
        let set = parse_rules(
            r#"rule "c" { rewrite { replace_text("消息", "已替换"); call("boom"); } }"#,
        )
        .expect("合法");
        let host = MockHost::failing("沙箱炸了");
        let mut o = opts();
        o.decorate_fallback = false;
        let out = transform_with_host("消息", &set, &o, &host);
        assert_eq!(out.output, "消息", "前面的 replace 也必须随规则回滚");
        assert_eq!(out.rejected, vec!["c"]);
    }

    #[test]
    fn eval_host_result_breaking_placeholders_is_rejected() {
        let set = parse_rules(r#"rule "c" { rewrite { call("evil"); } }"#).expect("合法");
        let host = MockHost::with_out("hello X world");
        let mut o = opts();
        o.decorate_fallback = false;
        let out = transform_with_host("hello {0} world", &set, &o, &host);
        assert_eq!(out.output, "hello {0} world", "占位符被破坏必须拒绝");
        assert_eq!(out.rejected, vec!["c"]);
    }

    #[test]
    fn eval_host_noop_result_not_recorded() {
        let set = parse_rules(r#"rule "c" { rewrite { call("noop"); } }"#).expect("合法");
        let host = MockHost::new(); // 原样返回
        let mut o = opts();
        o.decorate_fallback = false;
        let out = transform_with_host("不变", &set, &o, &host);
        assert!(out.applied.is_empty(), "cand==out 不记账");
        assert!(out.rejected.is_empty());
    }
}

//! 消息 CST：lossless 解析报错消息，产出可做结构变换的语法树。
//!
//! - 所有原文（含空白 / 标点）都保留在树里，`print` 按 Token 拼接可还原原文；
//! - 占位符（`{0}`、`%s`、规则码……）单独成 Token，`placeholders_unchanged`
//!   给出改写前后的不变量校验——任何 rewrite 必须通过它，否则拒绝改写。

mod kinds;
mod lexer;
mod parser;

pub use kinds::{MsgLang, SyntaxKind};

use rowan::{NodeOrToken, SyntaxNode};

/// 已解析的报错消息。
#[derive(Clone, Debug)]
pub struct ParsedMessage {
    root: SyntaxNode<MsgLang>,
}

/// 把 `input` 解析为消息 CST。
pub fn parse(input: &str) -> ParsedMessage {
    ParsedMessage {
        root: SyntaxNode::new_root(parser::build_tree(input)),
    }
}

impl ParsedMessage {
    /// 根节点（`SyntaxKind::Message`）。
    pub fn root(&self) -> &SyntaxNode<MsgLang> {
        &self.root
    }

    /// 无损输出：按 Token 拼回原文，应恒等于解析输入。
    pub fn print(&self) -> String {
        let mut out = String::new();
        collect_text(&self.root, &mut out);
        out
    }

    /// 子句节点列表（按终止标点切分）。
    pub fn clauses(&self) -> Vec<SyntaxNode<MsgLang>> {
        self.root
            .children()
            .filter(|n| n.kind() == SyntaxKind::Clause)
            .collect()
    }

    /// 消息级规则码前缀（如 `TS2345:`、`MD013`）是否存在。
    pub fn has_code_prefix(&self) -> bool {
        self.root
            .descendants()
            .any(|n| n.kind() == SyntaxKind::CodePrefix)
    }

    /// 占位符签名：按出现顺序的（种类, 原文）列表，是不变量比较的依据。
    pub fn placeholder_signature(&self) -> Vec<(SyntaxKind, String)> {
        let mut out = Vec::new();
        collect_placeholders(&self.root, &mut out);
        out
    }
}

/// 改写前后占位符集合（种类 + 顺序 + 原文）是否完全一致。
/// 任何 rewrite 必须通过此校验，否则拒绝改写、回退原文。
pub fn placeholders_unchanged(before: &str, after: &str) -> bool {
    parse(before).placeholder_signature() == parse(after).placeholder_signature()
}

fn collect_text(node: &SyntaxNode<MsgLang>, out: &mut String) {
    for el in node.children_with_tokens() {
        match el {
            NodeOrToken::Node(n) => collect_text(&n, out),
            NodeOrToken::Token(t) => out.push_str(t.text()),
        }
    }
}

fn collect_placeholders(node: &SyntaxNode<MsgLang>, out: &mut Vec<(SyntaxKind, String)>) {
    for el in node.children_with_tokens() {
        match el {
            NodeOrToken::Node(n) => collect_placeholders(&n, out),
            NodeOrToken::Token(t) if t.kind().is_placeholder() => {
                out.push((t.kind(), t.text().to_string()));
            }
            NodeOrToken::Token(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(input: &str) -> Vec<(SyntaxKind, String)> {
        parse(input).placeholder_signature()
    }

    fn brace(text: &str) -> (SyntaxKind, String) {
        (SyntaxKind::PlaceholderBrace, text.to_string())
    }

    #[test]
    fn roundtrip_fixtures_are_lossless() {
        let samples = [
            "Expected indentation of {0} spaces but found {1}.",
            "TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
            "MD013: Line too long",
            "C0114: missing-module-docstring",
            "Object is possibly 'undefined'.(2532)",
            "connect ECONNREFUSED 127.0.0.1:6379\n    at TCPConnectWrap.afterConnect [as onConnect] (net.js:1181:16)",
            "找不到模块“foo”。请检查拼写。",
            "Unexpected console statement (no-console)",
            "Expected %d bytes but got %s, retrying %sq1…",
            "Unsupported dialect %[C++/CLI]",
            "",
            "   ",
            "1.5 MB file, e.g. the sample",
            "??!!………连续终止符",
            "Progress 100%",
            "value %5.2f / %1$s / %%",
        ];
        for s in samples {
            assert_eq!(parse(s).print(), s, "roundtrip 失败: {s:?}");
        }
    }

    #[test]
    fn brace_placeholders_signature() {
        let s = "Expected indentation of {0} spaces but found {1}.";
        assert_eq!(sig(s), vec![brace("{0}"), brace("{1}")]);
        assert_eq!(parse(s).clauses().len(), 1);
        assert!(!parse(s).has_code_prefix());
    }

    #[test]
    fn code_prefix_and_lint_codes() {
        let s = "TS2345: Argument of type 'string' is not assignable.";
        let m = parse(s);
        assert!(m.has_code_prefix());
        assert_eq!(
            m.placeholder_signature(),
            vec![(SyntaxKind::PlaceholderLintCode, "TS2345".to_string())]
        );

        // 无冒号也包前缀
        let s2 = "MD013: Line too long";
        assert!(parse(s2).has_code_prefix());

        // 句中数字码（句号后括号）
        let s3 = "Object is possibly 'undefined'.(2532)";
        assert_eq!(
            sig(s3),
            vec![(SyntaxKind::PlaceholderLintCode, "2532".to_string())]
        );
        assert_eq!(parse(s3).clauses().len(), 2);
    }

    #[test]
    fn printf_and_locale_placeholders() {
        let s = "Expected %d bytes but got %s, retrying %sq1…";
        assert_eq!(
            sig(s),
            vec![
                (SyntaxKind::PlaceholderPrintf, "%d".to_string()),
                (SyntaxKind::PlaceholderPrintf, "%s".to_string()),
                (SyntaxKind::PlaceholderPrintf, "%sq1".to_string()),
            ]
        );
        assert_eq!(
            sig("Unsupported dialect %[C++/CLI]"),
            vec![(SyntaxKind::PlaceholderLocale, "%[C++/CLI]".to_string())]
        );
        assert_eq!(
            sig("value %5.2f / %1$s / %%"),
            vec![
                (SyntaxKind::PlaceholderPrintf, "%5.2f".to_string()),
                (SyntaxKind::PlaceholderPrintf, "%1$s".to_string()),
                (SyntaxKind::PlaceholderPrintf, "%%".to_string()),
            ]
        );
        // 句尾裸 `%` 不是占位符
        assert!(sig("Progress 100%").is_empty());
    }

    #[test]
    fn paren_word_code() {
        let s = "Unexpected console statement (no-console)";
        assert_eq!(
            sig(s),
            vec![(SyntaxKind::PlaceholderWordCode, "no-console".to_string())]
        );
        // 括号里不是词码
        assert!(sig("see (the docs) here").is_empty());
        // 括号外的 kebab 不算
        assert!(sig("a well-known fact").is_empty());
    }

    #[test]
    fn decimal_and_ip_dont_split_clauses() {
        let s = "connect ECONNREFUSED 127.0.0.1:6379\n    at net.js:1181:16";
        let m = parse(s);
        assert_eq!(m.clauses().len(), 1, "IP/版本号里的点不应切分子句");
        assert_eq!(m.print(), s);
    }

    #[test]
    fn chinese_fullwidth_terminators_split_clauses() {
        let s = "找不到模块“foo”。请检查拼写。";
        let m = parse(s);
        assert_eq!(m.clauses().len(), 2);
        assert!(sig(s).is_empty());
    }

    #[test]
    fn consecutive_terminators_stay_in_one_clause() {
        let s = "??!!……连续";
        let m = parse(s);
        assert_eq!(m.clauses().len(), 2);
        assert_eq!(m.print(), s);
    }

    #[test]
    fn placeholder_invariant() {
        assert!(placeholders_unchanged("A {0} B %s", "嗨 {0} 汪 %s"));
        assert!(!placeholders_unchanged("{0}", "{1}"));
        // 占位符相对文本移动：占位符序列不变，允许
        assert!(placeholders_unchanged("{0} x", "x {0}"));
        // 占位符相对顺序变化：必须拒绝
        assert!(!placeholders_unchanged("{0} x {1}", "{1} x {0}"));
        assert!(placeholders_unchanged("plain text", "改成可爱文案"));
        assert!(!placeholders_unchanged("a %s", "a"));
    }
}

//! CST → 语义 AST：提取 `RuleSet`，校验函数名/参数个数/操作符合法性。

use rowan::SyntaxNode;

use super::kinds::{RuleLang, RuleSyntaxKind as K};
use super::parser;

/// DSL 解析/校验错误（带人类可读信息）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleError {
    pub message: String,
}

impl RuleError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for RuleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RuleError {}

/// 比较操作符。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpOp {
    Eq,
    Ne,
    Gt,
    Ge,
    Lt,
    Le,
}

/// match 选择器。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Matcher {
    /// 子句文本包含
    TextContains(String),
    /// 最后一个子句以文本结尾
    ClauseEndsWith(String),
    /// 占位符数量与 N 比较
    PlaceholderCount(CmpOp, u32),
    /// 消息带规则码前缀
    HasCodePrefix,
    /// 消息含任意占位符
    HasPlaceholder,
    Not(Box<Matcher>),
    All(Vec<Matcher>),
    Any(Vec<Matcher>),
    Const(bool),
}

/// rewrite 操作。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RewriteOp {
    ReplaceText { from: String, to: String },
    AppendText(String),
    PrependText(String),
    /// 追加当前人设后缀（尊重 custom fallback 覆盖）
    AppendPersona,
}

/// 单条规则。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleAst {
    pub name: String,
    pub priority: i64,
    pub matchers: Vec<Matcher>,
    pub rewrites: Vec<RewriteOp>,
}

/// 规则文件语义结构。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RuleSet {
    pub namespace: Option<String>,
    pub rules: Vec<RuleAst>,
}

/// 解析并校验一个规则文件。
pub fn parse_rules(src: &str) -> Result<RuleSet, RuleError> {
    let root = parser::parse_root(src);
    let mut set = RuleSet::default();
    for child in root.children() {
        match child.kind() {
            K::Namespace => set.namespace = Some(extract_namespace(&child)?),
            K::RuleDecl => set.rules.push(extract_rule(&child)?),
            _ => {}
        }
    }
    Ok(set)
}

fn extract_namespace(node: &SyntaxNode<RuleLang>) -> Result<String, RuleError> {
    let mut idents = node
        .children_with_tokens()
        .filter_map(|el| el.into_token())
        .filter(|t| t.kind() == K::Ident)
        .map(|t| t.text().to_string());
    idents.next(); // 'namespace' 关键字
    idents
        .next()
        .ok_or_else(|| RuleError::new("namespace 缺少名称"))
}

fn extract_rule(node: &SyntaxNode<RuleLang>) -> Result<RuleAst, RuleError> {
    // ── 名字（Str）与 priority（Ident 'priority' 后的 Number）──
    let mut name: Option<String> = None;
    let mut priority: i64 = 0;
    let mut expect_priority = false;
    for el in node.children_with_tokens() {
        if let Some(t) = el.into_token() {
            match t.kind() {
                K::Whitespace | K::Comment => {}
                K::Str if name.is_none() => {
                    let s = t.text();
                    name = Some(
                        s.strip_prefix('"')
                            .and_then(|x| x.strip_suffix('"'))
                            .unwrap_or(s)
                            .to_string(),
                    );
                }
                K::Ident if t.text() == "priority" => expect_priority = true,
                K::Number if expect_priority => {
                    priority = t
                        .text()
                        .parse()
                        .map_err(|_| RuleError::new(format!("priority 不是合法整数: {}", t.text())))?;
                    expect_priority = false;
                }
                _ => expect_priority = false,
            }
        }
    }
    let name = name.ok_or_else(|| RuleError::new("rule 缺少名字字符串"))?;

    // ── match / rewrite 块 ──
    let mut matchers: Vec<Matcher> = Vec::new();
    let mut rewrites: Vec<RewriteOp> = Vec::new();
    for block in node.children() {
        match block.kind() {
            K::MatchBlock => matchers = extract_match(&block)?,
            K::RewriteBlock => rewrites = extract_rewrite(&block)?,
            _ => {}
        }
    }

    Ok(RuleAst {
        name,
        priority,
        matchers,
        rewrites,
    })
}

/// 布尔表达式元素（折叠前的扁平序列）。
enum Elem {
    Term(Matcher),
    And,
    Or,
    Bang,
}

fn extract_match(block: &SyntaxNode<RuleLang>) -> Result<Vec<Matcher>, RuleError> {
    let mut elems: Vec<Elem> = Vec::new();
    for el in block.children_with_tokens() {
        match el {
            rowan::NodeOrToken::Node(n) => match n.kind() {
                K::Call => elems.push(Elem::Term(call_to_matcher(&n)?)),
                K::Compare => elems.push(Elem::Term(compare_to_matcher(&n)?)),
                _ => {}
            },
            rowan::NodeOrToken::Token(t) => match t.kind() {
                K::Whitespace | K::Comment | K::LBrace | K::RBrace => {}
                K::Ident if t.text() == "match" => {} // 块关键字（checkpoint 从它开始包）
                K::Ident => match t.text() {
                    "true" => elems.push(Elem::Term(Matcher::Const(true))),
                    "false" => elems.push(Elem::Term(Matcher::Const(false))),
                    "has_code_prefix" | "starts_with_code" => {
                        elems.push(Elem::Term(Matcher::HasCodePrefix))
                    }
                    "has_placeholder" | "placeholder_exists" => {
                        elems.push(Elem::Term(Matcher::HasPlaceholder))
                    }
                    other => {
                        return Err(RuleError::new(format!(
                            "match 中未知选择器 `{}`（需要括号调用，如 text_contains(\"...\")）",
                            other
                        )))
                    }
                },
                K::AndAnd => elems.push(Elem::And),
                K::OrOr => elems.push(Elem::Or),
                K::Bang => elems.push(Elem::Bang),
                other => {
                    return Err(RuleError::new(format!(
                        "match 块中出现意外 token `{:?}`",
                        other
                    )))
                }
            },
        }
    }
    if elems.is_empty() {
        return Ok(Vec::new()); // 无条件规则
    }
    fold(elems)
}

/// 顶层：按 `||` 分组，组内走 `&&`。
fn fold(elems: Vec<Elem>) -> Result<Vec<Matcher>, RuleError> {
    let mut groups: Vec<Vec<Elem>> = vec![Vec::new()];
    for e in elems {
        match e {
            Elem::Or => groups.push(Vec::new()),
            other => groups.last_mut().expect("至少一个分组").push(other),
        }
    }
    let mut parsed = Vec::with_capacity(groups.len());
    for g in groups {
        let m = fold_and(g)?;
        parsed.push(m);
    }
    if parsed.len() == 1 {
        Ok(vec![parsed.into_iter().next().expect("单组")])
    } else {
        Ok(vec![Matcher::Any(parsed)])
    }
}

/// 组内：按 `&&` 分条，条前 `!` 链取反。
fn fold_and(group: Vec<Elem>) -> Result<Matcher, RuleError> {
    let mut clauses: Vec<Vec<Elem>> = vec![Vec::new()];
    for e in group {
        match e {
            Elem::And => clauses.push(Vec::new()),
            other => clauses.last_mut().expect("至少一条").push(other),
        }
    }
    let mut parsed = Vec::with_capacity(clauses.len());
    for c in clauses {
        let mut bangs = 0usize;
        let mut term: Option<Matcher> = None;
        for e in c {
            match e {
                Elem::Bang => bangs += 1,
                Elem::Term(m) => {
                    if term.is_some() {
                        return Err(RuleError::new("&& 分句中出现多个操作数（缺少 && ）"));
                    }
                    term = Some(m);
                }
                Elem::And | Elem::Or => unreachable!("已按 && 切分"),
            }
        }
        let mut m = term.ok_or_else(|| RuleError::new("空的 match 条件（多余的 && 或 !）"))?;
        for _ in 0..bangs {
            m = Matcher::Not(Box::new(m));
        }
        parsed.push(m);
    }
    if parsed.len() == 1 {
        Ok(parsed.into_iter().next().expect("单条"))
    } else {
        Ok(Matcher::All(parsed))
    }
}

/// Call 节点 → match 选择器。
fn call_to_matcher(node: &SyntaxNode<RuleLang>) -> Result<Matcher, RuleError> {
    let parts = call_parts(node)?;
    let (fname, args) = parts;
    let args = args.expect_strings(&fname)?;
    match fname.as_str() {
        "text_contains" => {
            expect_arity(&fname, &args, 1)?;
            Ok(Matcher::TextContains(args[0].clone()))
        }
        "clause_ends_with" => {
            expect_arity(&fname, &args, 1)?;
            Ok(Matcher::ClauseEndsWith(args[0].clone()))
        }
        "has_code_prefix" | "starts_with_code" => {
            expect_arity(&fname, &args, 0)?;
            Ok(Matcher::HasCodePrefix)
        }
        "has_placeholder" | "placeholder_exists" => {
            expect_arity(&fname, &args, 0)?;
            Ok(Matcher::HasPlaceholder)
        }
        other => Err(RuleError::new(format!(
            "未知 match 函数 `{}`（可用: text_contains, clause_ends_with, has_code_prefix, has_placeholder）",
            other
        ))),
    }
}

/// Compare 节点 → `placeholder_count` 比较。
fn compare_to_matcher(node: &SyntaxNode<RuleLang>) -> Result<Matcher, RuleError> {
    let mut tokens = node
        .children_with_tokens()
        .filter_map(|el| el.into_token())
        .filter(|t| !matches!(t.kind(), K::Whitespace | K::Comment));
    let ident = tokens.next().ok_or_else(|| RuleError::new("空的比较表达式"))?;
    let cmp_tok = tokens.next().ok_or_else(|| RuleError::new("比较表达式缺少操作符"))?;
    let num_tok = tokens.next().ok_or_else(|| RuleError::new("比较表达式缺少右值"))?;

    if ident.kind() != K::Ident || ident.text() != "placeholder_count" {
        return Err(RuleError::new(format!(
            "未知比较变量 `{}`（可用: placeholder_count）",
            ident.text()
        )));
    }
    let op = match cmp_tok.text() {
        "==" => CmpOp::Eq,
        "!=" => CmpOp::Ne,
        ">" => CmpOp::Gt,
        ">=" => CmpOp::Ge,
        "<" => CmpOp::Lt,
        "<=" => CmpOp::Le,
        other => return Err(RuleError::new(format!("未知比较操作符 `{}`", other))),
    };
    let n: u32 = num_tok
        .text()
        .parse()
        .map_err(|_| RuleError::new(format!("比较右值不是合法整数: {}", num_tok.text())))?;
    Ok(Matcher::PlaceholderCount(op, n))
}

fn extract_rewrite(block: &SyntaxNode<RuleLang>) -> Result<Vec<RewriteOp>, RuleError> {
    let mut ops = Vec::new();
    for call in block.children() {
        if call.kind() == K::Call {
            ops.push(call_to_rewrite(&call)?);
        }
    }
    Ok(ops)
}

/// Call 节点 → rewrite 操作。
fn call_to_rewrite(node: &SyntaxNode<RuleLang>) -> Result<RewriteOp, RuleError> {
    let (fname, args) = call_parts(node)?;
    match fname.as_str() {
        "replace_text" => {
            let args = args.expect_strings(&fname)?;
            expect_arity(&fname, &args, 2)?;
            Ok(RewriteOp::ReplaceText {
                from: args[0].clone(),
                to: args[1].clone(),
            })
        }
        "append_text" | "append_suffix" => {
            let args = args.expect_strings(&fname)?;
            expect_arity(&fname, &args, 1)?;
            Ok(RewriteOp::AppendText(args[0].clone()))
        }
        "prepend_text" | "prepend_suffix" => {
            let args = args.expect_strings(&fname)?;
            expect_arity(&fname, &args, 1)?;
            Ok(RewriteOp::PrependText(args[0].clone()))
        }
        "append_persona" => {
            let args = args.expect_strings(&fname)?;
            expect_arity(&fname, &args, 0)?;
            Ok(RewriteOp::AppendPersona)
        }
        other => Err(RuleError::new(format!(
            "未知 rewrite 函数 `{}`（可用: replace_text, append_text, prepend_text, append_persona）",
            other
        ))),
    }
}

enum ArgVal {
    Str(String),
    Other(String),
}

struct Args(Vec<ArgVal>);

impl Args {
    fn expect_strings(&self, fname: &str) -> Result<Vec<String>, RuleError> {
        self.0
            .iter()
            .map(|a| match a {
                ArgVal::Str(s) => Ok(s.clone()),
                ArgVal::Other(o) => Err(RuleError::new(format!(
                    "`{}` 的参数必须是双引号字符串，得到 `{}`",
                    fname, o
                ))),
            })
            .collect()
    }
}

fn expect_arity(fname: &str, args: &[String], want: usize) -> Result<(), RuleError> {
    if args.len() != want {
        Err(RuleError::new(format!(
            "`{}` 需要 {} 个参数，给了 {} 个",
            fname,
            want,
            args.len()
        )))
    } else {
        Ok(())
    }
}

/// 拆 Call 节点为 (函数名, 参数列表)。
fn call_parts(node: &SyntaxNode<RuleLang>) -> Result<(String, Args), RuleError> {
    let mut fname: Option<String> = None;
    let mut in_parens = false;
    let mut seen_paren = false;
    let mut vals: Vec<ArgVal> = Vec::new();
    for el in node.children_with_tokens() {
        if let rowan::NodeOrToken::Token(t) = el {
            match t.kind() {
                K::Whitespace | K::Comment | K::Comma => {}
                K::Ident if fname.is_none() && !seen_paren => {
                    fname = Some(t.text().to_string());
                }
                K::LParen => {
                    in_parens = true;
                    seen_paren = true;
                }
                K::RParen => in_parens = false,
                K::Str if in_parens => {
                    let s = t.text();
                    vals.push(ArgVal::Str(
                        s.strip_prefix('"')
                            .and_then(|x| x.strip_suffix('"'))
                            .unwrap_or(s)
                            .to_string(),
                    ));
                }
                _ if in_parens => vals.push(ArgVal::Other(t.text().to_string())),
                _ => {}
            }
        }
    }
    let fname = fname.ok_or_else(|| RuleError::new("Call 节点缺少函数名"))?;
    Ok((fname, Args(vals)))
}

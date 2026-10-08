//! Rule DSL 语法分析：构造无损 rowan green tree。
//!
//! 语法（v1，与计划文档一致；布尔表达式无括号分组，`&&` 优先于 `||`）：
//!
//! ```text
//! file      := (namespace | rule)*
//! namespace := 'namespace' ident ';'
//! rule      := 'rule' str 'priority' num? '{' (match | rewrite)* '}'
//! match     := 'match' '{' expr '}'
//! rewrite   := 'rewrite' '{' (call ';')* '}'
//! expr      := expr '||' expr | expr '&&' expr | '!' expr | term
//! term      := call | compare | ident | 'true' | 'false'
//! compare   := ident cmp number
//! call      := ident '(' arg (',' arg)* ')'    // arg = string | number | ident | '{' pairs '}'
//! ```
//!
//! 解析器只做**结构分块**（Call / Compare 节点与块边界）；
//! 布尔树的折叠与语义校验在 `ast.rs`。

use rowan::{GreenNode, GreenNodeBuilder, SyntaxNode};

use super::kinds::{RuleLang, RuleSyntaxKind as K};
use super::lexer::{tokenize, Token};

/// 构造完整文件树（根节点 `RuleFile`）。永不 panic，未知 token 容错跳过。
pub(crate) fn build_tree(src: &str) -> GreenNode {
    let toks = tokenize(src);
    let mut b = GreenNodeBuilder::new();
    b.start_node(K::RuleFile.into());
    let mut p = Parser {
        toks,
        pos: 0,
        b: &mut b,
    };
    loop {
        p.eat_trivia();
        match p.peek() {
            None => break,
            Some(t) if t.kind == K::Ident && t.text == "namespace" => p.parse_namespace(),
            Some(t) if t.kind == K::Ident && t.text == "rule" => p.parse_rule(),
            Some(_) => {
                p.bump(); // 容错：跳过未知顶层内容
            }
        }
    }
    b.finish_node();
    b.finish()
}

/// 便捷入口：解析成根节点 `SyntaxNode<RuleLang>`。
pub(crate) fn parse_root(src: &str) -> SyntaxNode<RuleLang> {
    SyntaxNode::new_root(build_tree(src))
}

struct Parser<'a, 'b> {
    toks: Vec<Token<'a>>,
    pos: usize,
    b: &'b mut GreenNodeBuilder<'static>,
}

impl<'a, 'b> Parser<'a, 'b> {
    fn peek(&self) -> Option<Token<'a>> {
        self.toks.get(self.pos).copied()
    }

    /// 从当前位置起第 `n` 个**非 trivia** token（n=0 即当前）。
    fn sig_nth(&self, n: usize) -> Option<Token<'a>> {
        let mut seen = 0usize;
        for t in &self.toks[self.pos..] {
            if matches!(t.kind, K::Whitespace | K::Comment) {
                continue;
            }
            if seen == n {
                return Some(*t);
            }
            seen += 1;
        }
        None
    }

    fn bump(&mut self) -> Token<'a> {
        let t = self.toks[self.pos];
        self.pos += 1;
        self.b.token(t.kind.into(), t.text);
        t
    }

    /// 消费任意数量的空白与注释。
    fn eat_trivia(&mut self) {
        while let Some(t) = self.peek() {
            if matches!(t.kind, K::Whitespace | K::Comment) {
                self.bump();
            } else {
                break;
            }
        }
    }

    fn eat_kind(&mut self, kind: K) -> bool {
        if self.peek().map(|t| t.kind) == Some(kind) {
            self.bump();
            true
        } else {
            false
        }
    }

    fn parse_namespace(&mut self) {
        self.b.start_node(K::Namespace.into());
        self.bump(); // 'namespace'
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::Ident) {
            self.bump();
        }
        self.eat_trivia();
        self.eat_kind(K::Semi);
        self.b.finish_node();
    }

    fn parse_rule(&mut self) {
        self.b.start_node(K::RuleDecl.into());
        self.bump(); // 'rule'
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::Str) {
            self.bump();
        }
        self.eat_trivia();
        // 可选 priority
        if self.peek().map(|t| t.text) == Some("priority") {
            self.bump();
            self.eat_trivia();
            if self.peek().map(|t| t.kind) == Some(K::Number) {
                self.bump();
            }
        }
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::LBrace) {
            self.bump();
        }
        loop {
            self.eat_trivia();
            match self.peek() {
                None => break,
                Some(t) if t.kind == K::RBrace => {
                    self.bump();
                    break;
                }
                Some(t)
                    if t.kind == K::Ident
                        && (t.text == "match" || t.text == "rewrite")
                        && self.sig_nth(1).map(|t2| t2.kind) == Some(K::LBrace) =>
                {
                    if t.text == "match" {
                        self.parse_match_block();
                    } else {
                        self.parse_rewrite_block();
                    }
                }
                Some(_) => {
                    self.bump(); // 容错
                }
            }
        }
        self.b.finish_node();
    }

    fn parse_match_block(&mut self) {
        let cp = self.b.checkpoint();
        self.bump(); // 'match'
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::LBrace) {
            self.bump();
        }
        loop {
            self.eat_trivia();
            match self.peek() {
                None => break,
                Some(t) if t.kind == K::RBrace => {
                    self.bump();
                    break;
                }
                Some(t)
                    if t.kind == K::Ident
                        && self.sig_nth(1).map(|t2| t2.kind) == Some(K::LParen) =>
                {
                    self.parse_call();
                }
                Some(t)
                    if t.kind == K::Ident
                        && self.sig_nth(1).map(|t2| t2.kind) == Some(K::Cmp) =>
                {
                    self.parse_compare();
                }
                Some(_) => {
                    self.bump(); // 标识符 / 运算符 / 布尔字面量 / 容错
                }
            }
        }
        self.b.start_node_at(cp, K::MatchBlock.into());
        self.b.finish_node();
    }

    fn parse_rewrite_block(&mut self) {
        let cp = self.b.checkpoint();
        self.bump(); // 'rewrite'
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::LBrace) {
            self.bump();
        }
        loop {
            self.eat_trivia();
            match self.peek() {
                None => break,
                Some(t) if t.kind == K::RBrace => {
                    self.bump();
                    break;
                }
                Some(t)
                    if t.kind == K::Ident
                        && self.sig_nth(1).map(|t2| t2.kind) == Some(K::LParen) =>
                {
                    self.parse_call();
                }
                Some(_) => {
                    self.bump(); // 分号等
                }
            }
        }
        self.b.start_node_at(cp, K::RewriteBlock.into());
        self.b.finish_node();
    }

    fn parse_call(&mut self) {
        let cp = self.b.checkpoint();
        self.bump(); // 函数名
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::LParen) {
            self.bump();
        }
        loop {
            self.eat_trivia();
            match self.peek() {
                None => break,
                Some(t) if t.kind == K::RParen => {
                    self.bump();
                    break;
                }
                Some(_) => {
                    self.bump(); // 参数 token
                }
            }
        }
        self.b.start_node_at(cp, K::Call.into());
        self.b.finish_node();
    }

    fn parse_compare(&mut self) {
        let cp = self.b.checkpoint();
        self.bump(); // 左操作数 ident
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::Cmp) {
            self.bump();
        }
        self.eat_trivia();
        if self.peek().map(|t| t.kind) == Some(K::Number) {
            self.bump();
        }
        self.b.start_node_at(cp, K::Compare.into());
        self.b.finish_node();
    }
}

//! Rule DSL 的 SyntaxKind 定义（独立于消息 CST 的第二棵 rowan 树）。

use rowan::{Language, SyntaxKind as RowanKind};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(u16)]
pub enum RuleSyntaxKind {
    // ── 节点 ──────────────────────────────────────────────
    RuleFile = 0,
    Namespace = 1,
    RuleDecl = 2,
    MatchBlock = 3,
    RewriteBlock = 4,
    Call = 5,
    Compare = 6,
    // ── Token ─────────────────────────────────────────────
    Whitespace = 16,
    Comment = 17,
    Ident = 18,
    Str = 19,
    Number = 20,
    LBrace = 21,
    RBrace = 22,
    LParen = 23,
    RParen = 24,
    Semi = 25,
    Comma = 26,
    OrOr = 27,
    AndAnd = 28,
    Bang = 29,
    Cmp = 30,
    Punct = 31,
}

impl RuleSyntaxKind {
    pub fn is_node(self) -> bool {
        self <= RuleSyntaxKind::Compare
    }
}

impl From<RuleSyntaxKind> for RowanKind {
    fn from(k: RuleSyntaxKind) -> Self {
        RowanKind(k as u16)
    }
}

/// Rule DSL 专用 rowan Language。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum RuleLang {}

impl Language for RuleLang {
    type Kind = RuleSyntaxKind;

    fn kind_from_raw(raw: RowanKind) -> Self::Kind {
        // 未知 raw 值按 Punct 兜底（rowan 可能读到后续版本的 kind）。
        match raw.0 {
            0 => RuleSyntaxKind::RuleFile,
            1 => RuleSyntaxKind::Namespace,
            2 => RuleSyntaxKind::RuleDecl,
            3 => RuleSyntaxKind::MatchBlock,
            4 => RuleSyntaxKind::RewriteBlock,
            5 => RuleSyntaxKind::Call,
            6 => RuleSyntaxKind::Compare,
            16 => RuleSyntaxKind::Whitespace,
            17 => RuleSyntaxKind::Comment,
            18 => RuleSyntaxKind::Ident,
            19 => RuleSyntaxKind::Str,
            20 => RuleSyntaxKind::Number,
            21 => RuleSyntaxKind::LBrace,
            22 => RuleSyntaxKind::RBrace,
            23 => RuleSyntaxKind::LParen,
            24 => RuleSyntaxKind::RParen,
            25 => RuleSyntaxKind::Semi,
            26 => RuleSyntaxKind::Comma,
            27 => RuleSyntaxKind::OrOr,
            28 => RuleSyntaxKind::AndAnd,
            29 => RuleSyntaxKind::Bang,
            30 => RuleSyntaxKind::Cmp,
            _ => RuleSyntaxKind::Punct,
        }
    }

    fn kind_to_raw(kind: Self::Kind) -> RowanKind {
        RowanKind::from(kind)
    }
}

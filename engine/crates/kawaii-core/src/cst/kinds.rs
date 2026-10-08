//! 消息 CST 的种类编号：节点 < 16，Token >= 16，占位符 >= 32（新增种类不破坏已有编号）。

use rowan::{Language, SyntaxKind as RowanKind};

/// 消息 CST 节点 / Token 种类。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
#[repr(u16)]
pub enum SyntaxKind {
    /// 整条消息的根节点
    Message = 0,
    /// 子句（按终止标点切分）
    Clause = 1,
    /// 消息开头的规则码前缀，如 `TS2345:`、`MD013`
    CodePrefix = 2,

    /// 普通文本（字母 / 数字 / CJK 连续段）
    Text = 16,
    /// 空白（含换行）
    Whitespace = 17,
    /// 标点（含中英文终止标点、引号、括号）
    Punct = 18,

    /// `{0}` / `{name}` 花括号占位符
    PlaceholderBrace = 32,
    /// `%s` / `%n` / `%sq1` / `%1$s` / `%%` printf 占位符
    PlaceholderPrintf = 33,
    /// `%[C++/CLI]` 方括号方言占位符
    PlaceholderLocale = 34,
    /// `TS2322` / `MD013` / `C0114` / `(2532)` 规则码占位符
    PlaceholderLintCode = 35,
    /// `(no-console)` 括号内 kebab 词码占位符
    PlaceholderWordCode = 36,

    /// 无法识别的原始值（kind_from_raw 兜底）
    Unknown = 65535,
}

impl SyntaxKind {
    /// 是否为占位符 Token——rewrite 不可触碰的集合。
    pub fn is_placeholder(self) -> bool {
        matches!(
            self,
            Self::PlaceholderBrace
                | Self::PlaceholderPrintf
                | Self::PlaceholderLocale
                | Self::PlaceholderLintCode
                | Self::PlaceholderWordCode
        )
    }

    /// 是否为节点（而非 Token）。
    pub fn is_node(self) -> bool {
        (self as u16) < 16
    }
}

impl From<SyntaxKind> for RowanKind {
    fn from(kind: SyntaxKind) -> Self {
        RowanKind(kind as u16)
    }
}

/// 消息 CST 的 rowan 语言标记。
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash)]
pub enum MsgLang {}

impl Language for MsgLang {
    type Kind = SyntaxKind;

    fn kind_from_raw(raw: RowanKind) -> SyntaxKind {
        match raw.0 {
            0 => SyntaxKind::Message,
            1 => SyntaxKind::Clause,
            2 => SyntaxKind::CodePrefix,
            16 => SyntaxKind::Text,
            17 => SyntaxKind::Whitespace,
            18 => SyntaxKind::Punct,
            32 => SyntaxKind::PlaceholderBrace,
            33 => SyntaxKind::PlaceholderPrintf,
            34 => SyntaxKind::PlaceholderLocale,
            35 => SyntaxKind::PlaceholderLintCode,
            36 => SyntaxKind::PlaceholderWordCode,
            _ => SyntaxKind::Unknown,
        }
    }

    fn kind_to_raw(kind: SyntaxKind) -> RowanKind {
        kind.into()
    }
}

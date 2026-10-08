//! 方言表驱动的零拷贝词法器：切出占位符、空白、标点与文本。
//!
//! 只做「识别与保护」，不做语义判断——过度归类为占位符是安全的（缩小可改写范围），
//! 漏归类才危险（改写可能破坏占位符），因此方言扫描宁可保守。

use super::SyntaxKind;

/// 一个词法 Token，文本零拷贝地借用原始输入。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token<'a> {
    pub kind: SyntaxKind,
    pub text: &'a str,
}

/// 子句终止标点（解析器据此切分子句）。
pub const CLAUSE_TERMINATORS: &str = ".?!。！？；;…";

/// printf 转换符（单字符），多字符方言 `sq1` / `sq` 单独优先匹配。
const PRINTF_CONVS: &str = "nNsSdiufFeEgGcpxXaAbBpPqQ%";

/// 把输入切成 Token 序列；保证所有 Token 文本拼接 == 输入（lossless）。
pub fn tokenize(input: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut i = 0usize;
    let mut text_start = 0usize;

    while i < input.len() {
        let c = input[i..].chars().next().expect("i 在字符边界上");

        // 1) 空白 run（含换行）
        if c.is_whitespace() {
            flush_text(input, &mut tokens, text_start, i);
            let start = i;
            while i < input.len() {
                let c2 = input[i..].chars().next().expect("i 在字符边界上");
                if c2.is_whitespace() {
                    i += c2.len_utf8();
                } else {
                    break;
                }
            }
            tokens.push(Token {
                kind: SyntaxKind::Whitespace,
                text: &input[start..i],
            });
            text_start = i;
            continue;
        }

        // 2) printf / 方言占位符
        if c == '%' {
            if let Some((len, kind)) = percent_len(&input[i..]) {
                flush_text(input, &mut tokens, text_start, i);
                tokens.push(Token {
                    kind,
                    text: &input[i..i + len],
                });
                i += len;
                text_start = i;
                continue;
            }
            i += 1;
            continue;
        }

        // 3) 花括号占位符
        if c == '{' {
            if let Some(len) = brace_len(&input[i..]) {
                flush_text(input, &mut tokens, text_start, i);
                tokens.push(Token {
                    kind: SyntaxKind::PlaceholderBrace,
                    text: &input[i..i + len],
                });
                i += len;
                text_start = i;
                continue;
            }
            i += 1;
            continue;
        }

        // 4) 括号内规则码：(2532) / (no-console) —— 一次吐出三个 Token
        if c == '(' {
            if let Some((kind, total)) = paren_code_len(&input[i..]) {
                flush_text(input, &mut tokens, text_start, i);
                tokens.push(Token {
                    kind: SyntaxKind::Punct,
                    text: &input[i..i + 1],
                });
                tokens.push(Token {
                    kind,
                    text: &input[i + 1..i + total - 1],
                });
                tokens.push(Token {
                    kind: SyntaxKind::Punct,
                    text: &input[i + total - 1..i + total],
                });
                i += total;
                text_start = i;
                continue;
            }
            // 普通括号落入下方标点分支
        }

        // 5) 独立规则码词形（大写字母 + 数字，词边界）
        if c.is_ascii_uppercase() {
            if let Some(len) = lint_code_len(input, i) {
                flush_text(input, &mut tokens, text_start, i);
                tokens.push(Token {
                    kind: SyntaxKind::PlaceholderLintCode,
                    text: &input[i..i + len],
                });
                i += len;
                text_start = i;
                continue;
            }
        }

        // 6) 普通字符：字母 / 数字 / CJK 并入文本 run；其余逐字符标点
        if c.is_alphanumeric() || c == '_' {
            i += c.len_utf8();
            continue;
        }
        flush_text(input, &mut tokens, text_start, i);
        tokens.push(Token {
            kind: SyntaxKind::Punct,
            text: &input[i..i + c.len_utf8()],
        });
        i += c.len_utf8();
        text_start = i;
    }
    flush_text(input, &mut tokens, text_start, i);
    tokens
}

fn flush_text<'a>(input: &'a str, tokens: &mut Vec<Token<'a>>, start: usize, end: usize) {
    if start < end {
        tokens.push(Token {
            kind: SyntaxKind::Text,
            text: &input[start..end],
        });
    }
}

/// `%` 起始序列的总长度（含 `%`）与种类；识别失败返回 None（`%` 归入普通文本）。
fn percent_len(s: &str) -> Option<(usize, SyntaxKind)> {
    let rest = &s[1..];

    // %[方言]，如 %[C++/CLI]
    if let Some(after) = rest.strip_prefix('[') {
        let idx = after.find(']')?;
        let content = &after[..idx];
        if content.is_empty() || content.len() > 64 {
            return None;
        }
        return Some((1 + 1 + idx + 1, SyntaxKind::PlaceholderLocale));
    }

    let b = rest.as_bytes();
    let mut j = 0usize;

    // 位置参数 n$
    while j < b.len() && b[j].is_ascii_digit() {
        j += 1;
    }
    if j < b.len() && b[j] == b'$' {
        j += 1;
    }
    // flags
    while j < b.len() && matches!(b[j], b'-' | b'+' | b' ' | b'#' | b'0' | b'\'') {
        j += 1;
    }
    // 宽度
    while j < b.len() && b[j].is_ascii_digit() {
        j += 1;
    }
    // 精度
    if j < b.len() && b[j] == b'.' {
        j += 1;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
    }
    if j >= b.len() {
        return None;
    }

    // 多字符转换符（长的优先）
    if rest[j..].starts_with("sq1") {
        return Some((1 + j + 3, SyntaxKind::PlaceholderPrintf));
    }
    if rest[j..].starts_with("sq") {
        return Some((1 + j + 2, SyntaxKind::PlaceholderPrintf));
    }
    let ch = rest[j..].chars().next()?;
    if PRINTF_CONVS.contains(ch) {
        return Some((1 + j + ch.len_utf8(), SyntaxKind::PlaceholderPrintf));
    }
    None
}

/// `{...}` 的总长度（含大括号）；不匹配返回 None。
fn brace_len(s: &str) -> Option<usize> {
    let after = &s[1..];
    if after.is_empty() || after.len() > 129 {
        return None;
    }
    let idx = after.find('}')?;
    let content = &after[..idx];
    if content.is_empty() || content.contains('{') {
        return None;
    }
    Some(1 + idx + 1)
}

/// `(...)` 内是数字码 / kebab 词码时返回（内部 Token 种类, 总长度）。
fn paren_code_len(s: &str) -> Option<(SyntaxKind, usize)> {
    let after = &s[1..];
    let idx = after.find(')')?;
    if idx == 0 || idx > 64 {
        return None;
    }
    let inner = &after[..idx];
    if (inner.len() == 4 || inner.len() == 5) && inner.bytes().all(|b| b.is_ascii_digit()) {
        return Some((SyntaxKind::PlaceholderLintCode, 1 + idx + 1));
    }
    if is_kebab(inner) {
        return Some((SyntaxKind::PlaceholderWordCode, 1 + idx + 1));
    }
    None
}

/// `^[a-z]+(-[a-z]+)+$`
fn is_kebab(s: &str) -> bool {
    let mut parts = s.split('-');
    let first = match parts.next() {
        Some(p) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase()) => p,
        _ => return false,
    };
    let _ = first;
    let mut extra = 0usize;
    for p in parts {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_lowercase()) {
            return false;
        }
        extra += 1;
    }
    extra >= 1
}

/// 从 `i` 处识别独立规则码词形 `[A-Z]{1,4}[0-9]{2,5}`，要求前后词边界。
fn lint_code_len(input: &str, i: usize) -> Option<usize> {
    if i > 0 {
        let prev = input[..i].chars().next_back()?;
        if prev.is_alphanumeric() || prev == '_' || prev == '-' {
            return None;
        }
    }
    let s = &input[i..];
    let b = s.as_bytes();
    let mut j = 0usize;
    while j < b.len() && b[j].is_ascii_uppercase() && j < 4 {
        j += 1;
    }
    if j == 0 {
        return None;
    }
    let digit_start = j;
    while j < b.len() && b[j].is_ascii_digit() && j - digit_start < 6 {
        j += 1;
    }
    let digits = j - digit_start;
    if digits < 2 || digits > 5 {
        return None;
    }
    if j < b.len() {
        let next = s[j..].chars().next()?;
        if next.is_alphanumeric() || next == '_' {
            return None;
        }
    }
    Some(j)
}

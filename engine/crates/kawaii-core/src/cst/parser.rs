//! 消息 CST 组装：把词法 Token 组织成 Message > Clause > (CodePrefix) 层级。

use rowan::{Checkpoint, GreenNode, GreenNodeBuilder};

use super::kinds::SyntaxKind;
use super::lexer::{tokenize, CLAUSE_TERMINATORS, Token};

/// 构建 lossless 绿树。
pub(crate) fn build_tree(input: &str) -> GreenNode {
    let tokens = tokenize(input);
    let mut builder = GreenNodeBuilder::new();
    builder.start_node(SyntaxKind::Message.into());
    if !tokens.is_empty() {
        emit_clauses(&mut builder, input, &tokens);
    }
    builder.finish_node();
    builder.finish()
}

/// 按「终止标点 run + 其后空白」切分子句；首句开头的规则码包成 CodePrefix。
fn emit_clauses(builder: &mut GreenNodeBuilder, input: &str, tokens: &[Token<'_>]) {
    // 每个 Token 的起始字节偏移（小消息，O(n) 预计算足够）
    let mut offsets = Vec::with_capacity(tokens.len());
    let mut off = 0usize;
    for t in tokens {
        offsets.push(off);
        off += t.text.len();
    }

    builder.start_node(SyntaxKind::Clause.into());
    let mut prefix_done = false;
    let mut i = 0usize;

    while i < tokens.len() {
        let t = tokens[i];

        // 首句：跳过前导空白，首个实质 Token 若是规则码则包 CodePrefix
        if !prefix_done && t.kind == SyntaxKind::Whitespace {
            builder.token(t.kind.into(), t.text);
            i += 1;
            continue;
        }
        if !prefix_done && t.kind == SyntaxKind::PlaceholderLintCode {
            prefix_done = true;
            let cp: Checkpoint = builder.checkpoint();
            builder.token(t.kind.into(), t.text);
            i += 1;
            // 紧跟的 `:` 并入前缀（如 `TS2345:`）
            if i < tokens.len() && tokens[i].kind == SyntaxKind::Punct && tokens[i].text == ":" {
                builder.token(tokens[i].kind.into(), tokens[i].text);
                i += 1;
            }
            builder.start_node_at(cp, SyntaxKind::CodePrefix.into());
            builder.finish_node();
            continue;
        }
        prefix_done = true;

        builder.token(t.kind.into(), t.text);
        i += 1;

        if !is_terminator(t, input, offsets[i - 1]) {
            continue;
        }
        // 连续终止符并入同一子句（如 `?!`、`...`）
        while i < tokens.len() && is_terminator(tokens[i], input, offsets[i]) {
            builder.token(tokens[i].kind.into(), tokens[i].text);
            i += 1;
        }
        // 终止符后的空白留在本子句尾
        if i < tokens.len() && tokens[i].kind == SyntaxKind::Whitespace {
            builder.token(tokens[i].kind.into(), tokens[i].text);
            i += 1;
        }
        // 后面还有内容才开新子句（避免尾部空子句）
        if i < tokens.len() {
            builder.finish_node();
            builder.start_node(SyntaxKind::Clause.into());
        }
    }
    builder.finish_node();
}

/// 是否为子句终止标点。
///
/// `.` 仅在「后面不是字母/数字（或已到结尾）」时切分：
/// 保护 `net.js`、`127.0.0.1`、`1.5` 这类文件名 / IP / 小数；
/// 句末 `.`（后随空白或结尾）以及 `'.(2532)` 这类后随符号的情形正常切分。
fn is_terminator(t: Token<'_>, input: &str, offset: usize) -> bool {
    if t.kind != SyntaxKind::Punct || t.text.chars().count() != 1 {
        return false;
    }
    let ch = t.text.chars().next().expect("单字符");
    if !CLAUSE_TERMINATORS.contains(ch) {
        return false;
    }
    if ch != '.' {
        return true;
    }
    match input[offset + 1..].chars().next() {
        None => true,
        Some(next) => !next.is_alphanumeric(),
    }
}

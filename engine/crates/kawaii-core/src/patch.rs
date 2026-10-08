//! `src/transform.ts` 的字节级移植：tokenize / transformValue / patchContent / formatStats。
//! fastpath 查表命中直用变体，miss 走兜底——与 TS 逐字节一致（golden 三跑的依据）。

use crate::dsl::EvalOptions;
use crate::fastpath;
use crate::persona::{get_fallback_suffix, should_skip_decorate};
use sha2::{Digest, Sha256};

/// 条目结果种类（对齐 TS `EntryKind`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Null,
    Hit,
    Decorated,
    Kept,
    Already,
    Identity,
}

impl EntryKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EntryKind::Null => "null",
            EntryKind::Hit => "hit",
            EntryKind::Decorated => "decorated",
            EntryKind::Kept => "kept",
            EntryKind::Already => "already",
            EntryKind::Identity => "identity",
        }
    }
}

/// 单条目转换结果（TS `EntryResult`；`null` 条目 value 为 None）。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct EntryResult {
    pub value: Option<String>,
    pub kind: EntryKind,
}

/// patchContent 统计（TS `PatchStats`，字段名一致）。
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PatchStats {
    pub total: u32,
    pub nulls: u32,
    pub hits: u32,
    pub decorated: u32,
    pub identity: u32,
    pub kept: u32,
    pub already: u32,
    pub changed: u32,
}

/// patchContent 结果（TS `PatchResult`）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct PatchResult {
    pub content: String,
    pub stats: PatchStats,
    pub changed: bool,
}

/// 占位符扫描：`%% | %\[...\] | %[A-Za-z]+\d* | \{\d+\}`（对齐 TS TOKEN_RE）。
pub fn tokenize(s: &str) -> Vec<String> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                if i + 1 < b.len() && b[i + 1] == b'%' {
                    out.push("%%".to_string());
                    i += 2;
                } else if i + 1 < b.len() && b[i + 1] == b'[' {
                    // `%[` 后到最近的 `]`；无 `]` 则本起点不匹配（正则引擎前进 1 字符）
                    if let Some(rel) = b[i + 2..].iter().position(|&c| c == b']') {
                        let end = i + 2 + rel;
                        out.push(s[i..=end].to_string());
                        i = end + 1;
                    } else {
                        i += 1;
                    }
                } else if i + 1 < b.len() && b[i + 1].is_ascii_alphabetic() {
                    let mut j = i + 1;
                    while j < b.len() && b[j].is_ascii_alphabetic() {
                        j += 1;
                    }
                    while j < b.len() && b[j].is_ascii_digit() {
                        j += 1;
                    }
                    out.push(s[i..j].to_string());
                    i = j;
                } else {
                    i += 1;
                }
            }
            b'{' => {
                let mut j = i + 1;
                while j < b.len() && b[j].is_ascii_digit() {
                    j += 1;
                }
                if j > i + 1 && j < b.len() && b[j] == b'}' {
                    out.push(s[i..=j].to_string());
                    i = j + 1;
                } else {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    out
}

fn seq_equal(a: &str, b: &str) -> bool {
    tokenize(a) == tokenize(b)
}

/// 确定性变体选择：sha256(key) 前 4 字节大端 u32 % len（对齐 variant-picker.ts）。
pub fn pick_variant(variants: &[String], key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
    variants[(n % variants.len() as u32) as usize].clone()
}

/// `/\\s+$/u`：仅剥离末尾「一个反斜杠 + 一段 s」（TS 源码字面量如此，普通空白不剥）。
fn strip_js_trailing(s: &str) -> &str {
    let b = s.as_bytes();
    let mut j = b.len();
    while j > 0 && b[j - 1] == b's' {
        j -= 1;
    }
    if j > 0 && j < b.len() && b[j - 1] == b'\\' {
        &s[..j - 1]
    } else {
        s
    }
}

/// `transform.ts` 的 transformValue（不含 index——TS 未使用）。
pub fn transform_value(value: &str, opts: &EvalOptions) -> EntryResult {
    let hit = |v: String, k| EntryResult {
        value: Some(v),
        kind: k,
    };
    if fastpath::is_identity(value) {
        return hit(value.to_string(), EntryKind::Identity);
    }
    if fastpath::is_cute(value) {
        return hit(value.to_string(), EntryKind::Already);
    }
    if let Some(variants) = fastpath::lookup(value) {
        if !variants.is_empty() {
            let pick = pick_variant(variants, value);
            if seq_equal(value, &pick) {
                return hit(pick, EntryKind::Hit);
            }
        }
    }
    if value.trim().is_empty() {
        return hit(value.to_string(), EntryKind::Kept);
    }
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    if !suffix.is_empty() && value.ends_with(&suffix) {
        return hit(value.to_string(), EntryKind::Already);
    }
    if should_skip_decorate(value, opts.intensity) {
        return hit(value.to_string(), EntryKind::Kept);
    }
    if opts.decorate_fallback && !suffix.is_empty() {
        return hit(
            format!("{}{}", strip_js_trailing(value), suffix),
            EntryKind::Decorated,
        );
    }
    hit(value.to_string(), EntryKind::Kept)
}

/// 按行拆分并保留换行符（对齐 `split(/(\r\n|\n|\r)/)`）。
fn split_keep_eol(content: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let b = content.as_bytes();
    let mut last = 0;
    let mut i = 0;
    while i < b.len() {
        let eol_len = if b[i] == b'\r' {
            if i + 1 < b.len() && b[i + 1] == b'\n' {
                2
            } else {
                1
            }
        } else if b[i] == b'\n' {
            1
        } else {
            0
        };
        if eol_len > 0 {
            parts.push(content[last..i].to_string());
            parts.push(content[i..i + eol_len].to_string());
            i += eol_len;
            last = i;
        } else {
            i += 1;
        }
    }
    parts.push(content[last..].to_string());
    parts
}

/// JSON.parse 字符串字面量（含引号）；非合法 JSON 字符串 → None（TS 走结构行分支）。
fn parse_json_string(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    match v {
        serde_json::Value::String(s) => Some(s),
        _ => None,
    }
}

fn json_quote(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\""))
}

struct LineOutcome {
    line: String,
    result: Option<EntryResult>,
}

fn transform_line(line: &str, opts: &EvalOptions) -> LineOutcome {
    let unchanged = |r: Option<EntryResult>| LineOutcome {
        line: line.to_string(),
        result: r,
    };
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return unchanged(None);
    }
    let has_comma = trimmed.ends_with(',');
    let body_src = if has_comma {
        &trimmed[..trimmed.len() - 1]
    } else {
        trimmed
    };
    let body = body_src.trim();
    if body == "null" {
        return unchanged(Some(EntryResult {
            value: None,
            kind: EntryKind::Null,
        }));
    }
    if !body.starts_with('"') {
        return unchanged(None);
    }
    let parsed = match parse_json_string(body) {
        Some(s) => s,
        None => return unchanged(None),
    };
    let res = transform_value(&parsed, opts);
    if res.value.as_deref() == Some(parsed.as_str()) {
        return unchanged(Some(res));
    }
    let indent = &line[..line.len() - line.trim_start().len()];
    let new_val = res.value.clone().unwrap_or_default();
    let new_line = format!(
        "{}{}{}",
        indent,
        json_quote(&new_val),
        if has_comma { "," } else { "" }
    );
    LineOutcome {
        line: new_line,
        result: Some(res),
    }
}

fn accumulate(stats: &mut PatchStats, kind: EntryKind) {
    stats.total += 1;
    match kind {
        EntryKind::Null => stats.nulls += 1,
        EntryKind::Hit => stats.hits += 1,
        EntryKind::Decorated => stats.decorated += 1,
        EntryKind::Identity => stats.identity += 1,
        EntryKind::Kept => stats.kept += 1,
        EntryKind::Already => stats.already += 1,
    }
}

/// `transform.ts` 的 patchContent。
pub fn patch_content(content: &str, opts: &EvalOptions) -> PatchResult {
    let mut parts = split_keep_eol(content);
    let mut stats = PatchStats::default();
    let mut changed = false;
    let mut i = 0;
    while i < parts.len() {
        let line = parts[i].clone();
        let out = transform_line(&line, opts);
        if let Some(res) = &out.result {
            // TS 的 index 仅用于占位（变体由 value 键哈希选择，与序号无关）
            accumulate(&mut stats, res.kind);
        }
        if out.line != line {
            changed = true;
            stats.changed += 1;
            parts[i] = out.line;
        }
        i += 2;
    }
    PatchResult {
        content: parts.concat(),
        stats,
        changed,
    }
}

/// `transform.ts` 的 formatStats。
pub fn format_stats(stats: &PatchStats) -> String {
    format!(
        "条目 {}（null {}）| 命中规则 {} | 兜底装饰 {} | 参考保持 {} | 保持原文 {} | 已是文案 {} | 改写行 {}",
        stats.total,
        stats.nulls,
        stats.hits,
        stats.decorated,
        stats.identity,
        stats.kept,
        stats.already,
        stats.changed
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::EvalOptions;

    fn on() -> EvalOptions {
        EvalOptions::default()
    }

    #[test]
    fn tokenize_all_forms() {
        assert_eq!(
            tokenize("a %sq1 b %t, %%x, %[managed], %nfd, %t2, %[C++/CLI]"),
            vec!["%sq1", "%t", "%%", "%[managed]", "%nfd", "%t2", "%[C++/CLI]"]
        );
        assert_eq!(tokenize("没有占位符"), Vec::<String>::new());
        assert_eq!(
            tokenize("类型“{0}”不能赋给类型“{1}”。还差 {10} 和 {2}"),
            vec!["{0}", "{1}", "{10}", "{2}"]
        );
        assert_eq!(tokenize("未知 at 规则 {0}，但 %s 不算"), vec!["{0}", "%s"]);
        assert_eq!(
            tokenize("if { x } then { y }"),
            Vec::<String>::new(),
            "普通花括号不误伤"
        );
        assert_eq!(tokenize("100% 完成 {1}"), vec!["{1}"]);
        assert_eq!(tokenize(""), Vec::<String>::new());
    }

    #[test]
    fn pick_variant_is_deterministic() {
        let variants = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let p1 = pick_variant(&variants, "some-key");
        let p2 = pick_variant(&variants, "some-key");
        assert_eq!(p1, p2);
    }

    #[test]
    fn strip_js_trailing_only_backslash_s() {
        assert_eq!(strip_js_trailing("abc"), "abc");
        assert_eq!(strip_js_trailing("abc "), "abc ");
        assert_eq!(strip_js_trailing("abc\\s"), "abc");
        assert_eq!(strip_js_trailing("abc\\ss"), "abc");
        assert_eq!(strip_js_trailing("abc\\\\"), "abc\\\\");
    }

    #[test]
    fn whitespace_value_is_kept() {
        let r = transform_value("", &on());
        assert_eq!(r.value.as_deref(), Some(""));
        assert_eq!(r.kind, EntryKind::Kept);
        let r = transform_value("   ", &on());
        assert_eq!(r.value.as_deref(), Some("   "));
        assert_eq!(r.kind, EntryKind::Kept);
    }

    #[test]
    fn identity_values_stay() {
        // identity.txt 含「变量」等拼接片段
        for v in ["变量", "所在行数:"] {
            let r = transform_value(v, &on());
            assert_eq!(r.kind, EntryKind::Identity, "{v}");
            assert_eq!(r.value.as_deref(), Some(v));
        }
    }

    #[test]
    fn corpus_counts() {
        assert!(fastpath::rules_count() > 3000, "规则键应超过 3000");
    }

    #[test]
    fn patch_content_crlf_and_null() {
        let key = fastpath_sample_key();
        let content = format!("[\r\n    null,\r\n    {},\r\n]\r\n", json_quote(key));
        let res = patch_content(&content, &on());
        assert!(res.changed);
        assert_eq!(res.stats.nulls, 1);
        assert_eq!(res.stats.hits, 1);
        assert_eq!(res.stats.total, 2);
        assert!(res.content.starts_with("[\r\n    null,\r\n"));
        assert!(res.content.ends_with("]\r\n"));
    }

    #[test]
    fn patch_content_non_json_untouched() {
        let res = patch_content("not json at all", &on());
        assert!(!res.changed);
        assert_eq!(res.content, "not json at all");
        let res = patch_content("", &on());
        assert!(!res.changed);
    }

    fn fastpath_sample_key() -> &'static str {
        // 找一个占位符 ≥2 且无反斜杠的键（与测试 pickKey 同思路）
        let keys: Vec<&str> = crate::fastpath::all_keys().collect();
        keys.iter()
            .find(|k| tokenize(k).len() >= 2 && !k.contains('\\'))
            .copied()
            .unwrap_or(keys[0])
    }

    #[test]
    fn format_stats_smoke() {
        let stats = PatchStats::default();
        let text = format_stats(&stats);
        assert!(text.contains("条目 0"));
    }
}

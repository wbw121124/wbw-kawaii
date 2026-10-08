//! `src/transform-new.ts` 的字节级移植：tsDiag 表 / zh JSON / 语言包 bundle /
//! bundle 模板串 / MarkdownLint / PyLint。规则表以参数传入（与 TS 一致）。
//!
//! 说明：`patchTsDiag` 的命中重建分支与 TS 同样保留其原始构造（含丢参行为），
//! golden 三跑要求与现网 TS 逐字节一致；行为修正应先改 TS 再同步移植。

use crate::dsl::EvalOptions;
use crate::patch::pick_variant;
use crate::persona::{get_fallback_suffix, should_skip_decorate};
use std::collections::HashMap;

pub type RuleTable = HashMap<String, Vec<String>>;

/// transform-new 的结果形状（stats 仅 hits/decorated）。
#[derive(Debug, Clone)]
pub struct NewPatchResult {
    pub content: String,
    pub hits: u32,
    pub decorated: u32,
    pub changed: bool,
}

fn is_js_ws(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

// ──────────────────────────── MarkdownLint ────────────────────────────

fn js_ws_len_at(s: &str) -> usize {
    s.chars().take_while(|&c| is_js_ws(c)).map(char::len_utf8).sum()
}

/// `^([A-Z]{2}\d{3}(?:\/[\w-]+)?):\s*(.*)$`（单行消息；含换行则不匹配——
/// 与 `.` 不跨行、`$` 锚定行尾的组合语义对齐到单行常见形态）。
fn md_split(message: &str) -> Option<(&str, &str)> {
    if message.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    let b = message.as_bytes();
    if b.len() < 5
        || !b[0].is_ascii_uppercase()
        || !b[1].is_ascii_uppercase()
        || !b[2..5].iter().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let mut i = 5;
    if i < b.len() && b[i] == b'/' {
        let mut j = i + 1;
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] == b'-') {
            j += 1;
        }
        if j == i + 1 {
            return None;
        }
        i = j;
    }
    if i >= b.len() || b[i] != b':' {
        return None;
    }
    let prefix = &message[..i];
    let rest = &message[i + 1..];
    let ws = js_ws_len_at(rest);
    Some((prefix, &rest[ws..]))
}

/// `desc` 末尾的 ` \[...\]` 详情段（含前导空白）。
fn trailing_detail(desc: &str) -> Option<&str> {
    if !desc.ends_with(']') {
        return None;
    }
    let bytes = desc.as_bytes();
    let mut i = bytes.len() - 1; // `]`
    while i > 0 {
        i -= 1;
        match bytes[i] {
            b']' => return None,
            b'[' => {
                // 前一字符必须是单个 \s
                if i == 0 {
                    return None;
                }
                let prev = desc[..i].chars().next_back()?;
                if is_js_ws(prev) {
                    return Some(&desc[i - prev.len_utf8()..]);
                }
                return None;
            }
            _ => {}
        }
    }
    None
}

/// TS `transformMarkdownlint(message, rules, opts, code)`。
pub fn transform_markdownlint(
    message: &str,
    rules: &RuleTable,
    opts: &EvalOptions,
    code: Option<&str>,
) -> String {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    let (prefix, desc) = match md_split(message) {
        Some(p) => p,
        None => ("", message),
    };
    let code_fallback = code.filter(|c| !c.is_empty()).unwrap_or(prefix);
    let code_key = code_fallback.split('/').next().unwrap_or(code_fallback);
    let detail = trailing_detail(desc).unwrap_or("");
    let lookup = if detail.is_empty() {
        desc
    } else {
        &desc[..desc.len() - detail.len()]
    };
    let mut found: Option<&Vec<String>> = None;
    if !code_key.is_empty() {
        found = rules.get(code_key);
    }
    if found.is_none() {
        found = rules.get(lookup);
    }
    if found.is_none() {
        found = rules.get(desc);
    }
    if let Some(variants) = found {
        if !variants.is_empty() {
            let pick_key = if !code_key.is_empty() { code_key } else { lookup };
            let picked = pick_variant(variants, pick_key);
            return if prefix.is_empty() {
                format!("{picked}{detail}")
            } else {
                format!("{prefix}: {picked}{detail}")
            };
        }
    }
    if !lookup.trim().is_empty() && !lookup.ends_with(&suffix) {
        let next = format!("{lookup}{detail}{suffix}");
        return if prefix.is_empty() {
            next
        } else {
            format!("{prefix}: {next}")
        };
    }
    message.to_string()
}

// ──────────────────────────── PyLint ────────────────────────────

/// `^([A-Za-z]\d{4}):?\s*(.*)$`（单行守护同 md）。
fn pylint_split(message: &str) -> Option<(&str, &str)> {
    if message.contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        return None;
    }
    let b = message.as_bytes();
    if b.len() < 5 || !b[0].is_ascii_alphabetic() || !b[1..5].iter().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut i = 5;
    if i < b.len() && b[i] == b':' {
        i += 1;
    }
    let rest = &message[i..];
    let ws = js_ws_len_at(rest);
    Some((&message[..5], &rest[ws..]))
}

/// TS `transformPylint(message, rules, opts, code)`。
pub fn transform_pylint(
    message: &str,
    rules: &RuleTable,
    opts: &EvalOptions,
    code: Option<&str>,
) -> String {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    let (prefix, desc) = match pylint_split(message) {
        Some(p) => p,
        None => ("", message),
    };
    let code_key = code.filter(|c| !c.is_empty()).unwrap_or(prefix);
    if !code_key.is_empty() {
        if let Some(variants) = rules.get(code_key) {
            if !variants.is_empty() {
                let picked = pick_variant(variants, code_key);
                return if prefix.is_empty() {
                    picked
                } else {
                    format!("{prefix}: {picked}")
                };
            }
        }
    }
    if !desc.trim().is_empty() && !desc.ends_with(&suffix) {
        let next = format!("{desc}{suffix}");
        return if prefix.is_empty() {
            next
        } else {
            format!("{prefix}: {next}")
        };
    }
    message.to_string()
}

// ──────────────────────────── JSON 行改写 ────────────────────────────

/// 行尾尾随部分：`\s*,?\s*$`（最左匹配）。
pub fn trailing_of(line: &str) -> &str {
    let cut = line.trim_end_matches(is_js_ws);
    if cut.ends_with(',') {
        let before = &cut[..cut.len() - 1];
        let content_end = before.trim_end_matches(is_js_ws);
        return &line[content_end.len()..];
    }
    &line[cut.len()..]
}

/// 从行首解析 `"KEY" : "VAL" ,?` 结构（捕获原文含转义），失败 → None。
fn parse_json_kv_line(line: &str) -> Option<(&str, &str)> {
    let b = line.as_bytes();
    let i = line[..].len() - line.trim_start_matches(is_js_ws).len();
    if i >= b.len() || b[i] != b'"' {
        return None;
    }
    let key_start = i + 1;
    let mut j = key_start;
    loop {
        if j >= b.len() {
            return None;
        }
        match b[j] {
            b'\\' => j += 2,
            b'"' => break,
            _ => j += 1,
        }
        if j > b.len() {
            return None;
        }
    }
    let key = &line[key_start..j];
    let mut p = j + 1;
    p += js_ws_len_at(&line[p..]);
    if p >= b.len() || b[p] != b':' {
        return None;
    }
    p += 1;
    p += js_ws_len_at(&line[p..]);
    if p >= b.len() || b[p] != b'"' {
        return None;
    }
    let val_start = p + 1;
    let mut q = val_start;
    loop {
        if q >= b.len() {
            return None;
        }
        match b[q] {
            b'\\' => q += 2,
            b'"' => break,
            _ => q += 1,
        }
        if q > b.len() {
            return None;
        }
    }
    let val = &line[val_start..q];
    let mut r = q + 1;
    r += js_ws_len_at(&line[r..]);
    if r < b.len() && b[r] == b',' {
        r += 1;
    }
    r += js_ws_len_at(&line[r..]);
    if r != b.len() {
        return None;
    }
    Some((key, val))
}

/// TS `patchJsonObject(content, rules, opts)`。
pub fn patch_json_object(content: &str, rules: &RuleTable, opts: &EvalOptions) -> NewPatchResult {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    let mut parts: Vec<String> = Vec::new();
    let b = content.as_bytes();
    let mut last = 0;
    let mut i = 0;
    while i < b.len() {
        let eol_len = if b[i] == b'\r' && i + 1 < b.len() && b[i + 1] == b'\n' {
            2
        } else if b[i] == b'\r' || b[i] == b'\n' {
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

    let mut hits = 0;
    let mut decorated = 0;
    let mut changed = false;
    for idx in (0..parts.len()).step_by(2) {
        let line = &parts[idx];
        let (key, val) = match parse_json_kv_line(line) {
            Some(kv) => kv,
            None => continue,
        };
        let indent = &line[..line.len() - line.trim_start().len()];
        let trailing = trailing_of(line);
        if let Some(variants) = rules.get(key) {
            if !variants.is_empty() {
                let cute = pick_variant(variants, key);
                if cute != val {
                    parts[idx] = format!("{indent}\"{key}\": \"{cute}\"{trailing}");
                    hits += 1;
                    changed = true;
                }
                continue;
            }
        }
        if !val.trim().is_empty()
            && !val.ends_with(&suffix)
            && !should_skip_decorate(val, opts.intensity)
        {
            parts[idx] = format!("{indent}\"{key}\": \"{val}{suffix}\"{trailing}");
            decorated += 1;
            changed = true;
        }
    }
    NewPatchResult {
        content: parts.concat(),
        hits,
        decorated,
        changed,
    }
}

// ──────────────────────────── packBundle ────────────────────────────

/// TS `patchPackBundle(content, rules, opts)`。
pub fn patch_pack_bundle(content: &str, rules: &RuleTable, opts: &EvalOptions) -> NewPatchResult {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    let mut root: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return patch_json_object(content, rules, opts),
    };
    let bundle = match root
        .get_mut("contents")
        .and_then(|c| c.get_mut("bundle"))
        .and_then(|v| v.as_object_mut())
    {
        Some(b) => b,
        None => {
            return NewPatchResult {
                content: content.to_string(),
                hits: 0,
                decorated: 0,
                changed: false,
            }
        }
    };
    let mut hits = 0;
    let mut decorated = 0;
    let mut changed = false;
    let keys: Vec<String> = bundle.keys().cloned().collect();
    for key in keys {
        let val = match bundle.get(&key).and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if let Some(variants) = rules.get(&key) {
            if !variants.is_empty() {
                let cute = pick_variant(variants, &key);
                if cute != val {
                    bundle.insert(key, serde_json::Value::String(cute));
                    hits += 1;
                    changed = true;
                }
                continue;
            }
        }
        if !val.trim().is_empty()
            && !val.ends_with(&suffix)
            && !val.ends_with('…')
            && !val.ends_with('~')
            && !should_skip_decorate(&val, opts.intensity)
        {
            bundle.insert(key, serde_json::Value::String(format!("{val}{suffix}")));
            decorated += 1;
            changed = true;
        }
    }
    if !changed {
        return NewPatchResult {
            content: content.to_string(),
            hits: 0,
            decorated: 0,
            changed: false,
        };
    }
    let compact = serde_json::to_string(&root).unwrap_or_else(|_| content.to_string());
    NewPatchResult {
        changed: compact != content,
        content: compact,
        hits,
        decorated,
    }
}

// ──────────────────────────── bundleTemplate ────────────────────────────

/// TS `patchBundleTemplate(content, rules, opts)`。
pub fn patch_bundle_template(
    content: &str,
    _rules: Option<&RuleTable>,
    opts: &EvalOptions,
) -> NewPatchResult {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());
    let bytes = content.as_bytes();
    let mut parts: Vec<String> = Vec::new();
    let mut decorated = 0;
    let mut hits = 0;
    let mut changed = false;
    let mut pos = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        // 找下一个反引号（m1/m2/m3 均不含反引号）
        let inner_start = i + 1;
        let inner_end = match bytes[inner_start..].iter().position(|&c| c == b'`') {
            Some(rel) => inner_start + rel,
            None => break,
        };
        let inner = &content[inner_start..inner_end];
        // 从右往左找可成立的 `${...}`（JS 贪婪 m1 → 最右有效）
        let mut m2: Option<(usize, usize)> = None;
        let mut scan = inner.len();
        while scan >= 2 {
            match inner[..scan].rfind("${") {
                Some(p) => {
                    let after = p + 2;
                    if let Some(rel) = inner[after..].find('}') {
                        let q = after + rel;
                        if q > after {
                            m2 = Some((p, q));
                            break;
                        }
                    }
                    scan = p;
                }
                None => break,
            }
        }
        match m2 {
            Some((p, q)) => {
                let full = [&inner[..p], &inner[q + 1..]].concat();
                parts.push(content[pos..i].to_string());
                if full.contains(&suffix) {
                    parts.push(content[i..=inner_end].to_string());
                } else {
                    decorated += 1;
                    hits += 1;
                    changed = true;
                    parts.push(format!("`{inner}{suffix}`"));
                }
                pos = inner_end + 1;
                i = inner_end + 1;
            }
            None => i += 1,
        }
    }
    parts.push(content[pos..].to_string());
    NewPatchResult {
        content: parts.concat(),
        hits,
        decorated,
        changed,
    }
}

// ──────────────────────────── tsDiag 表 ────────────────────────────

struct DiagMatch<'a> {
    ident: &'a str,
    msg_key: &'a str,
    whole: &'a str,
}

/// 手写复刻 JS 正则
/// `([A-Za-z_$][\w$]*)\s*:\s*diag\(\s*\d+\s*,\s*[^,]+?,\s*"K"\s*,\s*"T"\s*\)`。
fn find_diag_at(content: &str) -> Option<DiagMatch<'_>> {
    let b = content.as_bytes();
    if b.is_empty() || !(b[0].is_ascii_alphabetic() || b[0] == b'_' || b[0] == b'$') {
        return None;
    }
    let mut i = 1;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'$') {
        i += 1;
    }
    let ident = &content[..i];
    let mut p = i;
    let rest = &content[p..];
    let ws = js_ws_len_at(rest);
    p += ws;
    if p >= b.len() || b[p] != b':' {
        return None;
    }
    p += 1;
    p += js_ws_len_at(&content[p..]);
    if !content[p..].starts_with("diag(") {
        return None;
    }
    p += 5;
    p += js_ws_len_at(&content[p..]);
    let d_start = p;
    while p < b.len() && b[p].is_ascii_digit() {
        p += 1;
    }
    if p == d_start {
        return None;
    }
    p += js_ws_len_at(&content[p..]);
    if p >= b.len() || b[p] != b',' {
        return None;
    }
    p += 1;
    // 段（\s* + [^,]+?）：到下一个逗号，至少 1 字节
    let seg_start = p;
    let next_comma = content[p..].find(',')? + p;
    if next_comma == seg_start {
        return None;
    }
    p = next_comma + 1;
    p += js_ws_len_at(&content[p..]);
    if p >= b.len() || b[p] != b'"' {
        return None;
    }
    // KEY
    let k_start = p + 1;
    let mut j = k_start;
    loop {
        if j >= b.len() {
            return None;
        }
        match b[j] {
            b'\\' => j += 2,
            b'"' => break,
            _ => j += 1,
        }
        if j > b.len() {
            return None;
        }
    }
    let msg_key = &content[k_start..j];
    p = j + 1;
    p += js_ws_len_at(&content[p..]);
    if p >= b.len() || b[p] != b',' {
        return None;
    }
    p += 1;
    p += js_ws_len_at(&content[p..]);
    if p >= b.len() || b[p] != b'"' {
        return None;
    }
    // TEXT
    let t_start = p + 1;
    let mut k = t_start;
    loop {
        if k >= b.len() {
            return None;
        }
        match b[k] {
            b'\\' => k += 2,
            b'"' => break,
            _ => k += 1,
        }
        if k > b.len() {
            return None;
        }
    }
    p = k + 1;
    p += js_ws_len_at(&content[p..]);
    if p >= b.len() || b[p] != b')' {
        return None;
    }
    p += 1;
    Some(DiagMatch {
        ident,
        msg_key,
        whole: &content[..p],
    })
}

/// 引号体语法 `(?:[^"\\]|\\.)*[^"\\]`（非空、末单位是单字符而非转义对）。
fn body_ok(body: &str) -> bool {
    let b = body.as_bytes();
    let mut i = 0;
    let mut last_was_pair = true;
    while i < b.len() {
        if b[i] == b'\\' {
            if i + 1 >= b.len() {
                return false;
            }
            i += 2;
            last_was_pair = true;
        } else {
            i += 1;
            last_was_pair = false;
        }
    }
    !last_was_pair
}

/// `"text"` 后接 `\s*\)` 的匹配（JS replace 全局，返回 (匹配起, 匹配止, 体)）。
/// 起点失败（体语法坏/反斜杠遇行终止符）时前进到下一引号，与正则引擎一致。
fn next_string_paren(content: &str, from: usize) -> Option<(usize, usize, &str)> {
    let bytes = content.as_bytes();
    let mut start = from;
    while start < bytes.len() {
        if bytes[start] != b'"' {
            start += 1;
            continue;
        }
        // 体：到第一个未转义引号
        let mut j = start + 1;
        let mut bad = false;
        loop {
            if j >= bytes.len() {
                bad = true;
                break;
            }
            match bytes[j] {
                b'\\' => {
                    if j + 1 >= bytes.len() {
                        bad = true;
                        break;
                    }
                    let n = bytes[j + 1];
                    // JS `\\.` 不匹配 \n \r    
                    let is_line_term = n == b'\n'
                        || n == b'\r'
                        || (n == 0xE2
                            && bytes.get(j + 2) == Some(&0x80)
                            && (bytes.get(j + 3) == Some(&0xA8)
                                || bytes.get(j + 3) == Some(&0xA9)));
                    if is_line_term {
                        bad = true;
                        break;
                    }
                    j += 2;
                }
                b'"' => break,
                _ => j += 1,
            }
        }
        if bad {
            start += 1;
            continue;
        }
        let body = &content[start + 1..j];
        if body_ok(body) {
            let mut p = j + 1;
            p += js_ws_len_at(&content[p..]);
            if p < bytes.len() && bytes[p] == b')' {
                return Some((start, p + 1, body));
            }
        }
        start += 1;
    }
    None
}

/// TS `patchTsDiag(content, rules, opts)`。
pub fn patch_ts_diag(content: &str, rules: &RuleTable, opts: &EvalOptions) -> NewPatchResult {
    let suffix = get_fallback_suffix(opts.persona, opts.custom_fallback.as_deref());

    // pass1：diag 命中替换
    let mut parts: Vec<String> = Vec::new();
    let mut hits = 0;
    let mut changed1 = false;
    let mut pos = 0usize;
    let mut scan_from = 0usize;
    loop {
        // 从 scan_from 找下一个可匹配起点（仅 ident 起始字符）
        let mut start: Option<usize> = None;
        let mut k = scan_from;
        let bytes = content.as_bytes();
        while k < bytes.len() {
            let c = bytes[k];
            if c.is_ascii_alphabetic() || c == b'_' || c == b'$' {
                if let Some(m) = find_diag_at(&content[k..]) {
                    start = Some(k);
                    let whole_range = (k, k + m.whole.len());
                    // 重建（与 TS 相同构造）
                    parts.push(content[pos..whole_range.0].to_string());
                    let after_key = match m.whole.find(m.msg_key) {
                        Some(idx) => &m.whole[idx + m.msg_key.len()..],
                        None => "",
                    };
                    let cat_end = after_key.find("\",");
                    let slice = match cat_end {
                        Some(idx) => &after_key[..idx + 1],
                        None => "",
                    };
                    let variants = rules.get(m.msg_key);
                    if let Some(vs) = variants {
                        if !vs.is_empty() {
                            let cute = pick_variant(vs, m.msg_key);
                            let esc = cute.replace('\\', "\\\\").replace('"', "\\\"");
                            parts.push(format!("{}: diag({}\"{}\")", m.ident, slice, esc));
                            hits += 1;
                            changed1 = true;
                        } else {
                            parts.push(m.whole.to_string());
                        }
                    } else {
                        parts.push(m.whole.to_string());
                    }
                    pos = whole_range.1;
                    scan_from = whole_range.1;
                    break;
                }
            }
            k += 1;
        }
        match start {
            Some(_) => continue,
            None => break,
        }
    }
    parts.push(content[pos..].to_string());
    let after_pass1 = parts.concat();

    // pass2：字符串兜底装饰（`"text"` + \s*)）
    let mut out: Vec<String> = Vec::new();
    let mut decorated = 0;
    let mut changed2 = false;
    let mut pos = 0usize;
    let mut from = 0usize;
    while let Some((s, e, body)) = next_string_paren(&after_pass1, from) {
        out.push(after_pass1[pos..s].to_string());
        let utf16_len = body.encode_utf16().count();
        if !body.contains(&suffix)
            && utf16_len > 3
            && !should_skip_decorate(body, opts.intensity)
        {
            out.push(format!("\"{body} {suffix}\")"));
            decorated += 1;
            changed2 = true;
        } else {
            out.push(after_pass1[s..e].to_string());
        }
        pos = e;
        from = e;
    }
    out.push(after_pass1[pos..].to_string());

    let final_content = out.concat();
    NewPatchResult {
        changed: changed1 || changed2 || final_content != content,
        content: final_content,
        hits,
        decorated,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::EvalOptions;

    fn opts() -> EvalOptions {
        EvalOptions::default()
    }

    fn table(pairs: &[(&str, &[&str])]) -> RuleTable {
        pairs
            .iter()
            .map(|(k, vs)| (k.to_string(), vs.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn md_hit_replaces_description() {
        let rules = table(&[("MD013", &["行太长了啦~", "行长度超标了喵~"])]);
        let out = transform_markdownlint("MD013: Line length", &rules, &opts(), None);
        let picked = pick_variant(rules.get("MD013").unwrap(), "MD013");
        assert_eq!(out, format!("MD013: {picked}"));
    }

    #[test]
    fn md_fallback_appends_suffix() {
        let out = transform_markdownlint(
            "MD999: Unknown rule",
            &RuleTable::new(),
            &opts(),
            None,
        );
        assert_eq!(out, "MD999: Unknown rule ~");
    }

    #[test]
    fn md_detail_kept_after_hit() {
        let rules = table(&[("Line too long", &["行太长了喵~"])]);
        let out = transform_markdownlint(
            "MD013/line-length: Line too long [121 > 80]",
            &rules,
            &opts(),
            None,
        );
        assert_eq!(out, "MD013/line-length: 行太长了喵~ [121 > 80]");
    }

    #[test]
    fn md_code_hit_without_prefix() {
        let rules = table(&[("MD013", &["行太长了喵~"])]);
        let out = transform_markdownlint(
            "Line too long",
            &rules,
            &opts(),
            Some("MD013"),
        );
        assert_eq!(out, "行太长了喵~");
    }

    #[test]
    fn md_no_match_keeps_detail_and_appends_at_end() {
        let out = transform_markdownlint(
            "MD013/line-length: Line too long [999 > 80]",
            &RuleTable::new(),
            &opts(),
            None,
        );
        assert_eq!(out, "MD013/line-length: Line too long [999 > 80] ~");
    }

    #[test]
    fn pylint_hit_and_fallback() {
        let rules = table(&[("C0114", &["缺少模块文档啦~", "模块文档不见咯~"])]);
        let out = transform_pylint("C0114: Missing module docstring", &rules, &opts(), None);
        assert!(out.starts_with("C0114: "));
        assert_ne!(out, "C0114: Missing module docstring");

        let out = transform_pylint("Z9999: Unknown", &RuleTable::new(), &opts(), None);
        assert_eq!(out, "Z9999: Unknown ~");

        let out = transform_pylint("Missing module docstring", &RuleTable::new(), &opts(), None);
        assert_eq!(out, "Missing module docstring ~");

        let rules = table(&[("missing-module-docstring", &["缺少模块文档喵~"])]);
        let out = transform_pylint(
            "Missing module docstring",
            &rules,
            &opts(),
            Some("missing-module-docstring"),
        );
        assert_eq!(out, "缺少模块文档喵~");
    }

    #[test]
    fn json_object_hit_decorate_and_idempotent() {
        let rules = table(&[("key_a", &["替代文案A", "替代文案B"])]);
        let content = "{\n  \"key_a\": \"原文案\",\n  \"key_b\": \"无规则文案\",\n  \"key_c\": null\n}\n";
        let mut o = opts();
        o.custom_fallback = Some(" 喵~".to_string());
        let res = patch_json_object(content, &rules, &o);
        assert!(res.changed);
        assert!(res.content.contains("替代文案"), "{}", res.content);
        assert!(res.content.contains("无规则文案 喵~"), "{}", res.content);
        assert!(res.content.contains("null"), "{}", res.content);
        let res2 = patch_json_object(&res.content, &rules, &o);
        assert!(!res2.changed, "二次改写不应变化");
    }

    #[test]
    fn json_object_key_with_value_substring() {
        let rules = table(&[("value", &["可爱的值喵~"])]);
        let input = "{\n  \"value\": \"value\"\n}\n";
        let res = patch_json_object(input, &rules, &opts());
        assert_eq!(res.content, "{\n  \"value\": \"可爱的值喵~\"\n}\n");
        serde_json::from_str::<serde_json::Value>(&res.content).unwrap();
    }

    #[test]
    fn pack_bundle_only_touches_bundle() {
        let rules = table(&[("key_a", &["改版 A"])]);
        let content =
            "{\"\":\"license\",\"version\":\"1.0.0\",\"contents\":{\"bundle\":{\"key_a\":\"原文\",\"key_b\":\"无规则\"}}}";
        let res = patch_pack_bundle(content, &rules, &opts());
        assert!(res.changed);
        assert!(res.content.contains("\"key_a\":\"改版 A\""), "{}", res.content);
        assert!(res.content.contains("\"version\":\"1.0.0\""));
        assert!(res.content.contains("\"\":\"license\""));
        assert!(res.content.contains("key_b"));
        let res2 = patch_pack_bundle(&res.content, &rules, &opts());
        assert!(!res2.changed, "二次改写不应变化");
    }

    #[test]
    fn bundle_template_appends_inside() {
        let content = r#"l10n.t("other") + `Unknown at rule @${name}`;"#;
        let mut o = opts();
        o.custom_fallback = Some(" 喵~".to_string());
        let res = patch_bundle_template(content, None, &o);
        assert!(res.changed);
        assert!(res.content.contains("Unknown at rule @${name} 喵~"), "{}", res.content);
        let res2 = patch_bundle_template(&res.content, None, &o);
        assert!(!res2.changed, "二次改写不应变化");
    }

    #[test]
    fn ts_diag_fallback_decorates_english_text() {
        let content = "const foo: diag(100, ts.Diagnostics.x, \"msgKey\", \"English text\");\n";
        let res = patch_ts_diag(content, &RuleTable::new(), &opts());
        assert!(res.changed);
        assert!(res.content.contains("English text  ~"), "{}", res.content);
    }
}

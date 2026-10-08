//! fastpath 语料：0.1.x–0.8.x 精确匹配查表（0.9.0 编译成 `.kawaii` 后删除）。
//!
//! 数据由 `scripts/build-fastpath.mjs` 从 `out/rules.generated.js` 导出：
//! - `data/fastpath.tsv`：`key \t 变体1 \t 变体2 ...`（字段内 `\` tab 换行转义）
//! - `data/identity.txt`：参考保持片段（一行一个，同转义）

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

static TSV: &str = include_str!("../../../data/fastpath.tsv");
static IDENTITY_TXT: &str = include_str!("../../../data/identity.txt");

struct Corpus {
    rules: HashMap<String, Vec<String>>,
    cute: HashSet<String>,
    identity: HashSet<String>,
}

fn unescape(s: &str) -> String {
    if !s.contains('\\') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('t') => out.push('\t'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn corpus() -> &'static Corpus {
    static CELL: OnceLock<Corpus> = OnceLock::new();
    CELL.get_or_init(|| {
        let mut rules: HashMap<String, Vec<String>> = HashMap::new();
        let mut cute: HashSet<String> = HashSet::new();
        for line in TSV.lines() {
            if line.is_empty() {
                continue;
            }
            let mut fields = line.split('\t');
            let key = unescape(fields.next().unwrap_or(""));
            let variants: Vec<String> = fields.map(|f| unescape(f)).collect();
            for v in &variants {
                cute.insert(v.clone());
            }
            rules.insert(key, variants);
        }
        let mut identity = HashSet::new();
        for line in IDENTITY_TXT.lines() {
            if !line.is_empty() {
                identity.insert(unescape(line));
            }
        }
        Corpus { rules, cute, identity }
    })
}

/// 精确查表：命中返回变体列表。
pub fn lookup(key: &str) -> Option<&'static [String]> {
    corpus().rules.get(key).map(|v| v.as_slice())
}

/// 是否为规则产物（幂等保护 `already`）。
pub fn is_cute(value: &str) -> bool {
    corpus().cute.contains(value)
}

/// 是否为参考保持片段（拼接片段等，绝不装饰）。
pub fn is_identity(value: &str) -> bool {
    corpus().identity.contains(value)
}

/// 规则键数（统计/断言用）。
pub fn rules_count() -> usize {
    corpus().rules.len()
}

/// 枚举全部规则键（测试/工具用）。
pub fn all_keys() -> impl Iterator<Item = &'static str> {
    corpus().rules.keys().map(|s| s.as_str())
}

//! 极简扁平 JSON 对象解析——引擎 opts 输入专用，core 保持零依赖红线。
//!
//! 支持 `{"k": "v", "b": true, "n": null, "x": 1.5}` 扁平面；嵌套/数组一律报错（fail loud）。
//! 数字只为未知字段前向兼容，opts 已知字段遇到数字仍报类型错。

/// 解析出的标量值。
#[derive(Debug, Clone, PartialEq)]
pub enum JVal {
    Str(String),
    Bool(bool),
    Num(f64),
    Null,
}

/// 解析扁平 JSON 对象，返回键值序列（保持出现顺序）。
pub fn parse_flat_object(src: &str) -> Result<Vec<(String, JVal)>, String> {
    let mut i = 0usize;
    let mut entries = Vec::new();
    skip_ws(src, &mut i);
    expect_char(src, &mut i, '{')?;
    skip_ws(src, &mut i);
    if peek(src, i) == Some('}') {
        i += 1;
    } else {
        loop {
            skip_ws(src, &mut i);
            let key = parse_string(src, &mut i)?;
            skip_ws(src, &mut i);
            expect_char(src, &mut i, ':')?;
            skip_ws(src, &mut i);
            let val = parse_value(src, &mut i)?;
            entries.push((key, val));
            skip_ws(src, &mut i);
            match peek(src, i) {
                Some(',') => i += 1,
                Some('}') => {
                    i += 1;
                    break;
                }
                Some(c) => return Err(format!("位置 {} 期望 `,` 或 `}}`，得到 `{}`", i, c)),
                None => return Err("JSON 在对象内意外结束".to_string()),
            }
        }
    }
    skip_ws(src, &mut i);
    if i != src.len() {
        return Err(format!("位置 {} 有多余内容", i));
    }
    Ok(entries)
}

/// 取字符串字段。
pub fn get_str<'a>(entries: &'a [(String, JVal)], key: &str) -> Option<&'a str> {
    entries.iter().find_map(|(k, v)| match v {
        JVal::Str(s) if k == key => Some(s.as_str()),
        _ => None,
    })
}

/// 取布尔字段。
pub fn get_bool(entries: &[(String, JVal)], key: &str) -> Option<bool> {
    entries.iter().find_map(|(k, v)| match v {
        JVal::Bool(b) if k == key => Some(*b),
        _ => None,
    })
}

fn parse_value(src: &str, i: &mut usize) -> Result<JVal, String> {
    match peek(src, *i) {
        Some('"') => parse_string(src, i).map(JVal::Str),
        Some('t') => {
            eat_literal(src, i, "true")?;
            Ok(JVal::Bool(true))
        }
        Some('f') => {
            eat_literal(src, i, "false")?;
            Ok(JVal::Bool(false))
        }
        Some('n') => {
            eat_literal(src, i, "null")?;
            Ok(JVal::Null)
        }
        Some(c) if c == '-' || c.is_ascii_digit() => parse_number(src, i),
        Some(c) => Err(format!("位置 {} 不支持的 JSON 值 `{}`", i, c)),
        None => Err("意外的输入结束".to_string()),
    }
}

/// 数字：`-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?`——opts 面不用，仅为未知字段前向兼容。
fn parse_number(src: &str, i: &mut usize) -> Result<JVal, String> {
    let start = *i;
    let b = src.as_bytes();
    if b.get(*i) == Some(&b'-') {
        *i += 1;
    }
    let digits_start = *i;
    while *i < b.len() && b[*i].is_ascii_digit() {
        *i += 1;
    }
    if *i == digits_start {
        return Err(format!("位置 {} 数字格式非法", start));
    }
    if b.get(*i) == Some(&b'.') {
        *i += 1;
        let frac_start = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        if *i == frac_start {
            return Err(format!("位置 {} 小数点后缺数字", start));
        }
    }
    if matches!(b.get(*i), Some(b'e') | Some(b'E')) {
        *i += 1;
        if matches!(b.get(*i), Some(b'+') | Some(b'-')) {
            *i += 1;
        }
        let exp_start = *i;
        while *i < b.len() && b[*i].is_ascii_digit() {
            *i += 1;
        }
        if *i == exp_start {
            return Err(format!("位置 {} 指数缺数字", start));
        }
    }
    src[start..*i]
        .parse::<f64>()
        .map(JVal::Num)
        .map_err(|_| format!("`{}` 不是合法数字", &src[start..*i]))
}

fn parse_string(src: &str, i: &mut usize) -> Result<String, String> {
    expect_char(src, i, '"')?;
    let mut out = String::new();
    loop {
        let c = peek(src, *i).ok_or_else(|| "字符串未闭合".to_string())?;
        *i += c.len_utf8();
        match c {
            '"' => return Ok(out),
            '\\' => {
                let e = peek(src, *i).ok_or_else(|| "转义序列未结束".to_string())?;
                *i += e.len_utf8();
                match e {
                    '"' => out.push('"'),
                    '\\' => out.push('\\'),
                    '/' => out.push('/'),
                    'b' => out.push('\u{0008}'),
                    'f' => out.push('\u{000c}'),
                    'n' => out.push('\n'),
                    'r' => out.push('\r'),
                    't' => out.push('\t'),
                    'u' => out.push(parse_hex4(src, i)?),
                    other => return Err(format!("未知转义 `\\{}`", other)),
                }
            }
            c if (c as u32) < 0x20 => return Err("字符串含裸控制字符".to_string()),
            c => out.push(c),
        }
    }
}

/// 读 4 位十六进制；处理 UTF-16 代理对。
fn parse_hex4(src: &str, i: &mut usize) -> Result<char, String> {
    let hi = read_hex4(src, i)?;
    if (0xD800..=0xDBFF).contains(&hi) {
        // 高代理项：期望紧随 \uDC00-\uDFFF
        let bs = src.as_bytes().get(*i..*i + 2).ok_or("代理对不完整")?;
        if bs[0] != b'\\' || bs[1] != b'u' {
            return Err("高代理项后缺少 \\u 低代理项".to_string());
        }
        *i += 2;
        let lo = read_hex4(src, i)?;
        if !(0xDC00..=0xDFFF).contains(&lo) {
            return Err("低代理项取值非法".to_string());
        }
        let u = 0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00);
        return char::from_u32(u).ok_or_else(|| "代理对不是合法码点".to_string());
    }
    char::from_u32(hi).ok_or_else(|| format!("\\u{:04x} 不是合法码点", hi))
}

fn read_hex4(src: &str, i: &mut usize) -> Result<u32, String> {
    let s = src.get(*i..*i + 4).ok_or_else(|| "\\u 后不足 4 位十六进制".to_string())?;
    let v = u32::from_str_radix(s, 16).map_err(|_| format!("`\\u{}` 不是合法十六进制", s))?;
    *i += 4;
    Ok(v)
}

fn eat_literal(src: &str, i: &mut usize, lit: &str) -> Result<(), String> {
    if src[*i..].starts_with(lit) {
        *i += lit.len();
        Ok(())
    } else {
        Err(format!("位置 {} 期望 `{}`", i, lit))
    }
}

fn expect_char(src: &str, i: &mut usize, want: char) -> Result<(), String> {
    match peek(src, *i) {
        Some(c) if c == want => {
            *i += want.len_utf8();
            Ok(())
        }
        Some(c) => Err(format!("位置 {} 期望 `{}`，得到 `{}`", i, want, c)),
        None => Err(format!("位置 {} 期望 `{}`，输入已结束", i, want)),
    }
}

fn peek(src: &str, i: usize) -> Option<char> {
    src[i..].chars().next()
}

fn skip_ws(src: &str, i: &mut usize) {
    while let Some(c) = src[*i..].chars().next() {
        if c.is_whitespace() {
            *i += c.len_utf8();
        } else {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flat_object() {
        let e = parse_flat_object(r#"{"a": "x", "b": true, "c": false, "d": null}"#).expect("合法");
        assert_eq!(get_str(&e, "a"), Some("x"));
        assert_eq!(get_bool(&e, "b"), Some(true));
        assert_eq!(get_bool(&e, "c"), Some(false));
        assert!(matches!(e[3].1, JVal::Null));
        assert_eq!(e.len(), 4);
    }

    #[test]
    fn empty_object_and_ws() {
        assert!(parse_flat_object("  { }  ").expect("空对象").is_empty());
        assert!(parse_flat_object("{}").expect("空对象").is_empty());
    }

    #[test]
    fn escapes_and_unicode() {
        let e = parse_flat_object(r#"{"k": "a\"b\\c\n\u0041\u4e2d"}"#).expect("合法");
        assert_eq!(get_str(&e, "k"), Some("a\"b\\c\nA中"));
        // 代理对
        let e = parse_flat_object(r#"{"e": "\ud83d\ude00"}"#).expect("合法");
        assert_eq!(get_str(&e, "e"), Some("😀"));
    }

    #[test]
    fn numbers_parse_for_forward_compat() {
        let e = parse_flat_object(r#"{"n": -1.5e2, "z": 0}"#);
        let e = e.expect("合法数字");
        assert_eq!(e[0].1, JVal::Num(-150.0));
        assert_eq!(e[1].1, JVal::Num(0.0));
        assert!(parse_flat_object(r#"{"bad": 1.}"#).is_err());
        assert!(parse_flat_object(r#"{"bad": .5}"#).is_err());
        assert!(parse_flat_object(r#"{"bad": 1e}"#).is_err());
    }

    #[test]
    fn rejects_bad_json() {
        assert!(parse_flat_object("").is_err());
        assert!(parse_flat_object("{").is_err());
        assert!(parse_flat_object(r#"{"a": [1]}"#).is_err(), "数组不支持");
        assert!(parse_flat_object(r#"{"a": {} }"#).is_err(), "嵌套不支持");
        assert!(parse_flat_object(r#"{"a": "x" "b": "y"}"#).is_err(), "缺逗号");
        assert!(parse_flat_object(r#"{"a": "x"} extra"#).is_err(), "尾随内容");
        assert!(parse_flat_object(r#"{"a": tru}"#).is_err());
    }
}

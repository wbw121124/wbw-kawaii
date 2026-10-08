//! Rule DSL 词法器：无损切分（每个字节都归入某个 Token）。

use super::kinds::RuleSyntaxKind as K;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token<'a> {
    pub kind: K,
    pub text: &'a str,
}

/// 切分整个源文件。永不 panic：未知字符归入单字符 `Punct`。
pub fn tokenize(src: &str) -> Vec<Token<'_>> {
    let mut out = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let start = i;
        let c = src[i..].chars().next().expect("i 在字符边界上");
        let kind = if c.is_whitespace() {
            while i < bytes.len() {
                let ch = src[i..].chars().next().unwrap();
                if !ch.is_whitespace() {
                    break;
                }
                i += ch.len_utf8();
            }
            K::Whitespace
        } else if src[i..].starts_with("//") {
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            K::Comment
        } else if c == '"' {
            i += 1;
            let mut closed = false;
            while i < bytes.len() {
                let ch = src[i..].chars().next().unwrap();
                if ch == '"' {
                    i += 1;
                    closed = true;
                    break;
                }
                if ch == '\n' {
                    break; // 单行字符串：未闭合也停在行尾（容错）
                }
                i += ch.len_utf8();
            }
            let _ = closed;
            K::Str
        } else if c.is_ascii_digit() {
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            K::Number
        } else if c.is_ascii_alphabetic() || c == '_' {
            i += 1;
            while i < bytes.len() {
                let b = bytes[i];
                if b.is_ascii_alphanumeric() || b == b'_' {
                    i += 1;
                } else {
                    break;
                }
            }
            K::Ident
        } else if src[i..].starts_with("||") {
            i += 2;
            K::OrOr
        } else if src[i..].starts_with("&&") {
            i += 2;
            K::AndAnd
        } else if c == '!' {
            i += 1;
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
                K::Cmp
            } else {
                K::Bang
            }
        } else if c == '=' {
            i += 1;
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
                K::Cmp
            } else {
                K::Punct // 孤立 '='：错误诊断时可见
            }
        } else if c == '<' || c == '>' {
            i += 1;
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
            }
            K::Cmp
        } else {
            let kind = match c {
                '{' => K::LBrace,
                '}' => K::RBrace,
                '(' => K::LParen,
                ')' => K::RParen,
                ';' => K::Semi,
                ',' => K::Comma,
                _ => K::Punct,
            };
            i += c.len_utf8();
            kind
        };
        out.push(Token {
            kind,
            text: &src[start..i],
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<K> {
        tokenize(src).into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn roundtrip_lossless() {
        let src = "// 注释\ntts_hint {\n  match { text_contains(\"foo\") }\n}\n";
        assert_eq!(
            tokenize(src).iter().map(|t| t.text).collect::<String>(),
            src
        );
    }

    #[test]
    fn operators_and_strings() {
        let ks = kinds(r#"a != 1 && b >= 2 || !c"#);
        assert!(ks.contains(&K::Ident));
        assert!(ks.contains(&K::Cmp));
        assert!(ks.contains(&K::AndAnd));
        assert!(ks.contains(&K::OrOr));
        assert!(ks.contains(&K::Bang));
    }

    #[test]
    fn punctuation_variants() {
        let ks = kinds("{}();,");
        assert_eq!(
            ks,
            vec![K::LBrace, K::RBrace, K::LParen, K::RParen, K::Semi, K::Comma]
        );
    }
}

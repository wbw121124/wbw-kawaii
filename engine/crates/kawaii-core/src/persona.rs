//! 人设与可爱强度——与仓库根 `src/persona.ts`、`src/kawaii-options.ts` 对齐。

/// 人设风格（对应配置 `wbw-kawaii.personaStyle`）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PersonaStyle {
    Soft,
    Tsundere,
    Derriere,
    Cool,
}

impl PersonaStyle {
    /// 从配置字符串解析；未知值回退 `soft`（与 TS `getPersona` 一致）。
    pub fn parse(s: &str) -> Self {
        match s {
            "tsundere" => Self::Tsundere,
            "derriere" => Self::Derriere,
            "cool" => Self::Cool,
            _ => Self::Soft,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Soft => "soft",
            Self::Tsundere => "tsundere",
            Self::Derriere => "derriere",
            Self::Cool => "cool",
        }
    }
}

/// 人设静态数据。
pub struct Persona {
    pub name: &'static str,
    pub fallback_suffix: &'static str,
    pub easter_egg_message: &'static str,
    pub status_emoji: &'static str,
}

const SOFT: Persona = Persona {
    name: "软萌",
    fallback_suffix: " ~",
    easter_egg_message: "你不要再批话了，不然我就不理你了~",
    status_emoji: "🌸",
};
const TSUNDERE: Persona = Persona {
    name: "傲娇",
    fallback_suffix: " 哼~",
    easter_egg_message: "哼，笨蛋！再这样说就不理你了哦~",
    status_emoji: "🔥",
};
const DERRIERE: Persona = Persona {
    name: "毒舌",
    fallback_suffix: " ……真是的",
    easter_egg_message: "……真是的，别说了啦。",
    status_emoji: "😒",
};
const COOL: Persona = Persona {
    name: "冷淡可爱",
    fallback_suffix: "",
    easter_egg_message: "",
    status_emoji: "❄️",
};

/// 取人设数据（未知风格回退 soft）。
pub fn get_persona(style: PersonaStyle) -> &'static Persona {
    match style {
        PersonaStyle::Soft => &SOFT,
        PersonaStyle::Tsundere => &TSUNDERE,
        PersonaStyle::Derriere => &DERRIERE,
        PersonaStyle::Cool => &COOL,
    }
}

/// 全部人设风格（cyclePersona 循环用）。
pub fn all_persona_styles() -> [PersonaStyle; 4] {
    [
        PersonaStyle::Soft,
        PersonaStyle::Tsundere,
        PersonaStyle::Derriere,
        PersonaStyle::Cool,
    ]
}

/// 兜底后缀：`custom` 覆盖人设后缀（对应 TS `getFallbackSuffix`）。
pub fn get_fallback_suffix(style: PersonaStyle, custom: Option<&str>) -> String {
    match custom {
        Some(s) => s.to_string(),
        None => get_persona(style).fallback_suffix.to_string(),
    }
}

/// 可爱强度（对应配置 `wbw-kawaii.intensity`）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KawaiiIntensity {
    Subtle,
    Normal,
    Bold,
}

impl KawaiiIntensity {
    pub fn parse(s: &str) -> Self {
        match s {
            "subtle" => Self::Subtle,
            "bold" => Self::Bold,
            _ => Self::Normal,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Subtle => "subtle",
            Self::Normal => "normal",
            Self::Bold => "bold",
        }
    }
}

/// 是否跳过装饰（对应 TS `shouldSkipDecorate`）：
/// bold / normal 从不跳过；subtle 且去掉 `{数字}` 占位符后纯文本（UTF-16 计数）<= 8 时跳过。
pub fn should_skip_decorate(value: &str, intensity: KawaiiIntensity) -> bool {
    match intensity {
        KawaiiIntensity::Bold | KawaiiIntensity::Normal => false,
        KawaiiIntensity::Subtle => strip_brace_placeholders(value).encode_utf16().count() <= 8,
    }
}

/// 移除 `{数字}` 占位符（与 TS 正则 `/\{\d+\}/g` 一致，只匹配纯数字）。
fn strip_brace_placeholders(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(rel) = value[i + 1..].find('}') {
                let inner = &value[i + 1..i + 1 + rel];
                if !inner.is_empty() && inner.bytes().all(|b| b.is_ascii_digit()) {
                    i = i + 1 + rel + 1;
                    continue;
                }
            }
        }
        let c = value[i..].chars().next().expect("i 在字符边界上");
        out.push(c);
        i += c.len_utf8();
    }
    out
}

/// 颤音彩蛋关键词（对应 TS `WHIMPER_KEYWORDS`）。
pub const WHIMPER_KEYWORDS: [&str; 17] = [
    "我太菜了",
    "我是蒟蒻",
    "我是蛆",
    "我是虫",
    "我连蛆都不如",
    "太菜了",
    "太弱了",
    "弱爆了",
    "不会写",
    "好菜",
    "我太弱了",
    "不会",
    "太笨了",
    "笨死了",
    "菜鸡",
    "蒟蒻",
    "",
];

/// 是否命中颤音关键词（对应 TS `isWhimperInput`；末位空串按原文剔除）。
pub fn is_whimper_input(text: &str) -> bool {
    WHIMPER_KEYWORDS
        .iter()
        .filter(|kw| !kw.is_empty())
        .any(|kw| text.contains(kw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persona_lookup_matches_ts() {
        assert_eq!(get_persona(PersonaStyle::Soft).fallback_suffix, " ~");
        assert_eq!(get_persona(PersonaStyle::Tsundere).fallback_suffix, " 哼~");
        assert_eq!(get_persona(PersonaStyle::Derriere).fallback_suffix, " ……真是的");
        assert_eq!(get_persona(PersonaStyle::Cool).fallback_suffix, "");
        assert_eq!(PersonaStyle::parse("unknown"), PersonaStyle::Soft);
    }

    #[test]
    fn custom_fallback_overrides_persona() {
        assert_eq!(
            get_fallback_suffix(PersonaStyle::Soft, Some("（自定义）")),
            "（自定义）"
        );
        assert_eq!(get_fallback_suffix(PersonaStyle::Soft, None), " ~");
    }

    #[test]
    fn skip_decorate_matrix_matches_ts() {
        // bold / normal 永不跳过
        assert!(!should_skip_decorate("短", KawaiiIntensity::Bold));
        assert!(!should_skip_decorate("短", KawaiiIntensity::Normal));
        // subtle：纯文本 <= 8 跳过
        assert!(should_skip_decorate("找不到", KawaiiIntensity::Subtle));
        assert!(should_skip_decorate("{0} 啊", KawaiiIntensity::Subtle));
        assert!(!should_skip_decorate("这句文案明显超过八个字符了", KawaiiIntensity::Subtle));
        // 占位符不计入长度：{0} 去掉后剩 4 个字
        assert!(should_skip_decorate("{0}四个汉字了", KawaiiIntensity::Subtle));
    }

    #[test]
    fn whimper_keywords() {
        assert!(is_whimper_input("呜呜我太菜了"));
        assert!(is_whimper_input("菜鸡"));
        assert!(!is_whimper_input("正常报错"));
    }
}

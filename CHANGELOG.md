# Changelog

## 0.1.0

- 首个版本：
  - 运行时对当前安装的 cpptools `messages.json` 就地改写（规则表按原文直接 replace + 正则兜底装饰）；
  - 双基准规则表（cpptools 1.34.4 + 1.19.7，zh-cn），三版本实测覆盖 ≥ 94%；
  - 自动备份 / 还原、版本变化自动重打、状态统计命令；
  - 保留原文件格式（UTF-8 无 BOM、CRLF、缩进、null 条目）。

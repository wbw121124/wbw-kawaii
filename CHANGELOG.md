# Changelog

## 0.2.0

- 新增：扩展覆盖范围至 **TypeScript / JavaScript / CSS / HTML / XHTML** 报错文案（与 cpptools 并列）；
- 新增：规则源由子代理按 hash 选创意角度重写（6 种句式：省略补白 / 语序调整 / 同义替换 / 句式转换 / 语气词点缀 / 口语化），变体不再单调；
- 新增：语言包（`ms-ceintl.vscode-language-pack-zh-hans`）CSS/HTML 252 条全可爱化；
- 新增：zh-cn 门控——**非 zh-cn 界面下自动还原** TS/CSS/HTML 补丁并弹通知，en 界面保持英文原文；
- 新增：`targets-manifest.json` 卸载清单，卸载后能还原所有目标文件；
- 新增：`extract:inputs` / `regenerate-rules` / `finalize:chunks` 等开发脚本；
- 修复：`patchJsonObject` / `patchBundleTemplate` 正则 bug（value 替换位置错误、`${...}` 插值被吞掉）；
- 修复：TS 规则源占位符严格校验（build-rules 拒绝源-变体 token 序列不一致的条目）；
- 变更：`RULES_VERSION` 现在覆盖 cpptools + TS + PACK 全部规则，变更时统一触发回滚重打。

## 0.1.1

- 修复：参考文案原样保留（identity）的拼接片段不再被兜底后缀注进消息中间 —— `变量`、` (已声明 `、`所在行数:` 等 180 条片段保持原样，组合消息里不再出现「中间 喵~」和多余空格；
- 修复：规则表更新后先从备份取回原文再改写，旧版改写产物不会挡住新规则落地；
- 修复：空串/纯空白条目不再追加后缀；
- 新增：卸载时自动还原 —— `vscode:uninstall` 钩子在卸载后的下一次**完全重启** VS Code 时，把 cpptools `messages.json` 从备份还原并清理备份/meta（重载窗口不触发，需退出全部 VS Code 进程再启动）。

## 0.1.0

- 首个版本：
  - 运行时对当前安装的 cpptools `messages.json` 就地改写（规则表按原文直接 replace + 正则兜底装饰）；
  - 双基准规则表（cpptools 1.34.4 + 1.19.7，zh-cn），三版本实测覆盖 ≥ 94%；
  - 自动备份 / 还原、版本变化自动重打、状态统计命令；
  - 保留原文件格式（UTF-8 无 BOM、CRLF、缩进、null 条目）。

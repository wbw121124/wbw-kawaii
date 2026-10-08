# Changelog

所有重要变更记录于此。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [0.3.0] — 2026-10-08

### 新增
- **markdownlint 运行时拦截**：通过 `createDiagnosticCollection` 拦截，40 条规则可爱化
- **pylint 运行时拦截**：同上，复用 PACK_RULES（~252 条 Python 消息）
- **人设风格系统**（`wbw-kawaii.personaStyle`）：soft / tsundere / derriere / cool 四种人设，各有不同兜底后缀和彩蛋文案
- **可爱强度**（`wbw-kawaii.kawaiiIntensity`）：subtle / normal / bold 三级控制装饰激进程度
- **按目标细粒度开关**（`wbw-kawaii.targets`）：cpptools / typescript / cssHtml / markdownlint / pylint 独立开关
- **自定义兜底后缀**（`wbw-kawaii.customFallback`）：完全覆盖人设风格的默认后缀
- **状态栏控件**：右下角显示 🌸 wbw-kawaii，点击弹出 QuickPick（重新改写/还原文案/查看状态/切换人设/示弱彩蛋）
- **编辑器右键菜单**：TS/CSS/HTML/Cpp 文件右键可用 patch/status 命令
- **人设切换命令**（`wbw-kawaii.cyclePersona`）：循环切换四种人设
- **示弱彩蛋命令**（`wbw-kawaii.whimper`）：检测"菜/蒟蒻/蛆/虫/弱爆"等关键词，触发人设专属警告

### 改进
- **20 种结构差异化策略**重写 TS/PACK 变体（从 6 种机械后缀替换升级为结构变换）
- **子代理精修前 300 条**高频 TS 消息（282/300 通过占位符校验）
- **build-rules 质量报告**：输出模板率、结构差异率等指标
- **curate 文件优先级**：`ts-curate-NN.json` 覆盖 `ts-NN.json` 同名条目
- **PatchOptions 统一**：`transform.ts` / `transform-new.ts` 均透传 opts，兜底后缀完全运行时化
- **patcher.ts 重构**：提取 `buildOpts()` 辅助函数，消除重复代码，`as any` 清零，`require()` 改为顶层 import

### 质量指标
- 模板结尾率：73% → **2.9%**
- 变体对结构不同率：0.6% → **87.6%**
- cpptools 覆盖率：维持在 ~94.6%

---

## [0.2.0] — 2026-10-07

### 新增
- TS / CSS / HTML 目标可爱化（运行时定位文件 + 规则表 replace）
- 语言包 `contents.bundle` 替换
- CSS/HTML server bundle 模板串兜底
- 非 zh-cn 自动还原机制
- 卸载钩子（`vscode:uninstall`）
- `scripts/` 规则生成流水线（extract → regenerate → finalize → build）
- 37 项单测（含多版本覆盖率断言）

### 改进
- displayName 更新为 `wbw121124's kawaii 报错文案`
- cpptools 非 zh-cn 静默还原（不再弹通知）

---

## [0.1.1] — 早期版本

### 新增
- cpptools messages.json 可爱化（核心功能）
- 规则表生成脚本
- 基础测试框架

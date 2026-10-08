# wbw kawaii

让 VS Code 中 **C/C++ / TypeScript / CSS / HTML / markdownlint / pylint** 的报错提示变得可爱！

配套 [errorlens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) 食用效果更佳。

右下角状态栏 🌸 `wbw-kawaii` 点击可快速操作（重新改写 / 还原文案 / 查看状态 / 切换人设 / 触发彩蛋）。

## 特点：全版本有效

参考了 [kawaii-vscode-cpptools](https://github.com/Gary-0925/kawaii-vscode-cpptools) 的做法，但换了实现思路：

- **不替换** 整个 `messages.json` / 翻译 JSON 文件（整文件替换绑定特定版本，扩展一更新就失效，还可能破坏新版本新增的条目）；
- 而是**运行时定位当前安装的文件**，用**规则表按 key 直接 replace**，未命中的条目再用**动态后缀**做兜底；
- 规则以 message key 为键（TS/CSS/HTML）或原文文本为键（cpptools），因此无论底层工具如何升级，只要 key 还在就能命中；
- **保留原文件格式**：UTF-8 无 BOM、CRLF、缩进、JSON 结构原样不动，写回前校验占位符序列一致，绝不弄坏格式化参数；
- 首次改写前自动备份，随时可还原；
- **20 种结构差异化策略**生成变体，模板结尾率 2.9%，结构差异率 87.6%。

## 支持的报错来源

| 来源 | 文件 | 策略 |
| --- | --- | --- |
| C/C++（cpptools） | `bin/messages/zh-cn/messages.json` | 原文文本键 + 双基准覆盖 |
| TypeScript / JavaScript | `typescript/lib/typescript.js` 诊断表 | messageKey 键 + TS_RULES |
| TypeScript / JavaScript | `typescript/lib/zh-cn/diagnosticMessages.generated.json` | messageKey 键 + TS_RULES |
| CSS / HTML | 语言包 `vscode.{css,html}-language-features.i18n.json` | 英文原文键 + PACK_RULES |
| CSS / HTML 模板串 | `cssServerMain.js` / `htmlServerMain.js` 内嵌模板 | 正则兜底后缀 |
| markdownlint | 运行时 DiagnosticCollection 拦截 | MARKDOWNLINT_RULES (40条) |
| pylint | 运行时 DiagnosticCollection 拦截 | PACK_RULES (复用) |

## 人设风格

通过 `wbw-kawaii.personaStyle` 切换，影响所有兜底装饰后缀和彩蛋文案：

| 值 | 人设 | 兜底后缀 |
|---|---|---|
| `soft`（默认） | 软萌 | ` ~` |
| `tsundere` | 傲娇 | ` 哼~` |
| `derriere` | 毒舌 | ` ……真是的` |
| `cool` | 冷淡可爱 | 无后缀 |

也可通过 `wbw-kawaii.customFallback` 完全自定义后缀（优先级高于人设选择）。

## 可爱强度

通过 `wbw-kawaii.kawaiiIntensity` 控制装饰激进程度：

| 值 | 行为 |
|---|---|
| `subtle`（微妙） | ≤8 字短片段不装饰，避免在拼接片段上注入后缀 |
| `normal`（标准，默认） | 当前行为，所有可装饰文案都装饰 |
| `bold`（重度） | 强制装饰所有非 identity 片段 |

## 界面语言行为

- **zh-cn**：所有报错文案可爱化（cpptools + TS + CSS/HTML + markdownlint + pylint）；
- **非 zh-cn**（含 en）：新目标自动还原为英文原文，并弹出通知说明；cpptools 维持现有行为。

## 彩蛋

运行 `Kawaii: 示弱彩蛋` 命令，输入包含以下关键词的句子：`菜 / 蒟蒻 / 蛆 / 虫 / 弱爆 / 不会写 / 太弱` 等，会触发对应人设的警告消息。冷淡人设不触发。

## 要求

- VS Code 显示语言为**中文（zh-cn）**以启用完整可爱化；
- 已安装 C/C++ 扩展 `ms-vscode.cpptools`；
- 已安装中文语言包 `ms-ceintl.vscode-language-pack-zh-hans`（CSS/HTML 可爱化依赖）。

## 安装

1. 下载 `wbw-kawaii-<版本>.vsix`（[Releases](../../releases) 或 CI 产物，或自行 `npm run package`）；
2. 扩展面板 → 右上角 `…` → **从 VSIX 安装**；
3. 重载窗口。之后打开有报错的任意支持文件即可看到效果。

各扩展升级后，本扩展会自动检测版本变化、重新改写并提示重载。

## 命令

| 命令 | 说明 |
| --- | --- |
| `Kawaii: 重新改写报错文案` | 手动触发所有目标改写 |
| `Kawaii: 还原原始报错文案` | 从备份还原所有目标（cpptools + TS + CSS/HTML） |
| `Kawaii: 查看改写状态与覆盖率` | 在输出面板查看各目标状态 |
| `Kawaii: 切换人设风格` | 循环切换 soft → tsundere → derriere → cool |
| `Kawaii: 示弱彩蛋` | 输入框检测关键词，触发人设专属警告 |

## 设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `wbw-kawaii.enabled` | `true` | 启用自动改写 |
| `wbw-kawaii.fallbackDecorate` | `true` | 启用兜底装饰（未命中规则的文案追加后缀） |
| `wbw-kawaii.promptReload` | `true` | 改写后提示重载窗口 |
| `wbw-kawaii.personaStyle` | `soft` | 人设风格：soft / tsundere / derriere / cool |
| `wbw-kawaii.kawaiiIntensity` | `normal` | 可爱强度：subtle / normal / bold |
| `wbw-kawaii.customFallback` | `null` | 自定义兜底后缀，覆盖 personaStyle 选择 |
| `wbw-kawaii.targets` | `{cpptools:true,typescript:true,cssHtml:true,markdownlint:true,pylint:true}` | 按目标细粒度开关 |
| `wbw-kawaii.enableMarkdownlint` | `true` | 启用 markdownlint 报错可爱化（运行时拦截） |
| `wbw-kawaii.enablePylint` | `true` | 启用 pylint 报错可爱化（运行时拦截） |

> `enableMarkdownlint` / `enablePylint` 为旧版兼容设置，等价于 `targets.markdownlint` / `targets.pylint`。

## 工作原理

```
启动 / 扩展版本变化 / 配置变化
  ├─ zh-cn：对每个目标执行补丁流程
  │   ├─ cpptools：messages.json 逐行规则 replace + 动态后缀兜底
  │   ├─ tsDiag：typescript.js diag 表 messageKey 查 TS_RULES
  │   ├─ tsLocale：zh-cn JSON 逐行规则 replace
  │   ├─ packCss / packHtml：语言包 contents.bundle value 替换
  │   ├─ bundleCss / bundleHtml：模板字面量追加后缀
  │   ├─ markdownlint：运行时拦截 DiagnosticCollection
  │   └─ pylint：运行时拦截 DiagnosticCollection
  │   └─ 写入 targets-manifest.json（卸载还原清单）
  └─ 非 zh-cn：还原所有新目标为英文原文 + 弹通知
```

规则表由 `scripts/build-rules.mjs` 在开发期生成：

- **cpptools RULES**：双基准（1.34.4 + 1.19.7）原文 ↔ 可爱文案，占位符序列校验；
- **TS_RULES**：2118 条 TypeScript 诊断消息，20 种结构差异化策略 + 子代理前 300 条人工精修；
- **PACK_RULES**：252 条 CSS/HTML 语言包消息，同样策略重写；
- **MARKDOWNLINT_RULES**：40 条 markdownlint 规则描述可爱化；
- 产物 `src/rules.generated.ts` 提交进仓库，CI 校验其与分块输入一致。

## 开发

```bash
npm ci                    # 依赖（建议 node_modules 放在 C 盘，U 盘上可用 mklink /J 做目录联接）
npm run fetch-baseline    # 下载 cpptools vsix 提取原始 messages.json（~300MB，一次性）
npm run extract:inputs    # 从本机 VS Code 提取 TS/语言包 inventory（需本地环境）
npm run build:rules       # 合并分块生成 src/rules.generated.ts（CI 可跑）
npm test                  # tsc 编译 + node:test 单测（含多版本覆盖率断言）
npm run package           # 打出 .vsix
```

CI（`.github/workflows/build.yml`）在每次 push 时自动完成编译 + 测试并上传 `.vsix` 产物。

## 已知限制

- zh-cn 以外界面：TS/CSS/HTML 目标自动还原为英文原文，cpptools 维持现有行为；
- 改写发生在磁盘文件上，语言服务器启动时读取，因此改写后需要重载窗口；
- 语言包升级后目录名变化，但本扩展通过 extensionId 定位，自动重打；
- 若微软未来对诊断 JSON 增加完整性校验（目前没有），本方案会失效；
- 卸载本扩展后，`vscode:uninstall` 钩子会在下一次**完全重启** VS Code（退出全部进程再启动，重载窗口不触发）时自动还原所有目标并清理备份。

## 致谢

- [Gary-0925/kawaii-vscode-cpptools](https://github.com/Gary-0925/kawaii-vscode-cpptools) — cpptools 可爱文案来源（MIT，见 `assets/reference/NOTICE`）；
- [Bill-Haku/kawaii-gcc](https://github.com/Bill-Haku/kawaii-gcc) — 灵感来源。

## 许可

[MPL-2.0](LICENSE)。规则表派生自上述 MIT 文案，版权声明保留于 `assets/reference/NOTICE`。

---

## 发布到 Visual Studio Marketplace

1. 注册 Azure DevOps 组织：<https://dev.azure.com>（任意免费组织即可）。
2. 创建 publisher（与 `package.json` 的 `publisher` 字段一致）：
   ```bash
   npx vsce create-publisher wbw121124
   ```
   或在 <https://marketplace.visualstudio.com/manage> 的 Publishers 页创建。
3. 生成 PAT（Personal Access Token）：Azure DevOps → Personal access tokens → New token，
   权限范围勾选 **Marketplace: Manage**。
4. 登录并发布：
   ```bash
   npx vsce login wbw121124        # 粘贴 PAT
   npx vsce publish                # 或 npx vsce publish -p <PAT>
   ```
5. 发布前检查清单：
   - `package.json` 的 `publisher` / `repository` / `version` 正确；
   - 建议补一张 128×128 的 `icon.png` 并在 `package.json` 中声明 `"icon"`；
   - README 效果截图（放 `media/` 目录并在 README 引用）。
6. 后续版本：改 `version` → push → CI 产出 `.vsix` → `npx vsce publish --packagePath wbw-kawaii-x.y.z.vsix`，
   也可以在 CI 里加 release 触发的 publish job 自动完成。

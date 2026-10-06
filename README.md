# wbw kawaii

让 VS Code 中 C/C++ 扩展（ms-vscode.cpptools）的报错提示变得可爱！

配套 [errorlens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) 食用效果更佳。

## 特点：全版本有效

参考了 [kawaii-vscode-cpptools](https://github.com/Gary-0925/kawaii-vscode-cpptools) 的做法，但换了实现思路：

- **不替换** cpptools 的 `messages.json` / 翻译 JSON 文件（整文件替换绑定特定版本，扩展一更新就失效，还可能破坏新版本新增的条目）；
- 而是**运行时定位当前安装的 cpptools 版本**，读取其 `bin/messages/<locale>/messages.json`，用**规则表按“原文文本”直接 replace**，未命中的条目再用**正则表达式追加统一可爱后缀**做兜底；
- 规则以原文文本为键而不是数组下标，因此无论 cpptools 是 1.19、1.34 还是将来的版本，只要原文还在就能命中（实测对 1.19.7 / 1.34.4 / 1.35.3 三个版本的精确命中率均 ≥ 94%，其余走正则兜底，覆盖率 100%）；
- **保留原文件格式**：UTF-8 无 BOM、CRLF、2/4 空格缩进、`null` 条目原样不动，写回前校验占位符（`%s`、`%sq`、`%t`、`%[...]` 等）序列一致，绝不弄坏格式化参数；
- 首次改写前自动备份 `messages.json.orig`，随时可还原。

## 要求

- VS Code 显示语言为**中文（zh-cn）**（英文界面下 cpptools 没有本地化消息文件，无法改写）；
- 已安装 C/C++ 扩展 `ms-vscode.cpptools`。

## 安装

1. 下载 `wbw-kawaii-<版本>.vsix`（[Releases](../../releases) 或 CI 产物，或自行 `npm run package`）；
2. 扩展面板 → 右上角 `…` → **从 VSIX 安装**；
3. 重载窗口。之后打开一个有报错的 C/C++ 文件即可看到效果。

cpptools 扩展升级后，本扩展会自动检测版本变化、对新目录重新改写并提示重载。

## 命令

| 命令 | 说明 |
| --- | --- |
| `Kawaii: 重新改写 cpptools 报错文案` | 手动触发改写 |
| `Kawaii: 还原 cpptools 原始报错文案` | 从 `messages.json.orig` 备份还原 |
| `Kawaii: 查看改写状态与覆盖率` | 在输出面板查看统计 |

## 设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `wbw-kawaii.enabled` | `true` | 启用自动改写 |
| `wbw-kawaii.fallbackDecorate` | `true` | 未命中规则的条目用正则追加可爱后缀（` 喵~`） |
| `wbw-kawaii.promptReload` | `true` | 改写后提示重载窗口 |

## 工作原理

```
启动 / cpptools 版本变化
   └─ 定位 ~/.vscode/extensions/ms-vscode.cpptools-<ver>/bin/messages/<locale>/messages.json
      ├─ meta 状态校验（rulesVersion + cpptoolsVersion + 哈希）→ 已改写则跳过
      ├─ 逐行解析：null 原样 | 规则表直接 replace | 正则兜底装饰
      ├─ 备份 messages.json.orig → 写回 → 更新 meta
      └─ 提示重载窗口
```

规则表由 `scripts/build-rules.mjs` 在开发期生成：

- 基准 1：cpptools **1.34.4** 原文 ↔ kawaii 文案（逐索引配对，校验占位符序列）；
- 基准 2：cpptools **1.19.7** 原文 ↔ 同索引文案（占位符序列一致才采纳）；
- 重复原文生成“变体数组”，运行时按条目索引轮转，保留不同语气；
- 产物 `src/rules.generated.ts` 提交进仓库，CI 会校验其与基线一致。

## 开发

```bash
npm ci                    # 依赖（建议 node_modules 放在 C 盘，U 盘上可用 mklink /J 做目录联接）
npm run fetch-baseline    # 下载 cpptools vsix 提取原始 messages.json（~300MB，一次性）
npm run build:rules       # 生成 src/rules.generated.ts
npm test                  # tsc 编译 + node:test 单测（含三版本覆盖率断言）
npm run package           # 打出 .vsix
```

CI（`.github/workflows/build.yml`）在每次 push 时自动完成上述流程并上传 `.vsix` 产物。

## 已知限制

- 仅支持中文界面（`zh-cn` 等有本地化文件的语言），英文界面下 cpptools 把英文原文编译在二进制里，没有可改写的文件；
- 改写发生在磁盘文件上，cpptools 语言服务器启动时读取，因此改写后需要重载窗口；
- 若微软未来对 `messages.json` 增加完整性校验（目前没有），本方案会失效；
- 卸载本扩展不会自动还原文件，请先执行“还原”命令，或重新安装 cpptools。

## 致谢

- [Gary-0925/kawaii-vscode-cpptools](https://github.com/Gary-0925/kawaii-vscode-cpptools) — 可爱文案来源（MIT，见 `assets/reference/NOTICE`）；
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

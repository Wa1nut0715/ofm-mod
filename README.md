# OFM Mod — 魔改版 Our Free Model

> DeepSeek-Harness（DSH）插件 **Our Free Model** 的魔改副本，基于上游 `2.5.7`。
>
> 相比上游发布版，**唯一改动**在 `vendor/channel-pack/pack.js`（+169 / −1 行）：
> 腾讯系渠道（CodeBuddy / WorkBuddy）出网前增加一层「请求体指纹整串清洗」，
> 并加上拦截后的自动重试与失败落盘诊断。
>
> 改动说明 [`docs/MODIFICATIONS.md`](docs/MODIFICATIONS.md) ·
> 指纹规则原文 [`docs/FINGERPRINTS.txt`](docs/FINGERPRINTS.txt) ·
> 可复现补丁 [`docs/tencent-11128.patch`](docs/tencent-11128.patch)

---

## 这个插件是干什么的

在 DSH 里装上它之后，无需自己申请 API Key 就能用上一批前沿模型：

- **免费车道**（匿名通道）：DeepSeek V4.1 Flash、Kimi K3 等，装好即用。
- **账号车道**（十三家账号渠道）：CodeArts（华为云）、**CodeBuddy（腾讯）**、
  **WorkBuddy（腾讯国际版）**、LobsterAI、Qoder、Qoder 中国版、TRAE、Cline、
  Loomy、Raccoon、MiniMax Code、ZCode、Gemini。
  这些渠道需要**登录一次**（扫码 / 短信 / 浏览器回调），凭据写入本机凭据库后，
  对应模型就出现在对话框的模型选择器里。
- **EAC 协付车道**（仅桌面端）：加密内置的合作通道。
- 附带的本地能力：账号池、积分领取、本地 OpenAI 兼容网关（`/v1/chat/completions`）、
  局域网转发、数据看板、运行日志、Token 节省器。

这一份额外做的事：**让 CodeBuddy / WorkBuddy 的请求能通过腾讯侧的渠道校验**。
上游版本在这两个渠道上会稳定收到

```json
{"code":11128,"msg":"Illegal API invocation from an unapproved channel"}
```

魔改把出网前的请求体做整串指纹清洗，并在仍被拦时按五档阶梯重试。

---

## 安装

### 方式 A：用 DSH 插件管理器装（推荐）

在 DSH 里让 agent 执行，或等价地调用 `plugin_manager` 工具：

```
action: install_bundle
target: github:Wa1nut0715/ofm-mod
```

它会在 profile 目录里跑一次 `pnpm add github:Wa1nut0715/ofm-mod`，
装完自动把这个包登记进 `dsh.profile.bundles`（因为它 `package.json` 里声明了
`dsh.bundle.patch`）。装完**重启 DSH**。

也可以在设置 → 插件里用同样的 spec 安装。

### 方式 B：手工克隆 + 本地路径

```powershell
git clone https://github.com/Wa1nut0715/ofm-mod.git D:\plugins\ofm-mod
```

然后编辑 `%USERPROFILE%\.dsh-beta\profiles\desktop\package.json`：

```json
{
  "dependencies": {
    "dsh-our-free-model": "file:D:/plugins/ofm-mod"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-our-free-model"
      ]
    }
  }
}
```

再 `pnpm install` 并重启。

> **包名是 `dsh-our-free-model`，不是仓库名。** 依赖名和 `bundles` 里的条目
> 都必须用包名，用仓库名会挂不上。

详细步骤、验证与排错见 **[`INSTALL.md`](INSTALL.md)**。

---

## 装完还要做的一件事

插件不含任何账号凭据 —— 凭据是活 token，与账号会话绑定，不能随代码分发。

所以要**自己登录一次**：设置 → **白嫖模型接入** → 找到
**WorkBuddy 国内版**（`buddy`，`copilot.tencent.com`，CodeBuddy 与之同一套账号体系）
→ **添加账号** → 扫码/授权。国际版（`workbuddy`，`workbuddy.ai`）是独立账号体系，
需要单独登录。

登录态写入 `%USERPROFILE%\.dsh-beta\` 下（`*.credentials.yaml`、
`channel-pack/state.json` 等），这些路径已在 `.gitignore` 里。

---

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `index.js` | Host 半身入口：模型车道、设置页 JSON API、OpenAI 兼容网关、公告/自更新/热重载 |
| `client.js` | 浏览器半身（单文件，含全部界面与多语言） |
| `adapter/kernel.js` | 把渠道包装进 DSH 的 `LlmAdapter` 内核 |
| `src/` | 各功能模块：store / probe / forward / egress / catalog / combos / token-saver / vault … |
| `src/providers/registry.json` | 各家 provider 与模型清单 |
| `vendor/channel-pack/pack.js` | **上游「channel pack」的单文件打包产物，插件运行时真正加载的代码**；魔改落在这里 |
| `vendor/channel-pack/qoder-auth-wasm.wasm` | Qoder 加密推理所需 WASM，必须与 `pack.js` 同目录 |
| `vendor/channel-pack/NOTICE.md` | 上游出处（gitee `iJetLi/deepseek-harness-codearts`，MIT）与再构建步骤 |
| `cordis.patch.yml` | bundle patch：一行 insert 挂载本插件，并传 `distribution: managed` |
| `docs/` | 改动说明、指纹规则原文、可复现补丁 |
| `tools/` | `verify-tencent.mjs`（直连探针）、`dump-rules.mjs`（导出规则原文） |

---

## 关键设计点（改这个插件前必须知道）

### 1. `distribution: managed` —— 别改成 self

`cordis.patch.yml` 传的是 `distribution: managed`，`index.js:130` 的
`distributionOf()` 让它压过 settings 文件里的 `self`：

```js
function distributionOf(config, settings) {
  if (config?.distribution === 'managed' || settings.get().distribution === 'managed') return 'managed'
  return 'self'
}
```

`managed` 会让**自更新器、公告频道、热重载三件套全部停摆**（否则两个写入方抢同一个
安装目录 = 装坏）。这对本仓库是**必须的**：`src/updater.js:32` 里

```js
const REPO = 'Ebony-Vinyl/dsh-our-free-model'
```

指向的是**上游公开仓库**；一旦 `managed` 失效，插件会从上游拉 `feed/manifest.json`
并覆盖本地文件，**把 `vendor/channel-pack/pack.js` 的魔改冲掉**。
所以：`cordis.patch.yml` 的 `distribution: managed` 是这份魔改的保险丝，不要改。

### 2. `pack.js` 是构建产物，但这份是手工改的

`vendor/channel-pack/pack.js` 正常应由 `vendor/channel-pack/src/` 经
`scripts/build-channel-pack.mjs` 打包生成。本仓库**不含** `src/` 与 `scripts/`
（上游发布包也不含），所以：

- **不要**跑 `npm run channel-pack`，会把魔改覆盖掉；
- 要复核/重建魔改，直接用 `docs/tencent-11128.patch`（见 `docs/MODIFICATIONS.md`）。

### 3. `file:` 依赖是复制，不是软链

走方式 B 时要注意：pnpm 会把目录**复制**进
`profiles\desktop\node_modules\dsh-our-free-model`
（`node_modules\.modules.yaml` 的 `injectedDeps` 里能看到映射）。
两处是独立副本：

- 改源码 → 运行副本不会跟着变，要重新 `pnpm install`；
- 改运行副本 → 源码不会变，下次 `pnpm install` 会把改动覆盖回去。

### 4. 凭据与账号数据都在包外

插件自身**不含任何密钥**，也没有硬编码本机路径。所有登录态、账号池、运行统计都在
DSH 的 home 目录下（Windows 默认 `%USERPROFILE%\.dsh-beta\`）：

```
.credentials.yaml              # 明文凭据库（DSH 自身管理）
channel-pack/state.json        # 账号池：provider / id / credentialRef
channel-pack/token-ledger.json
channel-pack/auto-checkin.json
our-free-model/*.json          # 设置 / 目录 / 可用性 / 统计 / 公告
```

**这些一律不进仓库**。换机后各自重新登录一次，这是设计如此，不是缺陷。

---

## 许可证

`LICENSE` 为上游的 MIT（Copyright (c) 2026 Ebony-Vinyl），
`vendor/channel-pack/LICENSE` 为其渠道包上游的 MIT
（gitee `iJetLi/deepseek-harness-codearts`）。本仓库按同一许可证分发。

本仓库只做代码改动，**不含任何账号、凭据或上游未公开的内容**。
使用这些渠道需自行遵守各家服务条款。

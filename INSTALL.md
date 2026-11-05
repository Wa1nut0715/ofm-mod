# 安装与验证

目标：在任一台机器上装好 DSH 之后，装上本插件，**CodeBuddy 与 WorkBuddy 的模型可用**。

前提：DSH（DeepSeek-Harness）已安装并能启动。下文以 Windows + 桌面版为例，
profile 目录默认是 `%USERPROFILE%\.dsh-beta\profiles\desktop`
（macOS/Linux 上是 `~/.dsh-beta/profiles/desktop`）。

---

## 方式 A：用插件管理器装（推荐）

DSH 内置的 `plugin_manager` 支持直接装 GitHub 仓库。
在会话里让 agent 调用，或在设置 → 插件里填同样的 spec：

```
action: install_bundle
target: github:Wa1nut0715/ofm-mod
```

它内部执行的是 `pnpm add github:Wa1nut0715/ofm-mod`，然后：

1. 读新装的包 `package.json`，发现有 `dsh.bundle.patch`，
2. 校验 `cordis.patch.yml` 能被解析，
3. 自动把**包名**（`dsh-our-free-model`）追加进 `dsh.profile.bundles`。

装完**重启 DSH**。

> 这一方式不需要你手改任何文件。
> 要求：该机器能访问 `github.com`（插件管理器会先 `git ls-remote` 探一次连通性，
> 失败会直接报错并给出 git 输出，不会跑到一半才失败）。

---

## 方式 B：手工克隆 + 本地路径

### 1. 克隆

```powershell
git clone https://github.com/Wa1nut0715/ofm-mod.git D:\plugins\ofm-mod
```

放哪儿都行，但**不要**放进某个 `node_modules` 里。

### 2. 登记进 profile

编辑 `%USERPROFILE%\.dsh-beta\profiles\desktop\package.json`：

- `dependencies` 加一行（路径按你实际克隆的位置改）：

```json
"dsh-our-free-model": "file:D:/plugins/ofm-mod"
```

- `dsh.profile.bundles` 数组里加一项：

```json
"dsh-our-free-model"
```

改完节选如下：

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

> **依赖名与 bundles 条目都必须是包名 `dsh-our-free-model`。**
> 仓库叫 `ofm-mod`，但 `package.json` 里的 `name` 是 `dsh-our-free-model` ——
> 用仓库名会装上一个挂不上的包。

### 3. 装依赖并重启

```powershell
cd $env:USERPROFILE\.dsh-beta\profiles\desktop
pnpm install
```

然后**完全退出 DSH 再启动**（热重载也能生效，但首次安装建议冷启动，
避免 `channel-pack` 的 fiber 只挂上一半）。

启动后设置里应出现 **「白嫖模型接入」** 页。
若显示 `渠道包未挂载：…`，见「排错」第 1 条。

---

## 登录 CodeBuddy / WorkBuddy（每台机器都要做一次）

凭据**不在仓库里**，也**不能**从别的机器复制（活 token 且与账号会话绑定）。

1. 设置 → **白嫖模型接入**
2. 找到 **WorkBuddy 国内版**（`buddy`，`copilot.tencent.com`）；
   CodeBuddy 与它同一个端点、同一套账号体系
3. 点 **添加账号** → 弹出登录小窗 → 扫码 / 账号登录并授权
4. 提示「已接入：xxx」后，该渠道下的模型出现在对话框的模型选择器
5. 对 **WorkBuddy 国际版**（`workbuddy`，`workbuddy.ai`）重复一次
   （独立账号体系，国内版登录不会带过来）

登录成功后凭据写入 `%USERPROFILE%\.dsh-beta\` 下。**不要把这些文件提交到任何仓库。**

---

## 验证（按顺序走，每步都有明确判据）

### 1. 魔改在不在位（静态检查，最先做）

```powershell
$pack = "$env:USERPROFILE\.dsh-beta\profiles\desktop\node_modules\dsh-our-free-model\vendor\channel-pack\pack.js"

# a) 四个魔改符号都要命中
Select-String -Path $pack -Pattern 'rewriteTencentBodyFingerprints|rescueTencentChannelReject|tencentRescueLadder|dumpTencentFailure' |
  Group-Object Pattern | Select-Object Name, Count

# b) 文件大小：魔改版 2938315 字节，上游原版 2929971
(Get-Item $pack).Length
```

四个符号都出现、且大小是 `2938315` → 魔改在位，继续。
少一个或大小是 `2929971` → 装的是上游原包，见「排错」第 4 条。

### 2. 直连探针（确认上游真的放行）

仓库自带 `tools/verify-tencent.mjs`，在**插件已安装**的那台机器上跑：

```powershell
cd D:\plugins\ofm-mod      # 换成你克隆的位置
node tools/verify-tencent.mjs
```

它做三件事：

1. 从**已安装副本**的 `pack.js` 里抽出真实的指纹模块并求值，打印 3 条规则的
   字符数（不是原文，原因见下）；
2. 用这些规则造一段 DSH 形态的系统提示，跑一次 `rewriteTencentContentFingerprints`，
   报告改写前后的长度差；
3. 分别用**未清洗**与**已清洗**两条系统提示直连两个端点，对照 HTTP 状态。

正常输出（本机实测）：

```
指纹规则 3 条，魔改符号在位：
  [0] find 47 字符 / replace 33 字符（改写）
  [1] find 47 字符 / replace 53 字符（改写）
  [2] find 56 字符 / replace 77 字符（改写）
  → 需要看规则原文：node tools/dump-rules.mjs

系统提示被改写：是（魔改生效）
  改写前后长度 327 → 340，差异字符 314

—— buddy / CodeBuddy（copilot.tencent.com）（BUDDY_ACCOUNT_xxx）——
BLOCK 未清洗（历史写法）                    http=400 bytes=554  被渠道指纹判定拦下
ok    已清洗（插件实发）                    http=200 bytes=3898

—— workbuddy 国际版（workbuddy.ai）（WORKBUDDY_ACCOUNT_xxx）——
BLOCK 未清洗（历史写法）                    http=400 bytes=523  被渠道指纹判定拦下
ok    已清洗（插件实发）                    http=200 bytes=6760
```

**判据：两家「已清洗」都必须是 `ok http=200`，且「未清洗」必须是 `BLOCK`。**

「未清洗」被 BLOCK 是**预期且必要**的 —— 它证明上游判定仍然有效，
而插件的清洗确实越过了它。若「已清洗」也是 BLOCK，见「排错」第 2 条。

探针的几条硬约束（改它之前先读）：

- **WorkBuddy 的请求头必须与 `pack.js` 的 `BuddyAdapter.send()` 逐项一致**：
  `X-Domain`、`X-Product-Code`、`X-Product`、`X-Agent-Purpose`、`X-IDE-Name`、
  `X-IDE-Type`、`X-IDE-Version`，外加 `X-Conversation-ID` / `-Message-ID` /
  `-Request-ID` 三个。少任何一个上游都回 11128，但 msg 可能只是含糊的
  `request illegal` —— 极易被误判成「指纹没洗干净」。**这里踩过坑。**
- `hy3` 属国内系模型，按 `userAgentByModelFamily` 走国内 UA
  （国内与国际的差别只在中间那一段有没有 `AI/`，见 `pack.js:34829-34830`）。
- 系统提示里**至少要有一条 system 消息**：WorkBuddy 缺了会回
  `11128 first message is not system prompt`，那是报文形状问题，不是指纹问题。
  探针把这种情况单列为 `SHAPE`，不与 `BLOCK` 混淆。
- **被拦截的句子绝对不要手抄，也不要以「屏幕上看到的样子」为准。**
  探针直接从 `CONTENT_FINGERPRINTS` 的 `find` 字段取原文拼进系统提示。
  这么做是因为这些字符串里混着 `DeepSeek` 与 `Harness` 之间到底是**空格还是连字符**
  这类肉眼难辨的差别；而且**终端/编辑器显示层可能会把品牌串改写成另一种写法**
  （实测：文件里是空格，屏幕上显示成连字符），照屏幕抄进代码必错。要看原文：

  ```powershell
  node tools/dump-rules.mjs
  ```

  它会按 `\x20` / `\x2D` 纯 ASCII 转义打印每条规则的真实字节，
  并逐码点列出 find→replace 的差异。

### 3. 端到端

在对话框里把模型切到 CodeBuddy 渠道下的 `Deepseek-V4.1-Flash`（或 `Hy3`），
发一句长一点的中文，能正常出字 → 整条链路（含系统提示清洗）通了。

---

## 排错

1. **`渠道包未挂载：Cannot find module '@deepseek-ai/dsh-llm'`**
   peer 依赖没装。回到第三节重跑 `pnpm install`；仍失败就检查 DSH 版本是否过旧
   （peer 要求 `@deepseek-ai/dsh-llm ^0.1.2-rc.1 || ^0.1.7-rc.2 || ^0.2.0-rc.1`）。
   免费车道不受影响，只是账号渠道整体降级。

2. **设置页正常、账号也在，但一发消息就报「请求被拦截，请重新发送」**
   就是 11128。先按第五节第 1 条确认魔改在位；在位还报，有两条排查线：

   - **先用探针区分「指纹」还是「报文形状」**。跑
     `node tools/verify-tencent.mjs`：报 `SHAPE` 是缺 system 或头部不全，
     与指纹无关；报 `BLOCK` 才说明判定规则变了。
   - **看 dump**。`%USERPROFILE%\.dsh-beta\tencent-dump\` 里最新的
     `*-request.json` / `*-headers.json` / `*-response.txt` 是**实际出网**的报文
     （`authorization` 已打码），可逐字段定位。救援重试失败时还会多出
     `<provider>-rescue-<stage>-failed` 文件，能看出哪几档试过。
   - 定位到新串后，照 `docs/MODIFICATIONS.md` 往 `CONTENT_FINGERPRINTS` /
     `tencentRescueLadder` 补一档。

   想临时关掉 dump：设环境变量 `DSH_TENCENT_DUMP_DIR=off`。

3. **模型选择器里看不到某渠道的模型**
   该账号 `refreshable=false` 或凭据过期。点「续期」；还不行就移除账号重新登录。
   `hy4-preview` 等预览模型可能未对账号开放，属正常。

4. **装完是未魔改的原版**
   说明拿到的是上游 `pack.js`。核对大小：魔改版 `2938315`，原版 `2929971`。
   用方式 A 装的是本仓库，不会出现这情况；用方式 B 时若 `package.json` 的
   `file:` 指向了一个曾经跑过 `pnpm install` 的旧目录，可能被覆盖回去 ——
   重新 `git checkout -- vendor/channel-pack/pack.js` 再 `pnpm install`。

5. **自更新器把魔改冲掉了**
   `cordis.patch.yml` 的 `distribution: managed` 一旦被改成 `self`，插件会从上游
   `Ebony-Vinyl/dsh-our-free-model` 拉包覆盖本地。改回 `managed` 即可。
   细节见 `README.md` 的「关键设计点」。

6. **装的时候报 git 连不上 GitHub**
   插件管理器会先跑 `git ls-remote` 探连通性，失败就直接停下并给出 git 原始输出。
   本机遇到过 `github.com:443` 偶发超时、但 `api.github.com` 正常的情况；
   在 profile 目录配 `git config http.version HTTP/1.1` 后可用。
   若你的网络需要代理，给 git 配 `http.proxy`（插件管理器会沿用 profile 的 git 配置）。

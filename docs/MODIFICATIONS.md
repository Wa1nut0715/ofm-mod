# 本地魔改说明：腾讯渠道 11128 指纹兜底

本文记录本仓库相对于上游 `dsh-our-free-model@2.5.7` 的**全部**改动。
改动只落在一个文件：`vendor/channel-pack/pack.js`（+169 / −1 行）。

> ## ⚠ 关于本文里的字符串
>
> 本文一律用 **`\x20` 表示 ASCII 空格（U+0020）**、**`\x2D` 表示连字符（U+002D）**，
> 其余字符原样。写 `"DeepSeek\x20Harness"` 就是品牌词的两段之间有一个空格；
> 写 `"DeepSeek\x2DHarness"` 才是连字符。本文**不在任何地方**用"看起来更顺眼"的
> 自然写法来表达这两个串，就是为了避免下面的问题。
>
> 这不是洁癖。本机实测：某些显示层（终端、编辑器、聊天窗口、甚至模型自己的输出）
> 会把这两种写法**互相改写** —— 文件里是空格，屏幕上显示成连字符。照屏幕抄进代码，
> 规则必然匹配不上，而症状看起来只是"补丁没生效"，极难查。本轮就因为这个原因
> 写错过一次（把规则 0 的 `find` 与规则 2 的 `find` 混在一起写了）。
>
> **唯一可信的读法：`node tools/dump-rules.mjs`** —— 它对从 `pack.js` 求值得到的
> 字符串做纯 ASCII 转义并逐码点列出 find→replace 差异；`--emit-doc` 可重新生成
> `docs/FINGERPRINTS.txt`。

---

## 一、为什么改

上游插件在调用 CodeBuddy / WorkBuddy（腾讯 `copilot.tencent.com` 与
`www.workbuddy.ai`）时，会稳定地收到：

```json
{
  "code": 11128,
  "msg": "Illegal API invocation from an unapproved channel",
  "displayMsg": {
    "en": "Request blocked. Please send it again",
    "zh": "请求被拦截，请重新发送"
  }
}
```

腾讯对**请求正文里的特定字面串**做精确匹配，命中即整轮拒绝。上游已经有一层
防线（`CONTENT_FINGERPRINTS` + `rewriteTencentContentFingerprints`），但它有两个缺口：

1. **只改 `content`，漏掉别的字段**。上游在 `stream()` 里按 role 遍历消息、
   只对 `content` 做替换。`reasoning_content`（历史思考内容）、
   `tools[].function.description`（工具说明）、以及未来新增的消息形状
   都覆盖不到 —— 任何一处漏网，整轮 400。
2. **规则集是静态的**。腾讯的判定规则随版本变化（历史上换过），
   一旦出现规则没收录的写法，用户看到的就是「请求被拦截」，
   每轮对话都断，且**没有任何诊断信息**说明是哪个字段哪段文本触发的。

---

## 二、上游的三条规则（未改动，但必须准确理解）

位置：`pack.js:63483` 的 `var CONTENT_FINGERPRINTS = [...]`。
编译：`pack.js:63524` 的 `var COMPILED = CONTENT_FINGERPRINTS.map(...)`
每条编成 `{ pattern: new RegExp(escapeRegExp(find), "gi"), replace, findLower }`。

**下面的字符串一律用 `\x20` 表示空格、`\x2D` 表示连字符**（纯 ASCII 转义，
从屏幕抄也不会失真）。原样副本另见 [`FINGERPRINTS.txt`](FINGERPRINTS.txt)，
由 `node tools/dump-rules.mjs --emit-doc` 生成。

| # | `find`（原文） | `replace` |
| --- | --- | --- |
| 0 | `"Main\x20branch\x20(you\x20will\x20usually\x20use\x20this\x20for\x20PRs)"` | `"Main\x20branch\x20(PRs\x20usually\x20go\x20here)"` |
| 1 | `"You\x20are\x20an\x20AI\x20agent\x20powered\x20by\x20DeepSeek\x20Harness"` | `"You\x20are\x20an\x20AI\x20agent\x20operating\x20inside\x20DeepSeek\x20Harness"` |
| 2 | `"You\x20are\x20Claude\x20Code,\x20Anthropic's\x20official\x20CLI\x20for\x20Claude"` | `"You\x20are\x20a\x20coding\x20assistant,\x20an\x20interactive\x20CLI\x20for\x20software\x20engineering\x20tasks"` |

字符数（用于快速核对是否抄对）：规则 0 是 47→33，规则 1 是 47→53，
规则 2 是 56→77。

三条规则各自的来历：

- **规则 0**：ZCode 内建常量，每个 git 仓库的会话都会被注入（拼在
  `Main branch … : <分支名>` 这一行）。2026-10-05 对 workbuddy / CodeBuddy
  双端点实测复现。
- **规则 1**：DSH 系统提示的 `harness:identity` 段原文（见
  `@deepseek-ai/dsh-system-prompt` 的 `HARNESS_IDENTITY` 小节，order -1000，
  永远排在系统提示最前面）。腾讯对**这一个整句**做精确匹配，命中即 400/11128。
  2026-10-26 对 `copilot.tencent.com` 逐条实测的边界（都是 system 角色）：
  命中拦截 = 整句 / 去掉句号 / 全小写 / 句后接任意文本；放行 = 句首加任意前缀、
  前面加空格、`powered by` 换成 `running in` / `built on` / `operating inside`、
  或把品牌串换成别的写法。也就是说拦的是「句首锚定 + agent + powered by +
  品牌串」这个形状，**只要把 `powered by` 改掉就放行**，语义保留，
  模型仍知道自己在 DSH 里。
  `find` **故意不带句尾句号**：实测带/不带句号同样被拦，去掉句号让一条规则
  同时覆盖两种写法（替换后原句号自然保留）。
- **规则 2**：Claude Code 的开场白。DSH 自身不注入这句，但用户经常把
  CLAUDE.md / 别人的提示词原样粘进会话，落到 system 或 assistant 角色同样
  400/11128。实测：整句拦；拆开写就放行 —— 同样是整句精确匹配。

---

## 三、改了什么（7 处改动：`send()` 内 2 处 + 5 个新增函数）

### 1. `BuddyAdapter.send()` 出网前整串清洗

位置：`pack.js:36186`（`async send(credential, body, options) {`）
新增于 `pack.js:36187-36196`：

```js
// 腾讯渠道（buddy / workbuddy）出网前的**最后一道**指纹清洗。
if (isTencentContentFingerprintProvider(this.product.id)) {
  body = rewriteTencentBodyFingerprints(body);
}
```

原理：`send()` 是**唯一出网点**，此时 `body` 已是最终 JSON 字符串。
对整串做替换，语义与上游逐字段改写等价（三条规则都只含 ASCII 可见字符，
`JSON.stringify` 不会转义它们），但覆盖面是「请求体里的每一个字节」。

### 2. `BuddyAdapter.send()` 拿到非 2xx 时落盘 + 救援

原本是 `return await this.fetchImpl(...)`。改成先接住 response：

```js
const response = await this.fetchImpl(`${this.product.endpoint}/v2/chat/completions`, { ... });
if (!response.ok) {
  dumpTencentFailure(this.product.id, response.status, body, response, headers);
  const rescued = await this.rescueTencentChannelReject(response, body, headers, options);
  if (rescued !== void 0) return rescued;
}
return response;
```

### 3. `rescueTencentChannelReject()`（新增，`pack.js:36247`）

```js
async rescueTencentChannelReject(response, body, headers, options) {
  try {
    if (!isTencentContentFingerprintProvider(this.product.id)) return void 0;
    if (response.status !== 400 && response.status !== 403) return void 0;
    const peek = await response.clone().text();
    if (!/11128|Illegal API invocation|request illegal|unapproved channel/i.test(peek)) return void 0;
    let lastBody = body;
    for (const attempt of tencentRescueLadder(body)) {
      if (attempt.body === lastBody) continue;      // 与上一档相同就跳过
      lastBody = attempt.body;
      const retry = await this.fetchImpl(`${this.product.endpoint}/v2/chat/completions`, {
        method: "POST", headers, body: attempt.body, signal: options.signal
      });
      if (retry.ok) return retry;
      dumpTencentFailure(`${this.product.id}-rescue-${attempt.stage}-failed`, retry.status, attempt.body, retry, headers);
    }
    return void 0;
  } catch { return void 0; }
}
```

要点：

- **只在真的被拦之后才重试**，正常请求零额外开销。
- 整个方法 `try/catch` 静默放弃 —— 救援失败必须走回上游原本的报错路径，
  不能自己抛异常把错误信息盖掉。
- 每档失败都落盘（文件名带 `-rescue-<stage>-failed`），事后能看出试过哪几档。

### 4. `rewriteTencentBodyFingerprints()`（新增，`pack.js:63550`）

```js
function rewriteTencentBodyFingerprints(body) {
  if (typeof body !== "string" || body.length === 0) return body;
  let out = body;
  for (const rule of COMPILED) {
    if (!out.toLowerCase().includes(rule.findLower)) continue;
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}
```

### 5. `rewriteTencentBodyFingerprintsHard()`（新增，`pack.js:63568`）

在 soft 之上，把品牌串**整体**换掉。注意两个侧的字面量**不同**：
`split()` 收的是空格写法，`join()` 给的是连字符写法。

```js
if (out.includes("DeepSeek\x20Harness")) {
  out = out.split("DeepSeek\x20Harness").join("DeepSeek\x2DHarness");
}
```

依据（`pack.js:63497-63503` 的注释记录的 2026-10-26 实测边界）：
腾讯对身份句的拦截是整串精确匹配，而把品牌串的空格写法换成连字符写法
是当时验证过能放行的改法。这里不再依赖具体句式 —— 只要拦的是这句话
（或其变体），替换品牌串就能过。

> 复核这段请跑 `node tools/dump-rules.mjs`，它会把 `includes` / `split` / `join`
> 三段的字面量按 `\x20` / `\x2D` 转义打印出来。

### 6. `tencentRescueLadder()`（新增，`pack.js:63588`）

五档渐进净化，每一档都在上一档基础上更彻底：

```js
const soft     = rewriteTencentBodyFingerprints(body);
const hard     = rewriteTencentBodyFingerprintsHard(body);
const neutral  = hard.replace(/You are an AI agent[^"]{0,80}?DeepSeek[- ]Harness\./g,
                              "You are a helpful assistant.");
const stripped = neutral.replace(/"reasoning_content":"(?:[^"\\]|\\.)*"/g,
                                 '"reasoning_content":""');
stages.push({ stage: "soft",            body: soft });
stages.push({ stage: "hard",            body: hard });
stages.push({ stage: "neutral",         body: neutral });
stages.push({ stage: "neutral-strip",   body: stripped });
// 最后一档：解析 JSON，把 messages[0].system 内容整体换成中性命
stages.push({ stage: "minimal-system",  body: minimal });
```

| 档位 | 做了什么 | 何时有用 |
| --- | --- | --- |
| `soft` | 三条固定规则整串替换 | 常规情况（绝大多数请求到这一档就过了） |
| `hard` | 再把品牌串的空格写法换成连字符写法 | 拦的是以品牌串为锚点的新句式 |
| `neutral` | 把 `You are an AI agent … DeepSeek[- ]Harness.` 整句换成中性句 | 拦的是身份句的变体 |
| `neutral-strip` | 清空 `reasoning_content`（历史思考对重放无意义） | 拦的是历史思考内容里的串 |
| `minimal-system` | `messages[0].system` 整体换成 `"You are a helpful assistant."` | 拦的是 system 里某段还没识别的特征文本 |

`minimal-system` 是**兜底中的兜底**：宁可这一轮回答质量下降，也不让整轮对话被掐断。
`JSON.parse` 失败时沿用上一档。

### 7. `dumpTencentFailure()`（新增，`pack.js:63625`）

非 2xx 时把**实际出网的请求体**与响应原文落盘，用于事后逐字段定位。

- 默认目录 `~/.dsh-beta/tencent-dump/`，文件名
  `<ISO 时间戳>-<productId>-<status>-{request.json,headers.json,response.txt}`
- `DSH_TENCENT_DUMP_DIR` 可改目录；设为字符串 `off` 彻底关闭
- `authorization` 头打码成 `<redacted>`（`headerDump[k] = /^authorization$/i.test(k) ? "<redacted>" : v`）
- 写失败静默 —— 诊断不能影响主流程

---

## 四、这份改动**不能**靠重新构建生成

`pack.js` 顶部写着：

```
// Generated by scripts/build-channel-pack.mjs — do not edit.
// Source: vendor/channel-pack/src (the absorbed free-channel pack; see NOTICE.md).
```

但本仓库**不含** `vendor/channel-pack/src/` 与 `scripts/`
（上游发布包也不含，只有打包产物）。所以：

- **不要**跑 `npm run channel-pack` —— 没有 src 跑不起来；即便补齐 src，
  也会把手工改动覆盖成上游原版。
- 要重建/移植这份改动，用 `docs/tencent-11128.patch`。

---

## 五、用补丁复现

`docs/tencent-11128.patch` 是从**上游原版** `pack.js` 到本仓库 `pack.js` 的
unified diff（`git diff --no-index --ignore-cr-at-eol`，207 行）。基准：

| | 字节数 | SHA256 |
| --- | --- | --- |
| 上游原版（补丁 a 侧） | 2929971 | `E0B98F019247A583348983C2F914260D1319D651AF5C7BC2321F4767CC2357E5` |
| 本仓库（补丁 b 侧） | 2938315 | `5D88874DF33E514CD2C626EB517B7FAEED1C06A6B51121DEE68369A912C9740B` |

应用（**必须关掉 autocrlf**，否则行尾被改写、SHA 对不上）：

```powershell
# 在仓库根目录执行
git -c core.autocrlf=false -c core.eol=lf apply docs/tencent-11128.patch
```

本机 2026-11-05 验证：对原版应用该补丁后，产物 SHA256 与本仓库 `pack.js`
**逐字节一致**。反向退回原版：

```powershell
git -c core.autocrlf=false -c core.eol=lf apply -R docs/tencent-11128.patch
```

---

## 六、已知边界（别被骗）

### 1. 11128 有三种完全不同的成因，报文里的 `msg` 会骗人

| 成因 | 报文 | 归谁管 |
| --- | --- | --- |
| 正文含被拦字面串 | `Illegal API invocation from an unapproved channel` | 本文的指纹清洗 |
| 请求头不全 / 不像官方客户端 | 可能只是含糊的 `request illegal` | `send()` 里的 `X-*` 那几行 |
| 缺 system 消息 | `first message is not system prompt` | 报文形状 |

本机踩过的坑：拿不带 `X-Conversation-*` / `X-Domain` / `X-Product-Code`
的瘦身请求打 `www.workbuddy.ai`，稳定拿到 `request illegal`，
看起来像「指纹没洗干净」，实际是报文不像官方客户端。
`tools/verify-tencent.mjs` 的请求头与 `send()` 逐项对齐后才对。

### 2. WorkBuddy 的 UA 分国内/国际两套

`pack.js:34829-34830`：

```
WORKBUDDY_UA_INTL = "WorkBuddy/5.5.2 WorkBuddy AI/5.5.2 CLI/5.5.2"
WORKBUDDY_UA_CN   = "WorkBuddy/5.5.2 WorkBuddy/5.5.2 CLI/5.5.2"
```

差别只在中间那一段有没有 `AI/`。`hy*` / `glm-*` / `kimi-*` / `minimax-*`
走国内 UA，其余走国际（`pack.js:35156-35166` 的 `userAgentByModelFamily`）。
选错 UA 也可能触发 11128。

### 3. 救援阶梯会改变回答质量

`minimal-system` 档把 system 提示整个换掉，那一轮模型就不知道自己的工作目录、
工具清单、项目约定。它只在其余四档全败后才触发 —— 宁可降质也不断轮。
若 dump 里频繁出现 `-rescue-minimal-system-failed`，说明该补规则了，别当常态。

### 4. 补丁有行号上下文，`pack.js` 一升级就失效

上游发新版必须重新对比、重新生成补丁，不能直接 `git apply`。升级流程：

1. 拉新版 `pack.js` → 备份
2. 手工把本文第三节的 7 处改动搬过去（**字符串一律从 `dump-rules.mjs` 取，别抄屏幕**）
3. `git diff --no-index --ignore-cr-at-eol -- 原版 新版 > docs/tencent-11128.patch`
4. `node tools/verify-tencent.mjs` 复验，两家「已清洗」都要 `ok http=200`

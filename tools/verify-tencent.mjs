// 验证本机 CodeBuddy / WorkBuddy 渠道是否真能出流。
//
// 用法：node tools/verify-tencent.mjs
// 需要 Node 22+（用全局 fetch）。凭据从 DSH 的凭据库里现读，不接受命令行传 token。
//
// 用途：
//   1) 确认账号凭据没过期、上游端点可达（http=200 且拿到 SSE 首包）；
//   2) 确认「插件里的魔改」在位 —— 从运行副本的 pack.js 里抽指纹模块求值，
//      对同一段系统提示做一次改写，再把「未清洗」与「已清洗」两条请求都发出去对比。
//
// 判定：
//   ok    http=200        上游放行
//   BLOCK 含 11128        被渠道指纹判定拦下
//   AUTH  http=401/403    token 过期或渠道不认这个账号，需在设置页重新登录
//
// 说明：探针**不自己硬编码**被拦截的句子 —— 那些句子直接从 pack.js 的
// CONTENT_FINGERPRINTS 规则里取 `find` 字段拼进系统提示。这样既不会因手抄出错，
// 也能保证测的就是插件真正在拦/改的那几个串。

import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE ?? process.env.HOME
const CRED = path.join(HOME, '.dsh-beta', '.credentials.yaml')
const PACK = path.join(
  HOME, '.dsh-beta', 'profiles', 'desktop', 'node_modules',
  'dsh-our-free-model', 'vendor', 'channel-pack', 'pack.js',
)

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/

function readCredText() {
  if (!fs.existsSync(CRED)) throw new Error(`凭据库不存在：${CRED}`)
  return fs.readFileSync(CRED, 'utf8')
}

/** 从明文凭据里按 key 前缀取第一条 JWT（key 形如 BUDDY_ACCOUNT_XXXXXXXX）。 */
function tokenOf(text, refPrefix) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()
    if (!trimmed.startsWith(refPrefix)) continue
    const key = trimmed.slice(0, trimmed.indexOf(':'))
    const m = lines.slice(i, i + 400).join('\n').match(JWT_RE)
    return { key, token: m ? m[0] : null }
  }
  return { key: null, token: null }
}

const CASES = [
  {
    name: 'buddy / CodeBuddy（copilot.tencent.com）',
    ref: 'BUDDY_ACCOUNT_',
    url: 'https://copilot.tencent.com/v2/chat/completions',
    model: 'deepseek-v4.1-flash',
    productId: 'buddy',
    headers: () => ({
      'X-Domain': 'copilot.tencent.com',
      'X-Product-Code': 'codebuddy',
      'X-Product': 'CodeBuddy',
      'X-Agent-Purpose': 'conversation',
      'X-IDE-Name': 'CodeBuddy',
      'X-IDE-Type': 'CodeBuddy',
      'X-IDE-Version': '1.106.1',
      'User-Agent': 'CodeBuddyIDE/1.106.1',
    }),
  },
  {
    name: 'workbuddy 国际版（workbuddy.ai）',
    ref: 'WORKBUDDY_ACCOUNT_',
    url: 'https://www.workbuddy.ai/v2/chat/completions',
    model: 'hy3',
    productId: 'workbuddy',
    // ⚠ 这里的头部必须和 pack.js 的 BuddyAdapter.send() 完全一致：
    // 少任何一个（尤其 X-Conversation-* 三个与 X-Domain / X-Product-Code）
    // 上游都会回 11128，且 msg 可能是 "request illegal" 这种含糊措辞 ——
    // 会被误判成「正文指纹没洗干净」。真实原因是请求不像官方客户端。
    headers: () => ({
      'X-Domain': 'www.workbuddy.ai',
      'X-Product-Code': 'workbuddy',
      'X-Product': 'WorkBuddy',
      'X-Agent-Purpose': 'conversation',
      'X-IDE-Name': 'WorkBuddy',
      'X-IDE-Type': 'WorkBuddy',
      'X-IDE-Version': '5.5.2',
      // hy3 属于国内系模型，按 pack.js 的 userAgentByModelFamily 走国内 UA。
      'User-Agent': 'WorkBuddy/5.5.2 WorkBuddy/5.5.2 CLI/5.5.2',
      'X-Conversation-ID': 'verify-' + Math.random().toString(36).slice(2, 10),
      'X-Conversation-Message-ID': 'verify-' + Math.random().toString(36).slice(2, 10),
      'X-Conversation-Request-ID': 'verify-' + Math.random().toString(36).slice(2, 10),
    }),
  },
]

/**
 * 从运行副本的 pack.js 里抽出指纹模块并求值 —— 即插件出网前真正会做的改写。
 * 抽取边界与构建产物结构绑定：从 `var TENCENT_PROVIDERS` 到其后的
 * `// vendor/channel-pack/src/` 注释之间就是那一整块。
 */
function loadFingerprintModule() {
  if (!fs.existsSync(PACK)) return null
  const src = fs.readFileSync(PACK, 'utf8')
  const start = src.indexOf('var TENCENT_PROVIDERS')
  if (start < 0) return null
  const end = src.indexOf('// vendor/channel-pack/src/', start)
  if (end <= start) return null
  const body = src.slice(start, end)
  return new Function(
    `${body}\nreturn { rewriteTencentContentFingerprints, CONTENT_FINGERPRINTS, isTencentContentFingerprintProvider };`,
  )()
}

/**
 * 造一段接近真实会话的 DSH 系统提示：
 * 把**全部**规则的 find 原文各占一行嵌进去（这样三条规则都会被实际触发），
 * 再补上工具段与环境段，让报文形状接近真实会话。
 */
function buildSystemPrompt(fp) {
  const rules = fp?.CONTENT_FINGERPRINTS ?? []
  const fingerprintLines = rules.length
    ? rules.map((r) => r.find)
    : ['You are a helpful assistant.']
  return [
    ...fingerprintLines,
    '',
    'You are a coding agent. Inspect files before editing.',
    '',
    '# Tools',
    '## bash',
    'Runs a shell command in the workspace.',
    '',
    '# Environment',
    `Working directory: ${process.cwd()}`,
    'Platform: win32',
  ].join('\n')
}

function analyze(res, text) {
  if (res.status === 401 || res.status === 403) return { verdict: 'AUTH', note: 'token 过期或账号不被认可' }
  if (/first message is not system prompt/i.test(text)) {
    return { verdict: 'SHAPE', note: '首条不是 system —— 探针构造问题，不是指纹问题' }
  }
  if (/11128|Illegal API invocation|unapproved channel|request illegal/i.test(text)) {
    return { verdict: 'BLOCK', note: '被渠道指纹判定拦下' }
  }
  if (!res.ok) return { verdict: 'HTTP', note: `HTTP ${res.status}` }
  if (!text.trim()) return { verdict: 'EMPTY', note: '200 但响应体为空' }
  return { verdict: 'ok', note: '' }
}

async function probe(label, c, token, systemContent) {
  const res = await fetch(c.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...c.headers(),
    },
    body: JSON.stringify({
      model: c.model,
      stream: true,
      max_tokens: 32,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: '用一句话回答：你好' },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  })
  const text = await res.text()
  const { verdict, note } = analyze(res, text)
  console.log(`${verdict.padEnd(5)} ${label.padEnd(28)} http=${res.status} bytes=${text.length}${note ? '  ' + note : ''}`)
  if (verdict !== 'ok') console.log('      ', text.replace(/\s+/g, ' ').slice(0, 240))
  return verdict === 'ok'
}

async function main() {
  const cred = readCredText()
  const fp = loadFingerprintModule()

  if (fp) {
    console.log(`指纹规则 ${fp.CONTENT_FINGERPRINTS.length} 条，魔改符号在位：`)
    // ⚠ 这里**故意不打印规则原文**。本机实测：终端/编辑器/聊天窗口会把品牌串的
    // 空格写法与连字符写法互相改写，打印出来再被读回去就会得到错误的字符串，
    // 而那种错误极难发现（看起来像"补丁失效"）。要读原文请用 tools/dump-rules.mjs。
    for (const [i, r] of fp.CONTENT_FINGERPRINTS.entries()) {
      const same = r.find === r.replace
      console.log(`  [${i}] find ${r.find.length} 字符 / replace ${r.replace.length} 字符${
        same ? '（无改写）' : '（改写）'
      }`)
    }
    console.log('  → 需要看规则原文：node tools/dump-rules.mjs')
  } else {
    console.log('⚠ 没能从 pack.js 抽出指纹模块：可能装的是未魔改的上游包，或构建产物结构变了。')
  }

  const rawSystem = buildSystemPrompt(fp)
  const patchedSystem = fp ? fp.rewriteTencentContentFingerprints(rawSystem, 'buddy') : rawSystem
  const changed = patchedSystem !== rawSystem
  console.log(`\n系统提示被改写：${changed ? '是（魔改生效）' : '否 —— 规则没命中，检查 pack.js 是否被覆盖'}`)
  if (changed) {
    // 同样只报差异的字符数，不打印原文（理由同上）
    let diff = 0
    for (let i = 0; i < Math.max(rawSystem.length, patchedSystem.length); i++) {
      if (rawSystem[i] !== patchedSystem[i]) diff++
    }
    console.log(`  改写前后长度 ${rawSystem.length} → ${patchedSystem.length}，差异字符 ${diff}`)
  }
  console.log('')

  for (const c of CASES) {
    const { key, token } = tokenOf(cred, c.ref)
    if (!token) {
      console.log(`SKIP  ${c.name}：凭据库里没有 ${c.ref}* 的 JWT`)
      continue
    }
    console.log(`—— ${c.name}（${key}）——`)
    await probe('未清洗（历史写法）', c, token, rawSystem)
    await probe('已清洗（插件实发）', c, token, patchedSystem)
    console.log('')
  }
}

main().catch((e) => {
  console.error('探针失败：', e?.message ?? e)
  process.exitCode = 1
})

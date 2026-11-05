// 打印 pack.js 里 CONTENT_FINGERPRINTS 三条规则的**逐字节原文**。
//
// 为什么需要这个工具：这些字符串里混着空格与连字符的细微差异 —— 规则 1 的品牌词
// 是 `DeepSeek` + **空格** + `Harness`，而 hard 档 join 出来的是连字符写法。
// 任何"手抄"或"从屏幕/聊天窗口复制"都可能悄悄改掉一个字符；更糟的是某些显示层
// 会把这两种写法互相改写，于是文件里是空格、你看屏幕以为是连字符，抄进代码必然匹配不上，
// 而症状看起来只是"补丁没生效"，极难查。
//
// 唯一可靠的读法：从文件里求值后用 JSON.stringify 出来，或转义成纯 ASCII。
// 本工具同时提供两种输出。
//
// 用法：
//   node tools/dump-rules.mjs                 # 人读：逐码点差异
//   node tools/dump-rules.mjs --json          # 机读：JSON
//   node tools/dump-rules.mjs --emit-doc      # 生成 docs/FINGERPRINTS.txt
//   node tools/dump-rules.mjs <pack.js 路径>   # 指定文件

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const explicitPath = args.find((a) => !a.startsWith('--'))

const HOME = process.env.USERPROFILE ?? process.env.HOME
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const PACK = explicitPath ?? path.join(ROOT, 'vendor', 'channel-pack', 'pack.js')

if (!fs.existsSync(PACK)) {
  console.error(`pack.js 不存在：${PACK}`)
  console.error('（若插件装在别处，把 pack.js 路径作为参数传进来）')
  process.exit(1)
}

const src = fs.readFileSync(PACK, 'utf8')
const start = src.indexOf('var CONTENT_FINGERPRINTS')
const end = src.indexOf('var COMPILED')
if (start < 0 || end <= start) {
  console.error('没找到 CONTENT_FINGERPRINTS 区块；构建产物结构可能变了。')
  process.exit(1)
}

const { CONTENT_FINGERPRINTS } = new Function(
  `${src.slice(start, end)}\nreturn { CONTENT_FINGERPRINTS };`,
)()

/** 转义成纯 ASCII：空格 → \x20，连字符 → \x2D，其余可打印原样，非 ASCII → \u{XXXX}。 */
function escapeAll(s) {
  let out = ''
  for (const c of s) {
    const n = c.codePointAt(0)
    if (n === 0x20) out += '\\x20'
    else if (n === 0x2d) out += '\\x2D'
    else if (n >= 0x21 && n <= 0x7e) out += c
    else out += `\\u{${n.toString(16).toUpperCase().padStart(4, '0')}}`
  }
  return out
}

/** hard 档的三段字面量（includes / split / join），从函数体里按行取。 */
function hardLiterals() {
  const lines = src.split(/\r?\n/)
  const fnAt = lines.findIndex((l) => l.includes('function rewriteTencentBodyFingerprintsHard'))
  if (fnAt < 0) return null
  const body = lines.slice(fnAt, fnAt + 12)
  const inc = body.find((l) => l.includes('.includes('))
  const join = body.find((l) => l.includes('.join('))
  const lit = (s) => [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1])
  if (!inc || !join) return null
  const incLit = lit(inc)[0]
  const joinLit = lit(join)
  return { includes: incLit, split: joinLit[0], join: joinLit[1] }
}

if (flags.has('--json')) {
  console.log(JSON.stringify({
    pack: PACK,
    rules: CONTENT_FINGERPRINTS.map((r) => ({
      find: r.find, replace: r.replace, note: r.note,
      findLen: r.find.length, replaceLen: r.replace.length,
    })),
    hard: hardLiterals(),
  }, null, 2))
  process.exit(0)
}

if (flags.has('--emit-doc')) {
  const hard = hardLiterals()
  const lines = []
  lines.push('# 指纹规则原文（机器导出，勿手改）')
  lines.push('')
  lines.push('本文件由 `node tools/dump-rules.mjs --emit-doc` 生成，内容是从')
  lines.push('`vendor/channel-pack/pack.js` 求值得到的**真实字节**。')
  lines.push('')
  lines.push('记法：`\\x20` = ASCII 空格（U+0020），`\\x2D` = 连字符（U+002D）。')
  lines.push('这两个字符是全文唯一容易看漏的地方，所以一律转义，不做任何"看起来更好"的处理。')
  lines.push('')
  for (const [i, r] of CONTENT_FINGERPRINTS.entries()) {
    lines.push(`## 规则 ${i}`)
    lines.push('')
    lines.push('```')
    lines.push(`find    (${r.find.length} 字符): "${escapeAll(r.find)}"`)
    lines.push(`replace (${r.replace.length} 字符): "${escapeAll(r.replace)}"`)
    if (r.note) lines.push(`note          : ${r.note}`)
    lines.push('```')
    lines.push('')
  }
  if (hard) {
    lines.push('## 规则 hard（`rewriteTencentBodyFingerprintsHard`）')
    lines.push('')
    lines.push('```')
    lines.push(`includes   : "${escapeAll(hard.includes)}"`)
    lines.push(`split      : "${escapeAll(hard.split)}"`)
    lines.push(`join       : "${escapeAll(hard.join)}"`)
    lines.push('```')
    lines.push('')
  }
  const outPath = path.join(ROOT, 'docs', 'FINGERPRINTS.txt')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
  console.log(`已写入 ${outPath}`)
  process.exit(0)
}

// 人读输出
console.log(`来源：${PACK}`)
console.log(`规则数：${CONTENT_FINGERPRINTS.length}\n`)

for (const [i, rule] of CONTENT_FINGERPRINTS.entries()) {
  const same = rule.find === rule.replace
  console.log(`[${i}] ${same ? '（无改写，仅做存在性检测）' : '改写'}`)
  console.log(`    find    (${rule.find.length} 字符): "${escapeAll(rule.find)}"`)
  console.log(`    replace (${rule.replace.length} 字符): "${escapeAll(rule.replace)}"`)
  if (!same) {
    const a = [...rule.find]
    const b = [...rule.replace]
    const rows = []
    for (let k = 0; k < Math.max(a.length, b.length); k++) {
      if (a[k] === b[k]) continue
      const cp = (c) => (c === undefined ? '∅' : `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      rows.push(`#${k} ${cp(a[k])}→${cp(b[k])}`)
    }
    console.log(`    差异: ${rows.join('  ')}`)
  }
  if (rule.note) console.log(`    备注: ${rule.note}`)
  console.log('')
}

const hard = hardLiterals()
if (hard) {
  console.log('--- hard 档字面量 ---')
  console.log(`  includes: "${escapeAll(hard.includes)}"`)
  console.log(`  split   : "${escapeAll(hard.split)}"`)
  console.log(`  join    : "${escapeAll(hard.join)}"`)
} else {
  console.log('hard 档不存在 —— 这不是魔改版 pack.js')
}

console.log('\n--- 救援阶梯自检 ---')
for (const s of ['soft', 'hard', 'neutral', 'neutral-strip', 'minimal-system']) {
  console.log(`  ${s.padEnd(15)} ${src.includes(`stage: "${s}"`) ? '在位' : '缺失'}`)
}

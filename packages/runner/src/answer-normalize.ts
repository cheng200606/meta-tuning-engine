// 最终答案归一化（M3 偏离单 DEV-01 的核心组件）。
// 动机：G0 审计发现 36 集失败属「答案含 yes 但不严格等于 yes」的测量假象——判定器在测
// 格式合规性而非任务能力，且该假象与 prompt_style 强相关（回答冗长度 → 判定失败），
// 足以伪造出「配置敏感性」。本模块把判定从「字符串严格相等」改为「语义等价匹配」。
// 纯函数、零依赖、可单测；不改变任何任务指令或 expected 语义。

/** 全角 → 半角（数字、字母与常用标点）。 */
function toHalfWidth(input: string): string {
  return input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，。：；！？（）【】「」“”‘’]/g, (c) => ({
      '，': ',', '。': '.', '：': ':', '；': ';', '！': '!', '？': '?',
      '（': '(', '）': ')', '【': '[', '】': ']', '「': '"', '」': '"', '“': '"', '”': '"', '‘': "'", '’': "'",
    } as Record<string, string>)[c] ?? c)
    .replace(/[＝＋－＊／％＜＞｜～]/g, (c) => ({
      '＝': '=', '＋': '+', '－': '-', '＊': '*', '／': '/', '％': '%',
      '＜': '<', '＞': '>', '｜': '|', '～': '~',
    } as Record<string, string>)[c] ?? c)
}

/**
 * 归一化最终答案：
 * 去代码围栏内容保留、去行内代码、去 markdown 强调、全角→半角、去千分位逗号、收敛空白。
 */
export function normalizeAnswer(raw: string): string {
  let text = raw
  // 代码围栏：保留围栏内内容（模型常把结论包在 ``` 里）
  text = text.replace(/```[a-zA-Z0-9+-]*\n?([\s\S]*?)```/g, '$1')
  // 行内代码
  text = text.replace(/`([^`]*)`/g, '$1')
  // markdown 强调（**bold** / __bold__ / *italic* / _italic_ / ~~strike~~）
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/~~([^~]+)~~/g, '$1')
  text = text.replace(/\*([^*\n]+)\*/g, '$1')
  text = text.replace(/_([^_\n]+)_/g, '$1')
  text = toHalfWidth(text)
  // 千分位逗号：1,234,567 → 1234567（只处理数字组内的逗号）
  for (let i = 0; i < 3; i++) text = text.replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  // 收敛空白
  return text.replace(/\s+/g, ' ').trim()
}

/** 中文是/否的排除词（避免「是否/不是/否则/正是」被误判）。 */
const CN_GUARDS = ['是否', '不是', '否则', '正是', '但是', '仍是', '但是', '与否']

/**
 * 抽取 yes/no 判定：取**最后一个**独立出现的 yes/no/true/false 词元；
 * 同时支持中文「是/否」（排除「是否/不是/否则」等固定搭配）。
 * 无明确判定返回 null（交给判定器判失败）。
 */
export function canonicalYesNo(raw: string): 'yes' | 'no' | null {
  const text = normalizeAnswer(raw)
  const tokens: Array<{ value: 'yes' | 'no'; index: number }> = []
  const re = /\b(yes|no|true|false)\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const word = match[1].toLowerCase()
    tokens.push({ value: word === 'yes' || word === 'true' ? 'yes' : 'no', index: match.index })
  }
  // 中文判定（排除固定搭配后取最后一个独立字）
  let cnLast: { value: 'yes' | 'no'; index: number } | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch !== '是' && ch !== '否') continue
    const around = text.slice(Math.max(0, i - 1), i + 2)
    if (CN_GUARDS.some((g) => around.includes(g))) continue
    cnLast = { value: ch === '是' ? 'yes' : 'no', index: i }
  }
  if (cnLast !== null) tokens.push(cnLast)
  if (tokens.length === 0) return null
  return tokens.sort((a, b) => a.index - b.index)[tokens.length - 1].value
}

/** 抽取答案中出现的所有数字（支持小数、负号；千分位已在归一化中去除）。 */
export function canonicalNumbers(raw: string): number[] {
  const text = normalizeAnswer(raw)
  const out: number[] = []
  const re = /-?\d+(?:\.\d+)?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const value = Number(match[0])
    if (!Number.isNaN(value)) out.push(value)
  }
  return out
}

/** 答案是否包含某个数字（任一出现即视为命中——比严格相等宽松，避免「98.6 华氏 = 37 摄氏度」被误杀）。 */
export function answerHasNumber(raw: string, expected: number): boolean {
  return canonicalNumbers(raw).some((n) => n === expected)
}

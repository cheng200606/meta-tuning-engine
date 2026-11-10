// G0 mock 工具环境：全部本地确定性、零 API 成本。工具返回 error 记一次错误调用（协议 §3）。
import { VirtualFS } from './virtual-fs.js'
import { cityTable, ordersTable, weatherTable } from './data-tables.js'
import { runJsAssertions } from './run-js.js'

export interface ToolResult {
  content: string
  isError: boolean
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const toolDefs: ToolDef[] = [
  { name: 'read_file', description: 'Read a text file from the task workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Write text content to a file in the task workspace.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'list_dir', description: 'List entries of a directory in the task workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'calculate', description: 'Evaluate an arithmetic expression (+ - * / and parentheses).', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'get_weather', description: 'Get today weather (temperature in Celsius) for a city.', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
  { name: 'get_city_info', description: 'Get population and province of a city.', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
  { name: 'query_orders', description: 'Query all order amounts (CNY) of a customer.', parameters: { type: 'object', properties: { customer_id: { type: 'string' } }, required: ['customer_id'] } },
  { name: 'run_js', description: 'Run JavaScript code in a sandbox (2s timeout) and return the last expression value.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } },
]

// 安全算术求值：递归下降，仅数字与 + - * / ( )，拒绝一切其他字符（不用 eval）
export function safeCalculate(expression: string): number {
  const matched = expression.match(/\d+(?:\.\d+)?|[+\-*/()]/g)
  if (matched === null || matched.join('') !== expression.replace(/\s/g, '')) {
    throw new Error(`unsupported expression: ${expression}`)
  }
  const tokens = matched
  let pos = 0
  const peek = () => tokens[pos]
  function parseExpr(): number {
    let value = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++]
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }
  function parseTerm(): number {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++]
      const rhs = parseFactor()
      value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }
  function parseFactor(): number {
    const token = tokens[pos++]
    if (token === '(') {
      const value = parseExpr()
      if (tokens[pos++] !== ')') throw new Error('unbalanced parentheses')
      return value
    }
    if (token === '-') return -parseFactor()
    const value = Number(token)
    if (Number.isNaN(value)) throw new Error(`invalid token: ${token}`)
    return value
  }
  const result = parseExpr()
  if (pos !== tokens.length) throw new Error('unexpected trailing tokens')
  return result
}

export class MockTools {
  readonly fs: VirtualFS

  constructor(fixture: Record<string, string>) {
    this.fs = new VirtualFS(fixture)
  }

  call(name: string, args: Record<string, unknown>): ToolResult {
    try {
      return { content: this.dispatch(name, args), isError: false }
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), isError: true }
    }
  }

  private dispatch(name: string, args: Record<string, unknown>): string {
    const str = (key: string): string => {
      const value = args[key]
      if (typeof value !== 'string') throw new Error(`parameter ${key} must be a string`)
      return value
    }
    switch (name) {
      case 'read_file':
        return this.fs.read(str('path'))
      case 'write_file':
        this.fs.write(str('path'), str('content'))
        return 'written'
      case 'list_dir':
        return JSON.stringify(this.fs.list(typeof args.path === 'string' ? args.path : ''))
      case 'calculate':
        return String(safeCalculate(str('expression')))
      case 'get_weather': {
        const city = str('city')
        const temp = weatherTable[city]
        if (temp === undefined) throw new Error(`unknown city: ${city}`)
        return JSON.stringify({ city, date: 'today', temperature_c: temp })
      }
      case 'get_city_info': {
        const city = str('city')
        const info = cityTable[city]
        if (info === undefined) throw new Error(`unknown city: ${city}`)
        return JSON.stringify({ city, ...info })
      }
      case 'query_orders': {
        const id = str('customer_id')
        const orders = ordersTable[id]
        if (orders === undefined) throw new Error(`unknown customer: ${id}`)
        return JSON.stringify({ customer_id: id, amounts: orders })
      }
      case 'run_js': {
        const result = runJsAssertions(str('code'), ['true'])
        return result.pass ? 'executed' : result.reason
      }
      default:
        throw new Error(`unknown tool: ${name}`)
    }
  }
}
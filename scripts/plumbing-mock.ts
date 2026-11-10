// 流水线自检用假 OpenAI 兼容端点（不是 G0 实验基座，仅验证实验机器）。
// 行为：首轮发一个 calculate 工具调用，收到工具结果后回答固定文本。
import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 8123)
const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const parsed = JSON.parse(body) as { messages: Array<{ role: string }> }
    const hasToolResult = parsed.messages.some((m) => m.role === 'tool')
    const message = hasToolResult
      ? { role: 'assistant', content: '1500' }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"100+200+300+400+500"}' } }],
        }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message, finish_reason: hasToolResult ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    }))
  })
})
server.listen(port, '127.0.0.1', () => console.log(`plumbing mock on http://127.0.0.1:${port}`))
// prompt_style 的最终文本（G0 开跑前冻结；修改 = 偏离协议，需重跑）
export const promptTemplates: Record<string, string> = {
  concise: 'You are an efficient assistant. Use the provided tools when needed and answer directly with minimal explanation.',
  step_by_step: 'You are a step-by-step reasoning assistant. Decompose the task into steps, execute them one by one with the provided tools, then give the final answer.',
  constrained: 'You are a strict assistant. Follow the task exactly, use only the provided tools, verify each tool result before proceeding, and output only what the task asks for.',
}
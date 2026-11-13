// dev 任务集 fixtures（构造规范见 tasks/dev/README.md；数据表复用 G0 冻结资产）

export const fixturesByTask: Record<string, Record<string, string>> = {
  'dev-tool-01': { 'numbers.txt': '12\n34\n56\n78\n' },
  'dev-tool-02': {},
  'dev-reas-01': {},
  'dev-reas-02': { 'rules.txt': 'x=5\ny=x*7\nz=y-9\n' },
  'dev-code-01': {},
  'dev-code-02': {},
  'dev-tool-03': { 'notes.txt': 'ticket=Q7-42\n' },
  'dev-tool-04': { 'expr.txt': '(12+8)*3\n' },
  'dev-tool-05': {},
  'dev-tool-06': {},
  'dev-reas-03': {},
  'dev-reas-04': {},
  'dev-reas-05': {},
  'dev-reas-06': {},
  'dev-code-03': {},
  'dev-code-04': {},
  'dev-code-05': {},
  'dev-code-06': {},
}

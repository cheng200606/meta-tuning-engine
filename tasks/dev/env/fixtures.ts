// dev 任务集 fixtures（构造规范见 tasks/dev/README.md；数据表复用 G0 冻结资产）

export const fixturesByTask: Record<string, Record<string, string>> = {
  'dev-tool-01': { 'numbers.txt': '12\n34\n56\n78\n' },
  'dev-tool-02': {},
  'dev-reas-01': {},
  'dev-reas-02': { 'rules.txt': 'x=5\ny=x*7\nz=y-9\n' },
  'dev-code-01': {},
  'dev-code-02': {},
}

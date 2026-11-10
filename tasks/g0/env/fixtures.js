// G0 预置数据与固定数据表（与 tasks.manifest.json 的 fixtures 描述一致，冻结后不得修改）
export const fixturesByTask = {
    'g0-tool-01': { 'sales.csv': '100\n200\n300\n400\n500\n' },
    'g0-tool-02': {},
    'g0-tool-03': {
        'orders.json': '{"order_id": "ORD-2026-0042"}',
        'notes.txt': 'unrelated notes',
        'data.csv': 'x,y\n1,2\n',
    },
    'g0-tool-04': {},
    'g0-reas-01': {},
    'g0-reas-02': {},
    'g0-reas-03': {},
    'g0-reas-04': { 'rules.txt': 'a=3\nb=a*4\nc=b+5\n' },
    'g0-code-01': {},
    'g0-code-02': {},
    'g0-code-03': {
        'bug_sort.js': [
            'function bubbleSort(arr) {',
            '  const a = arr.slice();',
            '  for (let i = 0; i < a.length - 1; i++) {',
            '    for (let j = 0; j < a.length - 2; j++) {',
            '      if (a[j] > a[j + 1]) { const t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }',
            '    }',
            '  }',
            '  return a;',
            '}',
        ].join('\n'),
    },
    'g0-code-04': {},
};
export const weatherTable = { 北京: 5, 上海: 12, 广州: 24 };
export const cityTable = {
    上海: { population: 24870000, province: '上海' },
    杭州: { population: 12520000, province: '浙江' },
};
export const ordersTable = { C001: [300, 450, 300] };

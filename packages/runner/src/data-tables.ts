// G0 固定数据表（与 tasks.manifest.json 的 fixtures 描述一致，冻结后不得修改）
export const weatherTable: Record<string, number> = { 北京: 5, 上海: 12, 广州: 24 }

export const cityTable: Record<string, { population: number; province: string }> = {
  上海: { population: 24870000, province: '上海' },
  杭州: { population: 12520000, province: '浙江' },
}

export const ordersTable: Record<string, number[]> = { C001: [300, 450, 300] }
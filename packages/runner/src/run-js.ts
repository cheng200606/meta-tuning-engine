// node:vm 沙箱执行 solution.js 并跑断言（2s 超时）。仅用于 G0 代码类任务判定。
// M3 偏离单 DEV-01：加入 CommonJS 垫片——模型常按 Node 习惯写 module.exports = function，
// 原实现把它当 ReferenceError（31 集测量假象）。垫片在模型代码执行后把导出绑定为全局，
// 使断言能按名调用导出的函数。语义不变：断言仍是同一组表达式。
import vm from 'node:vm'

/** 从模型代码推断导出的标识符（module.exports = function NAME / = NAME / exports.NAME =）。 */
function inferExportName(code: string): string | null {
  const patterns = [
    /module\.exports\s*=\s*function\s+([A-Za-z_$][\w$]*)/,
    /module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*[;\n]/,
    /exports\.([A-Za-z_$][\w$]*)\s*=/,
    /module\.exports\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*:/,
  ]
  for (const re of patterns) {
    const m = re.exec(code)
    if (m !== null) return m[1]
  }
  return null
}

/** 标准内置名（不得被导出函数遮蔽，否则会破坏断言表达式本身）。 */
const RESERVED = new Set([
  'Boolean', 'JSON', 'String', 'Number', 'Array', 'Object', 'Math', 'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'Error', 'TypeError',
  'Promise', 'Symbol', 'BigInt', 'console', 'globalThis', 'module', 'exports', 'require', 'undefined', 'NaN', 'Infinity',
])

/** 断言表达式里被调用的标识符（用于把导出绑定到正确的名字上）。 */
function assertedCallables(assertions: string[]): string[] {
  const names = new Set<string>()
  for (const a of assertions) {
    const re = /\b([A-Za-z_$][\w$]*)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(a)) !== null) {
      if (!RESERVED.has(m[1])) names.add(m[1])
    }
  }
  return [...names]
}

export function runJsAssertions(code: string, assertions: string[]): { pass: boolean; reason: string } {
  const context = vm.createContext({})
  try {
    // 阶段 0：CommonJS 垫片（var 声明在全局作用域，模型代码可直接使用 module/exports）。
    // require 返回宽松 stub：模型常写「不需要的 require 导入」（G0 诊断 4 集 `require is not defined`，
    // 与 prompt_style 相关）——未使用的 require 自然通过；真依赖外部库行为的代码会断言失败（不放水）。
    vm.runInContext(
      "var module = { exports: {} }; var exports = module.exports;\n"
      + "var require = function (name) { return new Proxy({}, { get: function () { return function () { return undefined; } }, apply: function () { return undefined; } }); };",
      context,
    )
    // 阶段 1：执行模型代码
    vm.runInContext(code, context, { timeout: 2000 })
    // 阶段 2：把 module.exports 绑定为全局（模型按 CommonJS 习惯导出时的兼容层）
    const names = assertedCallables(assertions)
    const inferred = inferExportName(code)
    vm.runInContext(
      `(function () {
        var candidates = ${JSON.stringify(names)};
        var inferred = ${JSON.stringify(inferred)};
        var exp = (typeof module !== 'undefined' && module) ? module.exports : undefined;
        function bind(name, value) {
          if (typeof name === 'string' && /^[A-Za-z_$][\\w$]*$/.test(name)) {
            try { globalThis[name] = value; } catch (e) { /* 不可写则跳过 */ }
          }
        }
        if (exp === undefined || exp === null) return;
        if (typeof exp === 'function') {
          if (typeof exp.name === 'string' && exp.name !== '' && exp.name !== 'anonymous') bind(exp.name, exp);
          if (inferred !== null && inferred !== exp.name) bind(inferred, exp);
          // 断言里以裸标识符调用的名字若尚未定义，把导出绑定上去（模型匿名导出 function 的常见情形）。
          // 方法名（sort/join 等）只以 arr.sort() 形式出现，绑定同名全局不影响其解析。
          for (var i = 0; i < candidates.length; i++) {
            var n = candidates[i];
            if (globalThis[n] === undefined && exp[n] === undefined) bind(n, exp);
          }
        } else if (typeof exp === 'object') {
          for (var k in exp) { bind(k, exp[k]); }
          if (inferred !== null && exp[inferred] === undefined) bind(inferred, exp);
        }
      })();`,
      context,
    )
    // 阶段 3：跑断言
    vm.runInContext(`globalThis.__results = [${assertions.map((a) => `Boolean(${a})`).join(',')}];`, context, { timeout: 2000 })
    const results = (context as { __results?: boolean[] }).__results
    if (!Array.isArray(results)) return { pass: false, reason: 'no assertion results' }
    const failed = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0)
    return failed.length === 0
      ? { pass: true, reason: 'ok' }
      : { pass: false, reason: `assertions failed: ${failed.join(',')}` }
  } catch (error) {
    return { pass: false, reason: `vm error: ${error instanceof Error ? error.message : String(error)}` }
  }
}

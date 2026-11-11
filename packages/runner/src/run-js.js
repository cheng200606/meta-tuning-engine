// node:vm 沙箱执行 solution.js 并跑断言（2s 超时）。仅用于 G0 代码类任务判定。
import vm from 'node:vm';
export function runJsAssertions(code, assertions) {
    const harness = `${code}\n;globalThis.__results = [${assertions.map((a) => `Boolean(${a})`).join(',')}];`;
    try {
        const context = vm.createContext({});
        vm.runInContext(harness, context, { timeout: 2000 });
        const results = context.__results;
        if (!Array.isArray(results))
            return { pass: false, reason: 'no assertion results' };
        const failed = results.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
        return failed.length === 0
            ? { pass: true, reason: 'ok' }
            : { pass: false, reason: `assertions failed: ${failed.join(',')}` };
    }
    catch (error) {
        return { pass: false, reason: `vm error: ${error instanceof Error ? error.message : String(error)}` };
    }
}

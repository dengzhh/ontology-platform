import vm from 'node:vm'

/**
 * 本体函数沙箱执行引擎。
 *
 * 约定函数体形如 `function main(input) { ... return ... }`，在 `node:vm` 的隔离上下文里真实执行：
 * - 仅注入 input / Math / JSON / Date / String / Number / Array / Object，其余危险全局一律屏蔽；
 * - 关闭字符串代码生成（eval / Function）并加固 constructor 逃逸链；
 * - 单次执行 2 秒超时，语法错误 / 运行错误 / 超时统一收敛为结构化结果。
 */

export interface FunctionRunResult {
  ok: boolean
  result: unknown
  error: string
  durationMs: number
}

/** 单次执行超时（毫秒） */
const TIMEOUT_MS = 2000

/**
 * vm 执行选项：2 秒超时 + 关闭字符串代码生成（eval / Function / new Function）。
 * 注：`contextCodeGeneration` 是 runInNewContext 的类型化选项（等价于往期无类型的 codeGeneration）。
 */
const VM_OPTIONS: vm.RunningCodeInNewContextOptions = {
  timeout: TIMEOUT_MS,
  contextCodeGeneration: { strings: false, wasm: false },
}

/**
 * 加固前导：阻断通过 `xxx.constructor.constructor('...')()` 拿到宿主 Function 的逃逸。
 * 这些修改作用于当前 vm 上下文自身的 intrinsics（每次 runInNewContext 都是全新 realm），
 * 不会污染宿主进程。
 */
const HARDEN = [
  'var __IObj = ({}).constructor;',
  'var __IFn = __IObj.constructor;',
  'var __define = __IObj.defineProperty;',
  '__define(__IObj.prototype, "constructor", { value: undefined, writable: false, configurable: false });',
  '__define(__IFn.prototype, "constructor", { value: undefined, writable: false, configurable: false });',
  'for (var __b of [Math, JSON, Date, String, Number, Array, Object]) {',
  '  try { __define(__b, "constructor", { value: undefined, writable: false, configurable: false }); } catch (e) {}',
  '}',
].join('\n')

/** 为带 constructor 的内置对象构造每次执行独立的浅副本，避免加固时改动宿主内置对象（Math / JSON 的 constructor 是宿主共享属性） */
function buildSandbox(input: unknown): Record<string, unknown> {
  const mathClone: Record<string, unknown> = Object.create(null)
  for (const k of Object.getOwnPropertyNames(Math)) mathClone[k] = (Math as unknown as Record<string, unknown>)[k]
  const jsonClone = { parse: JSON.parse, stringify: JSON.stringify }
  return {
    input,
    Math: mathClone,
    JSON: jsonClone,
    Date,
    String,
    Number,
    Array,
    Object,
    /* 明确屏蔽的高危全局：在沙箱内均为 undefined（配合 codeGeneration 关闭，eval/Function 不可用） */
    require: undefined,
    process: undefined,
    global: undefined,
    fetch: undefined,
    eval: undefined,
    Function: undefined,
    /* 执行结果回传槽：vm 内对沙箱对象属性的写入会反映到宿主对象 */
    __capture__: undefined,
  }
}

/** 把 vm 跨 realm 的返回值规整成宿主侧的纯 JSON 值（处理 undefined / 函数 / BigInt / 循环引用） */
function normalize(value: unknown): unknown {
  if (value === undefined) return null
  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'bigint') return String(v)
      if (typeof v === 'function') return `[Function ${(v as { name?: string }).name || 'anonymous'}]`
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return v
    })
    return json === undefined ? null : (JSON.parse(json) as unknown)
  } catch (e) {
    return `[不可序列化结果：${e instanceof Error ? e.message : String(e)}]`
  }
}

/**
 * 在隔离沙箱中真实执行函数体。
 * 始终返回结构化结果，绝不向调用方抛错。
 */
export function runFunction(body: string, input: unknown): FunctionRunResult {
  const start = Date.now()
  const sandbox = buildSandbox(input)
  // 追加调用语句；main 未定义 / 不是函数时会自然抛错并被捕获
  const code = `${HARDEN}\n${body}\n;__capture__ = main(input);`
  try {
    vm.runInNewContext(code, sandbox, VM_OPTIONS)
    return {
      ok: true,
      result: normalize(sandbox.__capture__),
      error: '',
      durationMs: Date.now() - start,
    }
  } catch (e) {
    return {
      ok: false,
      result: null,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      durationMs: Date.now() - start,
    }
  }
}

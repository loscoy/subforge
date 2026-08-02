/**
 * 结构化日志：一条一个对象，Workers Logs 会把字段拆开建索引，可以直接按
 * `event` / `threadId` 过滤，`wrangler tail` 里也照样可读。
 *
 * 刻意只用 console：Node 与 Workers 都有，无依赖，边缘可移植。
 *
 * ⚠️ 时间字段的含义与别处不同。Workers 出于 Spectre 防护，时钟只在 I/O 发生时前进
 * （见 workers/observability/traces/known-limitations），纯计算段落测出来是 0ms。
 * 所以这里的 `*Ms` 只在跨越 I/O 的区间才有意义，**衡量计算量要看次数（`events` / 各类计数）**，
 * 再配合平台在 invocation 记录里给的总 `cpuTimeMs` 反推每次的均摊成本。
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log({ event, ...fields })
}

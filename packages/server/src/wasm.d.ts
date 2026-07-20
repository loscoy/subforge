// wrangler/esbuild 把 .wasm 作为 CompiledWasm 模块加载（启动期编译成 WebAssembly.Module），
// 规避 workerd 禁止的「运行时从字节编译 wasm」。用 unknown，使用处再断言。
declare module '*.wasm' {
  const wasmModule: unknown
  export default wasmModule
}

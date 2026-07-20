// 把 QuickJS 变体的 wasm 拷贝进 worker 包内（src/quickjs.wasm），
// 使其位于 worker root 内，让 wrangler 以 CompiledWasm 模块加载（workerd 需启动期编译）。
// 由 precf:dev / precf:deploy 自动执行；产物已 gitignore。
import { createRequire } from 'node:module'
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgJson = require.resolve('@jitl/quickjs-wasmfile-release-sync/package.json')
const src = join(dirname(pkgJson), 'dist', 'emscripten-module.wasm')
const dest = join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'quickjs.wasm')

copyFileSync(src, dest)
console.log(`copied quickjs wasm → ${dest}`)

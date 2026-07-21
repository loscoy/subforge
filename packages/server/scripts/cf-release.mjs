// 一键发布到 Cloudflare：临时把 database_id 写入 wrangler.jsonc → 构建 → 部署 → 还原。
// 账号/库 id 从环境变量或 gitignored 的 .cf-release.json 读取，绝不提交进仓库。
//
// 用法：
//   npm run cf:release
// 前置：设 CLOUDFLARE_ACCOUNT_ID + D1_DATABASE_ID 环境变量，
//   或在 packages/server/.cf-release.json 写 { "account_id": "...", "database_id": "..." }
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(serverDir, '..', '..')
const wranglerPath = join(serverDir, 'wrangler.jsonc')
const cfgPath = join(serverDir, '.cf-release.json')

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID
let dbId = process.env.D1_DATABASE_ID
if ((!accountId || !dbId) && existsSync(cfgPath)) {
  const c = JSON.parse(readFileSync(cfgPath, 'utf8'))
  accountId ||= c.account_id
  dbId ||= c.database_id
}
if (!accountId || !dbId) {
  console.error('✘ 缺少 account_id / database_id。')
  console.error('  方式一：设环境变量 CLOUDFLARE_ACCOUNT_ID 与 D1_DATABASE_ID')
  console.error('  方式二：创建 packages/server/.cf-release.json → { "account_id": "...", "database_id": "..." }')
  process.exit(1)
}

const original = readFileSync(wranglerPath, 'utf8')
copyFileSync(wranglerPath, wranglerPath + '.bak')
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CI: '1' }
try {
  if (!original.includes('REPLACE_WITH_YOUR_D1_ID')) {
    console.warn('⚠ wrangler.jsonc 里没有占位符 REPLACE_WITH_YOUR_D1_ID，按原样部署')
  }
  writeFileSync(wranglerPath, original.replace('REPLACE_WITH_YOUR_D1_ID', dbId))

  console.log('▶ 构建 core + web …')
  execSync('npm run build', { cwd: repoRoot, stdio: 'inherit' })
  console.log('▶ 拷贝 QuickJS wasm …')
  execSync('node scripts/copy-quickjs-wasm.mjs', { cwd: serverDir, stdio: 'inherit', env })
  console.log('▶ 应用 D1 远程迁移（仅未应用的会执行）…')
  execSync('npx wrangler d1 migrations apply subforge --remote', { cwd: serverDir, stdio: 'inherit', env })
  console.log('▶ 部署到 Cloudflare …')
  execSync('npx wrangler deploy', { cwd: serverDir, stdio: 'inherit', env })
  console.log('✅ 部署完成')
} finally {
  writeFileSync(wranglerPath, original) // 无论成败都还原占位符
  rmSync(wranglerPath + '.bak', { force: true })
  console.log('（wrangler.jsonc 已还原为占位符，未提交任何真实 id）')
}

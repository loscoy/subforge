# InstaBox CI 试验

独立工作流 `.github/workflows/instabox-ci.yml` 只允许手动触发，只运行 Node 22 的依赖安装、类型检查和测试，不部署、不引用仓库部署密钥。现有 `deploy.yml` 保持不变。

## 启用前

- `workflow_dispatch` 工作流需要先存在于默认分支。不要为了试运行直接推送到 main；本仓库合并工作流文件也会触发现有发布流程，合并时需确认这一影响。
- 使用独立 InstaBox 机器，不注入 Vault、Org Secrets 或生产凭据。
- 注册仓库级临时 runner，标签为 `subforge-instabox-trial`，使用 `--ephemeral`，执行一次任务后自动注销。下次任务需要重新注册。
- 免费机器会在闲置 30 分钟后暂停，GitHub 排队不会自动唤醒它。先从 InstaBox 唤醒机器、启动 runner，确认 GitHub 显示 online，再手动触发工作流。
- 试验机器 API 返回 `maxRunMinutes: 480`，实际到期行为尚未验证，不应当作无限运行的常驻机器。
- 不要添加 `pull_request_target` 或开放不可信 PR 到此 runner；机器具有持久磁盘，临时 runner 注销不等于清理磁盘。

## 首轮环境验证（2026-10-27）

通过 InstaBox exec API 在免费机器上检出 main 的 `2d5a64497d894c5eacab900fa9ff2b5b7e4fec69`：

- Node `v22.23.3`，npm `10.9.9`。
- `npm ci` 成功，约 9 秒；npm audit 报告 27 项漏洞，未在本试验中修复或确认可利用性。
- `npm run typecheck` 成功。
- `npm test`：39 个测试文件、392 个测试全部通过，Vitest 耗时 3.56 秒。

这是云机器执行能力验证，不是 GitHub Actions 完整调度验收。手动工作流尚未合并，暂停后恢复及自动闲置判定尚未验收。

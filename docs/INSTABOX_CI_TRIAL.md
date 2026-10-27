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

## 暂停调度试验（不合并 main）

- 临时为 `ci/instabox-trial` 分支启用 push 触发，提交 `ad76bec9f38b84a5eb8d5feccb8f31ea388c80ca` 产生 [Actions run 40460667979](https://github.com/loscoy/subforge/actions/runs/40460667979)，随后移除 push 触发。
- 06:22:01 UTC 创建任务；查询时任务处于 queued、无 runner，机器仍 suspended，revision 仍为 2，没有恢复操作。
- 06:22:30 UTC 显式调用 InstaBox resume API；06:22:33 UTC 恢复成功，`processesPreserved: true`。未重新启动或注册 runner，原 Runner.Listener 进程仍存在。
- 此次排队观察窗口约 29 秒；只能证明本次窗口内没有自动唤醒，不能据此判断任何可能的长延迟行为。现有配置没有 GitHub 到 InstaBox 的唤醒集成。
- main 未修改，Cloudflare 发布未触发；本 PR 仅用于试验，不需要合并。
- 机器恢复后约 1 分半任务仍排队，原 runner 日志出现 `Connection reset by peer`，不能认为保留进程就等于连接健康。
- 显式终止并重新启动 Runner.Listener（未重新注册）后，06:24:12 UTC 上线，06:24:13 UTC 接到同一个排队任务，06:24:34 UTC 成功完成。类型检查通过，39 个文件、392 个测试通过。
- 临时 runner 完成后自动注销，GitHub runner 数量恢复为 0；机器再次暂停保留环境。
- 实际可用方案需要外部唤醒，并检查 runner 是否在线；恢复连接异常时重启 runner。本次没有等待其全部内置重试结束，因此不能断言所有暂停恢复都必须重启。

---
name: dayweave-push
description: 在用户说“推送代码”“提交并推送”或“调用推送代码流程”时使用。检查 Dayweave 改动、运行相关验证、安全提交并推送当前分支；不自动打包、不强推。
---

# Dayweave 代码推送流程

## 目标与授权

用户明确请求推送后，完成检查、验证、提交、推送和远端核对，不只提供命令。以当前分支及其 upstream 为默认目标；本仓库常用目标为 `origin/main`，但不得把其他分支自动切到 main。先简述目标和范围，只有目标、范围或远端变化确实需要决策时才询问，不逐条请求命令授权。

## 1. 检查仓库和提交范围

在仓库根目录使用 PowerShell 7：

```powershell
git status --short --branch
git branch --show-current
git remote -v
git log -5 --oneline
git diff --stat
git diff --cached --stat
git ls-files --others --exclude-standard
```

- 阅读 `AGENTS.md` 和拟提交目录中的适用规则，检查工作区及已暂存改动，保留用户已有修改和暂存内容。
- 默认提交本次待推送的应用代码、运行资源、测试、项目文档及 `.agents` 仓库流程；先检查差异和新增文件，不盲目执行 `git add .`。
- 未被明确指定时，排除 `design-previews/`、`design-references/`、`.agent/`、`.pi/` 本地辅助内容。这些目录中的已有改动保留原样，不删除、不自动更改忽略规则；用户明确要求提交时再检查并纳入。
- 不提交凭据、私钥、本地数据库、日志、缓存、`node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/`、`artifacts/`。检查新增文件大小，避免意外提交大体积产物。
- 若已有暂存内容超出本次范围，先询问如何处理，不擅自取消暂存或一并提交。
- detached HEAD、无远端或无 upstream、目标不明确时询问用户；无 upstream 但已明确远端及同名目标分支时可使用 `git push -u <remote> <branch>`。

## 2. 检查远端状态

对实际目标执行 fetch；以下以 `origin/main` 为例：

```powershell
git fetch origin
git rev-list --left-right --count HEAD...origin/main
```

检查每条命令的退出码。远端领先或分叉时先报告，不自动 pull、rebase、merge 或覆盖远端历史；由用户决定同步方式。没有本地新提交和待提交改动时，核对远端后说明无需推送。

## 3. 运行与提交内容相符的验证

仅文档、规则或技能说明变更时，检查格式、路径及命令即可；应用改动按范围运行测试。对于前后端混合改动，执行：

```powershell
$tests = @(Get-ChildItem -Path .\src -Filter *.test.mjs -File | Sort-Object Name | ForEach-Object { $_.FullName })
if ($tests.Count -eq 0) { throw '未找到前端测试。' }
& node --experimental-strip-types --test @tests
if ($LASTEXITCODE -ne 0) { throw '前端测试失败。' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
& cargo test --manifest-path .\src-tauri\Cargo.toml
if ($LASTEXITCODE -ne 0) { throw 'Rust 测试失败。' }
```

- 每项检查必须完成并以实际退出码判断成功；长输出可存入会话 scratch，只汇报摘要和失败原因。
- 若 `npm.cmd` 的宿主等待异常，可使用仓库已有的 `Invoke-DayweaveNpm` 辅助函数，但仍以实际退出码判断，不运行打包入口。
- 检查失败时定位原因，不隐藏失败、不绕过 hooks 或测试，也不为了推送随意重写现有业务；超出本次范围的问题报告给用户。
- 按验证过的范围暂存，不自动纳入测试期间新增的无关文件。暂存后执行 `git diff --cached --check`，核对 staged 文件清单和差异，检查敏感信息。

## 4. 提交与推送

- 使用能概括实际 staged 改动的提交信息，不宣称未验证的效果。
- 有 staged 改动时执行 `git commit -m "<准确的提交摘要>"`；工作区无改动但本地已有待推送提交时无需空提交。
- 使用普通 `git push <remote> HEAD:refs/heads/<branch>`，或明确目标后的 `git push -u <remote> <branch>`。
- 禁止自动 force push、`reset --hard`、`clean`、amend、删除远端分支或修改 Git 认证配置。
- 推送拒绝、认证或网络失败时保留本地提交，报告确切原因。可对明确的临时网络失败有限重试，不无限重试，不改用其他未授权远端。

## 5. 核对与交付

```powershell
git rev-parse HEAD
git ls-remote --exit-code <remote> refs/heads/<branch>
git status --short --branch
```

只有 push 成功、远端目标分支哈希与本地 HEAD 相同，才称“推送成功”。交付时说明：远端/分支、提交短哈希及摘要、实际验证结果、留在本地的排除内容和真实阻塞。说明以后可直接说“推送代码”或“调用 dayweave-push”。

本流程不包含打包；仅整理提交或新增流程不触发打包询问。若本轮另有实际应用修改，遵循 `AGENTS.md` 的打包决策规则，用户明确同意后才调用 `dayweave-package`。

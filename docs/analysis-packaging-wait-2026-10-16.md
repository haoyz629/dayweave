# Windows 打包构建等待异常分析（2026-10-16）

## 结论

已复现当前打包封装在实际构建成功后仍不返回的问题。主要嫌疑已由 Rust 编译、NSIS 压缩转为 `Invoke-DayweaveNpm` 中的 `Start-Process -NoNewWindow -Wait -PassThru` 等待路径。

在同一机器、相同项目及 Debug 配置上，仅在临时副本中将此等待方式替换为 `System.Diagnostics.Process` 的 `Start()`、`WaitForExit()` 和 `ExitCode`，构建能够正常返回。没有修改正式打包脚本、编译参数或库类型，也没有生成安装包。

用户此前记录的 931.76 秒没有逐行原始日志，不能精确还原其中每一秒；本次复现说明该数字不能直接解释为 Rust 实际编译耗时。

## 对照实验

| 实验 | 实测结果 |
| --- | --- |
| 独立前端构建 | 约 5.66 秒，日志显示 Vite 构建完成 |
| 离线、锁定、无依赖 Cargo 元数据查询 | 约 0.16 秒，无错误输出 |
| 直接执行 Tauri Debug 构建并采集 Cargo timings | 24.359 秒，退出码 0；Cargo 报告 15.10 秒 |
| 通过正式 npm 封装执行构建 | 25.949 秒已出现 `Built application`，但封装未返回；180 秒触发诊断超时 |
| 临时副本改为直接等待命令进程 | 29.373 秒返回，退出码 0；Cargo 报告 17.21 秒 |

前两个独立探针使用 `Start-Process` 获取的退出码为空，因此只将其作为耗时和输出线索，不将空退出码当作成功证据。后续诊断记录器使用 .NET Process，明确取得并核对了退出码。

第一次 Tauri 诊断原本尝试传入 `--lib --timings` 以限制为库构建，但实际 Cargo 报告和文件更新时间表明主程序也参与构建。因此不能将此实验描述为仅构建库。该报告中，应用库耗时约 7.69 秒，主程序目标耗时约 4.23 秒；其余为 Cargo 准备等时间。

## 原封装挂起时的证据

- 构建日志先后报告 `Finished dev profile ... in 16.13s` 和 `Built application`。
- 约第 27 秒至第 177 秒，进程采样中没有构建用的 Cargo、rustc、链接器、Tauri 或 Node 进程，封装依然没有返回。
- 诊断在 180 秒只终止了自己启动的进程树，没有使用按进程名批量结束的操作。
- 另一次直接调用及替代等待方案均能在构建成功后立即返回。

`Start-Process -Wait` 在 Windows 上具有等待进程树的语义，而 .NET `Process.WaitForExit()` 等待指定进程。证据足以定位到当前环境中的封装等待路径，但不足以精确指定 Windows 内部哪个 Job、句柄或后代关系导致异常；不把未经验证的安全软件扫描或磁盘故障作为根因。

## 建议的修复边界

只调整 npm 封装的进程启动和等待方式：

1. 保持显式执行 `npm.cmd`，避免 Windows PowerShell 将 npm.ps1 的普通 stderr 误判为终止错误。
2. 保持参数转义与不安全参数拒绝逻辑。
3. 使用 `System.Diagnostics.ProcessStartInfo`（`UseShellExecute = false`）启动 cmd，继承 stdout/stderr。
4. 使用对应 Process 的 `WaitForExit()`、`ExitCode`，并在 finally 中释放进程对象。
5. 保持构建和 NSIS 打包分别计时，以及新鲜度、大小和 SHA-256 检查。
6. 正式落地时更新模拟测试：旧测试把使用 `Start-Process -Wait` 当成要求，需要改为验证真实等待语义和退出码。

临时方案已通过真实命令的正常/非零退出码、普通 stderr、空格/中文/元字符参数及不安全参数拒绝检查。正式项目脚本尚未修改；本轮是诊断，不是修复交付。

不建议在此之前删除 `staticlib`、减少调试信息、清缓存或改依赖。此次相同配置下实际 Rust 构建只需十几秒，这些调整不能解释或解决已复现的封装挂起。

## 分析产物

带时间戳的日志、进程采样、临时方案和对照驱动保存在本会话 scratch 目录：

- `tauri-library-build.timeline.log`（名称沿用原诊断意图，实际包含主程序构建）
- `actual-wrapper-build.timeline.log`
- `actual-wrapper-build.processes.jsonl`
- `direct-wait-build.timeline.log`
- `direct-wait-build.result.json`
- `invoke-dayweave-npm-direct-wait.ps1`
- `direct-wait-native.test.ps1`

Cargo 原始耗时报告保存在 `src-tauri/target/cargo-timings/`。scratch 文件会随会话清理，长期结论以本报告为准。

## 后续修复及完整打包验证（同日）

用户批准修复并测试打包后，正式 npm 封装已改为 .NET Process 启动及 `WaitForExit()` 等待，并在 finally 中释放进程对象。参数安全检查、原生 stdout/stderr 和真实退出码处理均保留，编译配置未变。

- 6 个打包模拟回归场景通过，覆盖 Debug/Release、构建失败、打包失败、产物缺失及过期产物；同时检查等待和资源释放。
- 真实子进程测试通过，覆盖退出码 0/23、普通 stderr、中文/空格/元字符参数、不安全参数拒绝，以及命令退出后不等待独立后代进程。
- PowerShell 语法与空白检查通过。
- 按技能中的正式命令执行 Debug 打包，成功输出本次 `DAYWEAVE_PACKAGE_RESULT`。
- 构建 25.71 秒，NSIS 打包 6.75 秒，校验 0.10 秒，总计 32.61 秒；此前用户记录为约 939 秒。该对比是本机这两次运行结果，不是所有后续构建的耗时保证。
- 安装包：`src-tauri/target/debug/bundle/nsis/今序 · Dayweave_0.1.0_x64-setup.exe`。
- 大小：8,609,034 字节（8.21 MiB）。
- SHA-256：`B886874FB993852E833AA40DD2364E45283867872C89559DE7B643EA070500A2`。
- 独立复核本次安装包的新鲜度、字节大小及 SHA-256，一致；没有执行安装或安装后的界面验收。

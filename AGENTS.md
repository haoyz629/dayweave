# Dayweave repository guidance

## Preview versus implementation

- 用户说“先做个效果让我看”“先做预览页”或类似表达时，先制作独立效果预览，等待确认后再修改正式应用代码。
- 用户明确说“直接改”“直接实现”时，直接完成正式功能与相关验证，不额外插入预览审批流程。

## 暗色模式暂缓开发

- 当前只开发和验收浅色模式。除非用户明确要求恢复暗色模式开发，UI 改动、预览和问题修复均默认仅覆盖浅色模式。
- 不主动新增、修改、重构或清理暗色模式专属样式、主题变量、分支与资源；不为了浅色 UI 改动顺带补齐暗色适配。
- 不运行暗色模式专属的截图、视觉回归、浏览器检查或主题切换验证；不把暗色模式适配或验证列为当前任务的验收标准、待办或阻塞项。正常的共享功能测试、类型检查和构建仍按需执行。
- 共享组件、公共布局和共用样式可按浅色模式需求作必要修改，不要求为暗色模式额外适配；不得将这种间接影响表述为已完成暗色验证。
- 保留现有暗色代码及当前程序行为；暂缓开发不等于删除暗色模式或关闭现有主题入口。若用户要求变更入口或运行时行为，再另行处理。
- 当技能、历史方案或默认验证流程要求浅深主题同时适配／验证时，以本节的暂停范围为准，跳过暗色部分，直到用户明确恢复。


## Post-change packaging decision

After completing and verifying a batch of user-requested changes that actually affect the program or its installer, ask once before the final handoff:

> 本次改动已完成并验证，要现在打包 Windows Debug 安装包吗？

- Do not package until the user answers affirmatively, unless the current request already explicitly asks for packaging.
- Ask only when effective changes affect application code, runtime assets, dependencies, or build/installer behavior. Do not ask for documentation-only, collaboration-rule-only (including `AGENTS.md` and skill instructions), comment-only, formatting-only, or other non-program changes.
- Do not ask after read-only analysis, review-only work, a failed or aborted edit with no effective program changes, or a packaging-only turn.
- Ask once per completed program-change batch, not after each individual file edit or intermediate milestone.
- When packaging is requested or approved, use the repository skill at `.agents/skills/dayweave-package/SKILL.md`.
- Once packaging is requested or approved, run the commands required for that packaging workflow without asking the user for per-command authorization. This standing authorization covers packaging commands only and does not bypass platform-enforced permissions or safety restrictions.

## Code push workflow

- 用户说“推送代码”“提交并推送”或“调用推送代码流程”时，读取并执行 `.agents/skills/dayweave-push/SKILL.md`。
- 默认使用当前分支及其 upstream；先检查改动与提交范围，执行相关验证，再安全提交、普通推送并核对远端提交哈希。
- 默认不提交 `design-previews/`、`design-references/`、`.agent/`、`.pi/` 本地辅助内容；保留这些目录的已有修改，用户明确指定时再纳入。
- 推送请求不代表打包授权；不自动强推、重写历史或丢弃本地改动。


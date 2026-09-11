# JinXu repository guidance

## Post-change packaging decision

After completing and verifying a batch of user-requested file changes, ask once before the final handoff:

> 本次改动已完成并验证，要现在打包 Windows Debug 安装包吗？

- Do not package until the user answers affirmatively, unless the current request already explicitly asks for packaging.
- Do not ask after read-only analysis, review-only work, a failed or aborted edit with no effective file changes, or a packaging-only turn.
- Ask once per completed change batch, not after each individual file edit or intermediate milestone.
- When packaging is requested or approved, use the repository skill at `.agents/skills/jinxu-package/SKILL.md`.


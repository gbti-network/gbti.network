---
id: intro-ci-health-check-skill-for-claude-code
targetType: prompt
targetSlug: ci-health-check-skill-for-claude-code
createdAt: '2026-07-09T13:33:47.676Z'
status: published
visibility: public
authorNote: true
type: comment
author: atwellpub
---

I kept watching my agent re-derive the same GitHub CLI incantations every time a workflow went red, and re-learning the same traps: failure logs that only come back through the jobs API, scheduled failures blamed on innocent commits, secrets that were never created failing as vague downstream errors. So I folded the whole routine into a Claude Code skill and generalized it. Drop it into any repo with GitHub Actions, fill in the inventory table, and /ci health gives you a triaged board instead of a wall of red. The failure classification (broken-by-commit, provisioning gap, flaky) is the piece that changed how quickly things get fixed around here; I hope it does the same for you.

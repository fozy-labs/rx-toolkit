---
title: "Review: 02-design"
date: 2026-03-29
status: Approved
stage: 02-design
---

## Source

Reviewer agent output (Phase 8 general review + Phase 9 correction log review + Phase 11 re-review after Redraft Round 1) and gate sanity check.

## Issues Summary

- Critical: 0
- High: 0
- Medium: 2
- Low: 0

## Issues

1. **`02-dataflow.md` — Multiple Mermaid flowcharts use unescaped `$` in node/link labels**
   - What's wrong: Mermaid flowcharts interpret `$` as KaTeX inline math delimiter. Labels like `CacheEntry.state$`, `machine$()`, `_deriveState$`, `agent.state$`, `previous$?.()` trigger math mode parsing, causing "unexpected PS token" or similar errors.
   - Where: `02-dataflow.md`, flowchart diagrams in §1, §2, §3, §5 and potentially others.
   - What's expected: Escape `$` as `#36;` (Mermaid HTML entity) or restructure labels to avoid `$`.
   - Severity: Medium
   - Source: Reviewer (Phase 11 re-review)
   - Checklist item: #3 (Mermaid conformance)

2. **`02-dataflow.md` — State diagram "Machine States with lastError Extension" uses `<br/>` and emoji in stateDiagram-v2**
   - What's wrong: `<br/>` HTML breaks are not reliably supported in stateDiagram-v2 transition labels. `✨` emoji may be rejected by some Mermaid lexers.
   - Where: `02-dataflow.md`, §3B state diagram, transitions from `MachinePending`, `MachineRefreshing`.
   - What's expected: Replace `<br/>` with `\n` or split into separate transitions. Remove or replace emoji with text.
   - Severity: Medium
   - Source: Reviewer (Phase 11 re-review)
   - Checklist item: #3 (Mermaid conformance)

## Recommendations

- Both issues are Mermaid rendering portability concerns. The diagrams are semantically correct and render in some environments. Fixing these would improve cross-renderer compatibility.
- The original Redraft Round 1 successfully fixed the text contradiction (issue #1 from prior review) and 3 broken Mermaid diagrams. These 2 new issues were found during re-review of other diagrams in the same file.

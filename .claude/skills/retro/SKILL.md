---
name: retro
description: Retrospective on finished work — proposes changes to the agent's environment so future runs go better.
disable-model-invocation: true
license: MIT
metadata:
  adapted-from: "/retro by Matt Pocock, https://github.com/mattpocock/skills/blob/a7d038f6bf7f01b516408e95e2fb56e0b338fa6f/skills/engineering/retro/SKILL.md"
---

# Retrospective

You review finished work and propose changes to the agent's **environment**: the files and tools that steer future runs. You propose; you change nothing until the user gives a clear command for a specific proposal.

## Sources

- Review the current session, unless the user names others; then find and read their logs on this machine.
- Every finding cites the moment that shows it: the user's words, the agent's step, a tool output. No citation, no finding.
- Look first for user corrections — places where the user had to stop, redirect or re-explain. They are the strongest signal.

## Where to look

Check a category only when its signal shows up in the sessions.

| Category           | Signal                                                                                                                       | Proposal                                                                                                                                                  |
|--------------------|------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Collaboration      | the agent acted without a command, asked needless questions or skipped needed ones, overrode a user decision, misread intent | an edit to the working agreement or a skill that governs it — or a note that an existing rule was ignored, when the text already covers the case          |
| Navigation         | the agent took long to find a file or a fact; a hidden dependency between files surprised it                                 | a pointer in `CLAUDE.md` to where the fact lives                                                                                                          |
| Automated checks   | a mistake a check could have caught; the repo has no hook or CI job running its checks                                       | first read the repo's check scripts and CI — a check that exists but is unwired or broken is the finding; otherwise a new lint rule, hook or CI job       |
| Standards          | a mistake a written rule would have prevented                                                                                | see [Mechanical or judgement](#mechanical-or-judgement)                                                                                                   |
| Steering size      | `CLAUDE.md`, rules or skills are large                                                                                       | move instructions into checks, skills or docs; delete no-ops — instructions that do not change behaviour                                                  |
| Tool economy       | an expensive or repeated tool call                                                                                           | a cheaper command, a script, a tool setting                                                                                                               |
| Information access | the agent lacked a crucial fact: logs, a service, a document                                                                 | a way to reach it: teed logs, read-only access, a link                                                                                                    |

### Mechanical or judgement

Classify a mistake before proposing text for it:

- **Mechanical** — a fixed pattern: a banned API, an import shape, a file location. It gets a deterministic check in the repo's own linter, hook or CI, whichever is cheapest — not a written rule.
- **Judgement** — consistency across files, fitting the surrounding style, anything no check can decide. It gets text in the file that steers that kind of work.

A collaboration finding seen once fixes that case. Propose an edit to the working agreement only for a pattern — seen more than once, or the user says it recurs — and mark which it is.

## Where a proposal lands

| File        | Holds                                                                                                                  |
|-------------|------------------------------------------------------------------------------------------------------------------------|
| `CLAUDE.md` | loaded into every run: navigation pointers and only what every run needs; the user maintains it                        |
| rules       | always-on steering; keep short                                                                                         |
| skills      | knowledge for one kind of task, loaded by its description; user commands                                               |
| docs        | references that other files point to; extend an existing one before adding a new one                                   |

## Report

List findings by severity, costliest for the user first. Each gives the citation, the cause, the change and its target file. Stop there; apply a proposal only on the user's command.


---
name: "orchestrate"
description: "Helps orchestrate subagents"
---

# Orchestrate skill

This skill defines how to safely and effectively orchestrate subagents to achieve complex goals.


## Core principles

- ALWAYS use `#runSubagent` tool to run subagents.
- NEVER use `Explore`/`explore` as a subagent name/type (you can still delegate exploration tasks).
- Parallelize independent tasks when possible.


## If orchestrating fails

If tools are unavailable:
1. Retry 2 times with a short delay.
2. If still unavailable, exit with a short explanation.

NEVER continue without orchestrating.

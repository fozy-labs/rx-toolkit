---
name: "delegate"
description: "Helps delegate tasks to subagents"
---

# Delegate skill

This skill defines how to safely and effectively delegate tasks to subagents.

## Core principles

1. **Delegate tasks that can be executed independently.**
2. **Provide a clear goal and sufficient context.**
3. **Specify the expected output format when needed.**
4. **Avoid delegating trivial tasks.**

## Delegation structure

When delegating a task, include:

- **Goal** – what must be accomplished
- **Context** – relevant information
- **Scope** – any constraints or limitations
- **Expected output** – what the agent should return you

### Subagent name

NEVER use `explore` as a subagent name (you can still delegate exploration tasks).

## Best practices

- Validate self ideas and plans with subagents
- Verify subagent results before using them in critical steps
- Parallelize independent tasks when possible

## Anti-patterns

Avoid:

- delegating trivial tasks like reading or writing a file
- giving vague instructions
- giving overly detailed instructions

## Delegation strategy

- Role-playing
- Chain-of-Thought
- Cross-validation with critical reflection

## If delegation fails

If tools are unavailable:
1. Retry 2 times after a short delay.
2. If still unavailable, exit with a short explanation.

NEVER continue without delegating.

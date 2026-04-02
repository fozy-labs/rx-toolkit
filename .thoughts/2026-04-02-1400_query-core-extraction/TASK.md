# Query Core Extraction Research

## Objective
Research how to extract the core logic from Resource in the rx-toolkit query module so it can be reused by Commands. Compare the approach with other open-source solutions (React Query, SWR, RTK Query, Apollo, etc.).

## Scope
- Analyze Resource internals: lifecycle, caching, state management, subscriptions
- Identify what parts of Resource core are generic vs Resource-specific
- Research how other libraries separate their "operation core" from specific operation types
- Propose extraction strategy with tradeoffs
- Do NOT focus on Command implementation details

## Deliverables
- Research report in `.thoughts/2026-04-02-1400_query-core-extraction/report/`
- Comparison matrix with OSS solutions
- Architecture diagrams (mermaid)
- Extraction strategy with tradeoffs

## Approach
Micro-task iterations with subagent delegation.

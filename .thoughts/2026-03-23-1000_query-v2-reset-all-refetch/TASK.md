---
title: "QueryV2: api.resetAll() does not trigger re-fetch for active agents"
date: 2026-03-23
---

## Problem

After a reset via `api.resetAll()`, agents do not make a repeated request.

## Expected Behavior

After a reset via `api.resetAll()`, agents that are still active should re-fetch their data.

## Additional Requirements

1. Expand test cases to cover various scenarios with `api.resetAll()`, including React integration tests.
2. Add an interactive demo example with an authentication use-case (single API, logout using `api.resetAll()`).

# Common Mistakes

Accumulate user feedback and corrections here. Each entry should be checked before writing new docs.

---

## 1. README.md ≠ Architecture doc
**User feedback**: The main `README.md` of a module should NOT be an architecture overview. It should be a landing page / introduction. Architecture should be in a separate dedicated file.
**Impact**: Restructure `docs/query/README.md` to be a landing page; move architecture to `concepts/architecture.md` or similar.
**Rule**: Always think about the PURPOSE of the file before deciding its content. README = introduction/landing, not deep technical docs.

## 2. Markdown link style conventions
**User feedback**: All links must be declared via reference-style `[ref]: url` at the END of the document. In the body, use `[text][ref]` or `[ref]`. Never inline `[text](url)`.
**Root cause**: Agents defaulted to inline links which is common in general markdown but not the project convention.
**Rule**: ALWAYS use reference-style links. Declare all link targets at document end. Body uses `[text][ref]` or `[ref]` only.

## 3. Avoid excessive duplication across docs
**User feedback**: Don't repeat the same information in multiple docs. If README has a description, architecture.md should NOT copy it. Use cross-references instead.
**Root cause**: Agents wrote each doc independently without checking what was already written elsewhere.
**Rule**: Before writing any section, check if it exists in another doc. If so, link to it. Only duplicate when truly necessary (use "smart" judgment). When in doubt — don't duplicate.

## 4. Don't do both description AND diagram for same content
**User feedback**: When text description and diagram convey the same information, choose diagram ONLY. Having both is redundant duplication.
**Root cause**: Agents wrote explanatory prose and then added a Mermaid diagram showing the same thing.
**Rule**: For architecture/flow/structure: prefer diagram over prose. Use text only to add information NOT visible in the diagram. Never describe what a diagram already shows.

## 5. One correction = one team (multiple agents), NOT one agent for multiple corrections
**User feedback**: Using a single agent to handle 10 correction points produces poor results because a single agent can't deeply analyze each point. Each individual correction needs a DEDICATED team (subagent or multiple subagents) to: (1) analyze what's wrong, (2) understand the fix, (3) apply it correctly and consistently.
**Root cause**: Orchestrator batched all corrections into one prompt trying to be efficient, but this sacrificed quality.
**Rule**: For corrections/fixes — dispatch one agent PER correction point. Each agent should analyze AND fix. Multiple agents can run in parallel for independent corrections. Never batch multiple semantic corrections into one agent call.

## 6. Don't make super-diagrams — split into focused diagrams
**User feedback**: A sequence diagram that tries to show ALL scenarios (happy path + error + SKIP + refresh) in one diagram is a "super-diagram." Complex scenarios (e.g., invalidation/refresh) should be separate diagrams, each focused on one flow.
**Root cause**: Agent tried to pack all 4 scenarios into one diagram for completeness.
**Rule**: Each Mermaid diagram should cover ONE scenario or ONE logical flow. Split complex diagrams into multiple focused ones. Each diagram should be self-contained and readable without scrolling.

## 7. Mistake #5 repeated: still using 1 agent instead of TEAM per correction
**User feedback**: The orchestrator AGAIN sent one agent per correction instead of a TEAM of agents (researcher + analyzer + fixer) per correction. This is a CRITICAL process failure — the orchestrator reads the rule but doesn't execute it.
**Root cause**: The orchestrator interprets "one agent PER correction" as "one separate agent call per correction" instead of "multiple agents collaborating on one correction." The distinction is: one agent lacks the depth to analyze root cause AND fix properly. A team means: (1) agent researches what's actually happening, (2) agent analyzes the root cause, (3) agent applies the fix.
**Rule (REINFORCED)**: Each correction needs a PIPELINE of agents: Research → Analyze → Fix. Minimum 2 agents per correction point. The research agent gathers facts, the fix agent uses those facts. NEVER send one agent to both analyze and fix.

## 8. Writing team needs EDITORS — not just fixers
**User feedback**: A "team" for content correction should include EDITORS who review after the fix. If one agent makes a mistake, two others should catch it. Pattern: Researcher → Fixer → Editor. The editor validates the fix BEFORE it goes to user.
**Root cause**: The orchestrator dispatched research+fix but no verification step. Errors slipped through because nobody reviewed the output.
**Rule**: Every content fix pipeline must be: Research → Fix → Edit/Verify. The editor agent reads the final output and checks for remaining issues. This is the "safety net."

## 9. "typeof SKIP" phrasing
**User feedback**: "Символ (typeof SKIP):" — nobody writes like this. It's awkward phrasing.
**Root cause**: Agent tried to explain both the value and type in parentheses, but the result reads unnaturally.
**Rule**: When documenting SKIP, write naturally. E.g., "специальный символ SKIP" or "значение SKIP". Don't force TypeScript syntax into prose.

## 10. Architecture doc should contain ONLY architecture — not usage flows
**User feedback**: "Поток данных ресурса" (sequence diagrams showing useResource flow) doesn't belong in architecture. Architecture = components and their relationships, NOT how a specific feature works step-by-step.
**Root cause**: Agent mixed architecture concepts (component diagram, glossary) with usage-level flows (how useResource triggers queries).
**Rule**: Architecture doc = structure, layers, components, dependencies. Usage flows belong in usage/ or concepts/ docs for the specific feature.

## 11. CRITICAL: Docs are MORE authoritative than code — NEVER downgrade docs based on code
**User feedback**: User ROLLED BACK machine.md because agents rewrote it based on code analysis, which was a DOWNGRADE. The existing docs describe the TARGET DESIGN, which is AHEAD of the current code. Agents treated code as truth and removed features that exist in the docs but not yet in code (e.g., `refresh-error` as a proper state with its own fields).
**Root cause**: Despite user decision Q1 (docs = target spec), the research→plan→write pipeline used codebase research as the primary source and "corrected" the doc to match code. This is exactly backwards.
**Rule**: EXISTING docs are the BASELINE. Only ADD to them or make user-requested modifications. NEVER remove content from docs because it doesn't exist in code. When research shows code differs from docs, THE DOCS ARE RIGHT. The code will be rewritten to match docs.
**ALSO applies to ADDING**: Don't add options/features from code that aren't in docs. If code has `strategy`, `compareArg`, `doCacheArgs` but docs don't mention them — those options MAY NOT EXIST in the target design. Only add what the USER requests.

## 12. Shared infrastructure must cover ALL consumers — not just one
**User feedback**: `cache.md` was written entirely from the Resource perspective, ignoring that Commands share the same cache system (CacheMap, CacheEntry, Machine).
**Root cause**: Research/writing focused on the more common consumer (Resource) and didn't consider that the cache is a SHARED layer.
**Rule**: When documenting shared infrastructure (cache, machine, patching, etc.), always describe ALL types that use it. Mention differences in defaults/key derivation between Resource and Command explicitly. Don't assume one consumer.

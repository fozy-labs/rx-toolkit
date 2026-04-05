# User Decisions (Q&A Round 1)

1. **Docs = target spec** — docs define the design, code will be rewritten to match
2. **Language: Russian** for docs
3. **Design changes**: What's already in docs IS the target. Big internal refactor planned: resource and command should share more common code. Commands already removed from src.
4. **Doc structure**: Shared concepts, separate usage pages (current structure is correct)
5. **Depth**: Public API + concepts + internal API (full depth)
6. **Broadcast/sync**: Include in docs
7. **Structure**: Current dirs + new pages, extend existing when needed
8. **SKIP naming**: `SKIP` + `typeof SKIP` (not SKIP_TOKEN)

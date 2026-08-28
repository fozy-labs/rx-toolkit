---
name: markdown-craft
description: Rules for authoring and maintaining Markdown documents
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.1.0
astp-hash: f6972fde16ad93e107f56f5f79a48fe43a5cc624d964092ea96f63f1ae3a9f7b
---

# Markdown craft

Applies to every md file you write, edit, restructure, or review.

## 1. One home per fact

Every fact lives in exactly one place; everything else references it.

| Fact                                                                                  | Home                                                                 |
|---------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| who/whom/when/order, branching, concurrency, flows, lifecycle, state machines and etc | diagrams                                                             |
| invariants and trade-offs the reader acts on                                          | prose                                                                |
| numbers: limits, TTLs, quotas, thresholds                                             | tables                                                               |
| failure dispositions                                                                  | failure tables                                                       |
| exact formats / data schemas                                                          | code blocks or diagrams                                              |
| derivation: why not otherwise, refuted alternatives, boths costs; discutions          | Not icluded or outside (link to issue, PR, external document or etc) |

- **A restatement is a copy, and copies drift.** Link to the home instead of retelling it. 
  If a copy must exist (e.g. a summary for outside readers), mark it as a copy and name its home.
- **Complement test.** A sentence deletable because a diagram or table already carries
  the fact — delete it. Referencing an element (step number, arrow name, table row) is
  encouraged — it anchors rationale to structure; re-describing the element is the
  violation, not naming it.
- **Avoid overuse the link**. So you can rephrase to get away from them,
  but this can still create problems in large documents.
  In general, for large documents, it is recommended to consider breaking them
  into smaller ones when they begin to actively quote their parts.

## 2. One reader per document

A document has one reader. Every sentence exists because someone asked a question, and
the question decides which document answers it:

| Question            | Asked by                           | Home                                                |
|---------------------|------------------------------------|-----------------------------------------------------|
| What do I do?       | whoever implements it              | this document                                       |
| Is this still true? | whoever re-checks it on an upgrade | this document, one line                             |
| Why not otherwise?  | whoever reopens the decision       | outside, linked                                     |
| Are you sure?       | whoever challenged you last round  | nowhere — a fact about the process, not the subject |

**Documents bloat problem**. A review round invents a reader the document does
not have, and the answer to that reader lands in the document — true, not a copy, not a
restatement, so every rule in One home per fact passes it. Repeat over several rounds and
a two-line rule carries fifty lines of defence.

**Counterfactual test.** Would you have written this sentence if nobody had challenged
you? If no, it is addressed to the challenger, and its home is wherever the challenge was
raised.

This does not ban rationale. What the reader must act on stays, at full length: a caveat
that changes what someone does — "flip this flag and you inherit that obligation" — is a
decision, not derivation, and never compresses to a marker.

## 3. Structure

- Reference documents longer than ~100 lines start with a contents list — partial
  reads must still reveal the full scope.
- Cross-references go by **name** — an ordinary Markdown link to the target's
  `#anchor` — never by position or number: numbering breaks on insertion, links
  don't. Exception: contexts where a link cannot render (e.g. the `⚠§N` marker
  inside diagram text), backed by an explicitly frozen numbering.
- Brevity is IMPORTANT: assume a competent reader, cut scaffolding prose.

## 4. Links and anchors

- Every link target must exist at write time — the file AND the `#anchor`. Anchors
  derive from heading text, so a heading rename is an API break: 
  found inbound links and fix referrers.
- "see above/below" — must be links.

## 5. Maintenance

Editing scope is the fact, not the dry diff:

- A changed, moved, or deleted fact invalidates every restatement of it — sweep the
  document set for copies and reconcile (per One home per fact, the out-of-home copy
  is the suspect; substantive divergence can go to the user).
- One term per concept, document-wide. Synonym rotation reads as different concepts.
  Be sure to use the glossary if it is defined.
- No self-aging phrasing: "currently", "new", "recently", "will soon" rot silently.
  State the version or date explicitly, or state the timeless fact.

## 6. Diagrams — load the reference

Before writing or editing ANY Mermaid diagram, load [references/mermaid-craft.md](references/mermaid-craft.md).

## 7. Hard specs — load the reference

A **hard spec** — a specification, design doc, or any long technical document under revision —
has failure modes the rules above do not cover. Before writing, compressing, restructuring,
reviewing or acting on a review finding against one, load
[references/hard-spec.md](references/hard-spec.md).

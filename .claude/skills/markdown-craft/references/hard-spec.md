---
astp-source: fozy-labs/astp
astp-bundle: docs
astp-version: 1.1.0
astp-hash: 9a50d7a5c7e06d72e7cd19a6beb2492eb6434785bc70e49f708559ba82ed8bae
---
# Hard spec

What the general rules do not cover: where derivation lives once it leaves the document, what
survives compression, and what each side of a review round owes so that
[One reader per document](../SKILL.md#2-one-reader-per-document) can be applied at all.

## 1. The outside home

The destination table lives in [One reader per document](../SKILL.md#2-one-reader-per-document).
What its "outside, linked" row does not carry:

- **A PR, a review comment, an issue, a separate document — any of them is a good home** for a
  causal chain: why this is a bug and that one is not, why the decision went the way it did.
  Link whichever one actually holds the reasoning; which form that is belongs to the pipeline,
  not to this rule.
- **Link the resolution, not the argument.** A discussion's later turns cancel its earlier
  ones, and a link into a superseded answer is worse than no link — point at the turn that
  settled it, or state the outcome in the same line as the link.
- **Moving material out removes it from the copy sweep** of
  [Maintenance](../SKILL.md#5-maintenance) — a sweep of the document set can report an
  outside copy, never reconcile it. Accepted knowingly, stated here rather than discovered.

## 2. What does not compress

- **An obligation the code violates right now** — the sharp case of the caveat rule in
  [One reader per document](../SKILL.md#2-one-reader-per-document): a marker ("remainder not
  closed") hands the next reader a debt they cannot see.
- **Once written, derivation is moved, not deleted.** "Not included" in
  [One home per fact](../SKILL.md#1-one-home-per-fact) is a choice made while writing; deleting
  it later costs the next reader the same questions and the same chance of getting them wrong.

## 3. Reviewing

- **A finding carries a disposition**: `cut` / `move` / `rewrite` / `add`. Without one it is
  an alarm, and the only edit an alarm admits is an addition.
- **A finding names its reader**, from the table in
  [One reader per document](../SKILL.md#2-one-reader-per-document). A question raised by the
  previous round rather than by a reader is out of scope.
- **`add` names what it displaces.** Otherwise the document is unbounded and every true
  sentence wins its place.
- **A round settles.** What round N closed is not reopened in N+k. Re-opening it makes the
  author write a defensive clause, and that clause is the growth.
- **A round must be able to delete.** A round whose only possible output is "add" is a growth
  mechanism regardless of what it finds.
- **The line delta is the only signal that fires.** Accretion never announces itself: every
  individual edit looks right, so nothing but the size of the round exposes it.

## 4. Acting on findings

- **Rewrite, not append.** Appending is the failure mode: if the finding is valid, the
  sentence it touches is wrong, not missing.
- **"No edit" is a legal answer.** "The answer's home is that thread" closes a finding. Without
  that move the author can only ever write — and the reviewer is often another agent that
  never loaded this file, so the discipline must hold from the author's side alone.
- **Compression is its own pass, and its only legal diff is negative.** A pass that mixes
  fixes with compression nets positive every time.

## 5. Before restructuring: predicate inventory

Rewriting loses claims silently. Number every predicate the document(-s) asserts, rewrite against
that inventory, then check it back: each entry is kept, moved (naming the target), or dropped
(naming why). No entry leaves without one of the three.

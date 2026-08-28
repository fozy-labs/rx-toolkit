---
astp-source: fozy-labs/astp
astp-bundle: design
astp-version: 1.0.0
astp-hash: 7a061c2f857ad973990fa9bafdbb129b0e9bdcf62f71b35fdabcc1be9262494d
---
# Axes

> Loaded when: a Ledger slot needs the axis behind it; a reading is contested; an axis is invoked by name, by you or by someone arguing with you; or the standing of an axis — confirmed, narrowed, or retracted — decides whether a claim may be made at all.

## How to read this file

An axis here is a score you compute on **this segment**, not a label you attach to a product. Each axis entry states: the corrected formulation, the operational test, what the score changes downstream, and its verification verdict. Nothing on this page is an answer; every entry ends in a number, an enum, or a proper noun that a later gate consumes.

Verdicts: **CONFIRMED** — holds as stated, in the author's own terms, across independent occurrences, and it changes edits in live critique. **NARROWED** — the core is real, the reconstruction claimed a wider scope than the corpus supports; the narrowing is printed inline and is binding. **RETRACTED AS AN AXIS** — the two-pole shape was withdrawn by the author himself; the object survives, the axis does not.

Axes are never summed and never averaged. Two axes disagreeing is the normal case; the conflict is resolved by the block's function in the scenario, not by whichever axis you scored first.
RU: оси не складываются и не усредняются; расхождение — норма, спор решает функция блока в сценарии.

---

## Axis 1 — Temporal reading / atemporal reading — CONFIRMED

Two **independent** scores on one work, set in parallel, free to diverge: weak temporal reading with strong atemporal reading is a legitimate result, and so is low on both.
RU: темпораль и атемпораль — две независимые шкалы одного макета, выставляются параллельно и могут расходиться.

Pole A is the **instrumentalisation of time in either direction** — acceleration *and* deliberate dwelling. A screen built to hold someone in place is temporal, not atemporal.
RU: полюс A — инструментализация времени в любую сторону, включая намеренное залипание, а не «скорость».

Four tests, in the corrected form:
1. What is the element defended by — an argument from time, or an argument from affect? The defence names the reading, not the other way round.
2. A claim about time owes a measurement artefact (time on task, step count, usability report, eye-tracker). No artefact, no claim — the model's own name for the alternative is fake method (схематоз).
3. Who already carries the affect — music, covers, the game world, the content itself? If a carrier exists, the atemporal is delegated to it and the interface does not top it up. Read that as a route, not as a verdict of neutrality: the interface may still propagate the carrier's own sign across the layout, and what is barred is manufacturing a competing affect. Procedure in `references/sign.md`, T5.
RU: если носитель аффекта уже есть, атемпораль делегирована ему — интерфейс её не добирает.
4. Inverted probe: do not ask whether slowing down would spoil it; ask whether **acceleration** would break the atemporal.
RU: проверять не «испортится ли от замедления», а не сломает ли ускорение атемпораль.

What it changes: the **sign of an operation**. Proliferating entities is a loss in a temporal interface and a gain in an atemporal game surface — the same act, opposite verdicts. Feeds Ledger slots 1–2 and every sign lookup in `references/operations.md`.

Separate object, do not conflate: the three-position typing (temporal / balance / atemporal) belongs to the matrix that types **a designer and a task**. Reading a work is the two-score operation above. The mismatch between a task's cell and a designer's habitual vector is a diagnosis about the designer, not about the layout. Full treatment in `references/frame.md`.

## Axis 2 — Charge → hierarchy — NARROWED

Not a closed attention budget: **the span of charges along the block ordering**.
RU: не «замкнутый бюджет внимания», а размах зарядов вдоль секвенции.

Working unit: an absolute charge per block, on a 1–10 scale (illustration), plotted against block number — never a share of a hundred. Pole A is sharply unequal neighbours (2–4× between neighbours — illustration; 90/10, 75/20/5, 70/30 — illustrations, not norms). Pole B is equal charges: actualisation probability is the same for each and no traversal order is imposed.

Test: assign the charges, then measure the **distance between the extremes** and the **depth of the accent pits** — not brightness. Collapse adjacent equal points. Reach the required span with the fewest operations. When adding an element, check the hierarchy-against-informativeness fraction before you place it.
RU: смотреть глубину акцентных ям и расстояние между экстремумами; соседние равные точки схлопывать; нужный размах брать минимальным числом действий.

Three limiters, without which this axis degenerates into "more disproportion is better":
- At the point where the scenario offers a choice among equivalents (menu, toolbar), low hierarchy is **correct**; the work there is separation of equals, not accent. High hierarchy belongs inside the chosen block.
- Hierarchy competes with the transmission of sign under the sufficiency principle — see Axis 5.
- The step can be excessive. There is a top.

The budget does not conserve: it is closed **between** cognitive acts and resets after one. Full mechanics, the gradient shapes, and T1 (required span derived from the count of scenario-obligatory blocks and from block function) in `references/charges.md`.

## Axis 3 — Block ordering — RETRACTED AS AN AXIS; the object is CONFIRMED

There is no two-pole axis here. The opposition an earlier reconstruction built on this term was withdrawn by the author, with its poles inverted; it is listed in `references/limits.md` under never-reinstate and must not be rebuilt under any name.

What survives, and is load-bearing: the block ordering (секвенция) is **an arbitrarily taken succession of blocks and simultaneously the actual chain of actualisation**. Its parameter is hierarchy, which sets the transition probability between two points.
RU: секвенция — произвольно взятая последовательность блоков и одновременно фактическая цепочка актуализации; параметр — иерархичность, задающая вероятность перехода.

A scenario is linked block orderings. Contour decides membership: second-contour elements sit on a different ordering, so they are not neighbours in this one.

Test: take **arbitrary** pairs of blocks, including pairs from overlapping sets, and measure hierarchy between them. Low hierarchy between a pair reads as braking, and a pair that recharges across a cognitive act reads as a loop.
RU: брать произвольные пары блоков, включая пересекающиеся множества, и мерить между ними иерархичность; низкая — торможение и петля.

Use it as the substrate the charge column is measured on, never as a score in its own right. In a flow, draw the arrows: the transition probability is a parameter of the ordering, not a substitute for stating where the user goes next.

## Axis 4 — Advance — CONFIRMED

How much further time the viewer or user is prepared to grant this carrier.
RU: аванс — сколько времени зритель готов ещё выделить носителю.

Test: walk the carrier joint by joint over the same block ordering used in Gate 2, and at each seam ask whether the block **adds** credit (impression, value, a relevant result, a removed obstacle) or **burns** it (self-similarity, repetition, a surplus accent, an unexplained fork). Across the walk it must add more than it spends.
RU: на каждом стыке спросить, докидывает блок аванс или сжигает; докидывать надо больше, чем тратить.

Never score it absolutely — calibrate by entry point. Cold traffic: the advance is near zero, and permissible aggression with it. A return visit or a deep link: high advance, and a costly block is affordable.

Off-switch, and it is part of the axis: under absolute temporality — the user has already decided, there will be no drop — the advance question is **switched off**. Say so out loud in the Ledger rather than scoring it low.
RU: при абсолютной темпоральности вопрос аванса выключается.

Four decisions this axis and only this axis settles: how many cards and screens; whether onboarding is warranted; whether an image comes out; whether a control is hidden on a repeat visit. Full treatment in `references/frame.md`.

## Axis 5 — Sign-load — NARROWED

Two components, with the audience inside the definition: **how many interpretants this named audience reads unambiguously**, and **what affective response those interpretants give**.
RU: знаковость — сколько интерпретант целевая аудитория считывает однозначно и какой аффектный отклик они дают; аудитория входит в определение.

Orthogonal to charge — a high-sign object may legitimately sit microscopic in a corner — and orthogonal to detail. Sign-load plus detail is plot-load (сюжетность).

It does not run on more-is-better. It runs as a **distribution across slots under the sufficiency principle**: high sign-load into the plot object, low sign-load deliberately onto the background. Low sign-load is a legitimate strategy, not a defect; it is defective only when it occupies the plot slot in order to fill emptiness. Repair a weak mark either by number — many low-sign units becoming one high-sign field — or by added detail.
RU: малознаковость — легитимная стратегия, дефект только когда малознак занимает сюжетный слот, чтобы заполнить пустоту.

Narrowing that is binding: the opposite of sign-load in the author's argument is not detail but a rival doctrine of content-in-the-absolute. Do not build a detail ladder out of this axis. Full treatment, including T5 and the author's own unresolved contradiction about the remove-the-logo probe, in `references/sign.md`.

## Axis 6 — Topical position: scenario / balance / block — CONFIRMED

The author's own name for it is the topical (horizontal) axis, and it has three positions, not two.
RU: топическая (горизонтальная) ось; три позиции — сценарий / баланс / блок.

**Block position:** the solution is sought inside one block ordering — accents, spacing, hierarchy, the configuration of the block.
**Scenario position:** the solution is sought in the linking of block orderings, through the interaction contours — first contour is read without any action, second adds block orderings, third replaces them.
RU: контуры взаимодействия: первый считывается без действия, во втором секвенции добавляются, в третьем заменяются.

The axis types **both the designer and the task**: the task has a coordinate, the designer applies a vector, and the mismatch is the diagnosis.

Operative question for the Ledger: is the solution in the linking of block orderings, or inside one carrier? The answer decides what the block ordering of the next gate even is.

Evidential note: this axis is absent from the judging rubric the author takes part in, and in live critique it surfaces mainly through its derivatives — contours, block orderings, the scenario that could not be completed. Promoting it to a Ledger slot is slightly stronger than the corpus supports; see `references/limits.md`. Two homonym traps when checking sources: the same adjective names a property inside the spacing progression, and "block system" in ordinary critique means a kind of layout, not a mode of thinking — see `references/glossary.md`.

## Axis 7 — Derivation vs visual practice — NARROWED

Pole A, the model route: axioms, definitions, derivable consequences. A rule is admissible when a consequence follows from it **and** you can say where you would knowingly break it with a gain.
RU: годно то, из чего выводится следствие и видно, где его можно осознанно нарушить с выигрышем.

Pole B, the cognitive-bias route: imprinting, transferring past experience without attaching it to this specificity, argument from authority, heuristics standing in for definitions.
RU: полюс B — путь когнитивных искажений: импринтинг, тиражирование опыта без привязки к специфике, обоснование от авторитета, эвристики вместо определений.

Four tests: (a) does anything derive from it, and can it be broken deliberately for a gain; (b) contrastive variants (контрастные рисовки) — draw the competing options and say why one wins; no answer means imprinting; (c) is this an appeal to a black box; (d) is the definition merely a list of features — check it by substitution.

Binding narrowing: visual practice is **not a vice in itself**. The author praises and adopts a device the moment he can give a model reason for it. The vice is practice unattached to this specificity and non-derivable. "Model" also does not mean "his model" — an opponent with a real model is credited, and the objection is to over-generalisation. Name correction: do not gloss this axis with the reference-hoard term (соберуха); that word names a genre of content, not a property of a layout. Operational detail in `references/argument.md`.

---

## Derived scales, compressed

Each is a reading that falls out of the axes above. None is scored independently of them; each names what it decides and where it is argued in full.

- **Contours 1 / 2 / 3** — distributed by degree of importance of the information (first-, second-, third-order), not by frequency of need. Decides membership in the block ordering, and therefore who is a neighbour. → `references/frame.md`
- **Exclusivity (эксклюзивность)** — whether this element is the only one of its kind in the frame. Precondition of any accent: large among large holds none. **Exclusion (эксклюзия)** is the distinct operation on equals. → `references/charges.md`
- **Exhaustion and the renewal law** — a block spends itself once read; a hard cognitive act recharges the frame. Membership is exact: click, scroll, reading a paragraph, filling a field count; hover and looking do not, and a cliché icon does not count as a logical operation. Motion never exhausts. → `references/charges.md`
- **Sufficiency principle** — the upper and lower bound of detail for a given slot; competes directly with hierarchy, which is why Gate 2 fills both columns in one pass. → `references/sign.md`
- **Density / parasitic density** — density is not the vice; parasitic density is. Four ordered tests: informativeness → exclusivity → spacing progression → the substrate that must then be stylised. Stop at the first that fires. → `references/surface.md`
- **Criticality vs accuracy** — the criterion is the consequence of the fix: if it changes group membership or lets data merge into a foreign group, it is critical and argued through time; if not, it is accuracy, goes on the atemporal account, and must not be dressed as speed. Weight in an assessment is about a fifth, not a half (illustration). → `references/surface.md`
- **Spacing progression** — letter → space → line → paragraph → block, multiplied along the chain (×1.6–1.8; norm, and the author left the tolerance zone for exaggeration undefined). The accent step is a different multiplier: importing either into the other is forbidden. Counted by eye, not by ruler. → `references/surface.md`, `references/limits.md`
- **Separability (отделимость)** — can these two groups still be told apart after the edit; the working criterion for any surface change. → `references/surface.md`
- **What ought to be / what is (должное / сущее)** — semantics names what ought to be, structure computes what is, the verdict exists only as the divergence, and content attaches last as a modifier of charge. → `references/argument.md`
- **Imperativeness amnesty (T6)** — imperativeness amnesties costs paid once during learning and never costs paid on every pass; a long session and human onboarding widen it, a short frequent visit narrows it. → `references/frame.md`
- **Mass solution vs departure (T9)** — set by the element's job: something that must be *found* by a person looking for it takes the mass solution; something that must *intercept* a gaze looking for elsewhere finds the mass device dead regardless of execution. Reconstructed from a mechanism, never stated in one sentence by the author; treat as open. → `references/operations.md`, `references/limits.md`

---

## How the axes combine

The reading is **local**. Re-score per segment, per screen, per contour. One product legitimately carries several readings, and that is where its internal variety comes from — not from a style choice.
RU: чтение локально: переоценивать по сегменту, экрану, контуру; один продукт законно несёт несколько прочтений.

Axis 1 and Axis 5 are set **in parallel on the same work**, in one pass, and are expected to diverge. Do not run one after the other; a scale run second is the scale dropped under pressure.

No axis outranks another by default. When two scores point opposite ways on the same block, the block's function in the scenario decides, and you write which function you used.

Anti-generic check, applied to your own output: if two different briefs produced the same score on every axis on this page, you did not read the briefs. Name at least one axis where they diverge, and say what in the brief moved it.

If you find yourself scoring a work on a scale that is not on this page, it did not come from this model. Check `references/limits.md` before using it, and if it is not there either, mark it a hypothesis of your own and say so.

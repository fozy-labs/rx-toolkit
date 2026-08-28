---
astp-source: fozy-labs/astp
astp-bundle: design
astp-version: 1.0.0
astp-hash: ef7c18c0f066b5abb806554ba0a718746e9e424b7d654bf024f4c8704f6e5a81
---
# Anti-patterns — the failures this model names, and why

> Loaded when: a decision or an edit is about to be defended by a habit; a move you remember working is about to be repeated; something reads as wrong and you need the mechanism rather than the impression; or a critique of yours or someone else's work needs a name that is not taste.

## How to read this file

Nothing here is a prohibition you may apply on sight. Each entry gives the reading that turns the act into a failure, the mechanism by which it fails, the verdict that follows **from that reading only**, and the conditions under which the same act is correct. Cite an entry without its governing Ledger line and you have produced fake method — the exact object this model rejects.
RU: анти-паттерн — не запрет, а диагноз, который каждый раз выводится заново; приём без чтения — это схематоз.

Three usage rules. First: if you can restate an entry as "never do X", you have misread it — go back and find the reading it depends on. Second: no entry here names a style, a palette, a typeface, or a look; failures are named by mechanism, because prohibiting looks narrows the reachable space and that narrowing is itself a failure of this method. Third: section F lists rejections that verification itself struck out, so that they are not re-imported as wisdom.

**What the Status lines mean, stated precisely, because it is easy to over-read them.** The adversarial verification pass audited three things: the seven axes, the moves inside the six stages, and the thirteen tensions. It did **not** audit the anti-pattern collection as a unit, and no entry below was individually certified as an entry. Each Status line records the standing of the *underlying move, axis or tension* the entry rests on — so "confirmed" means the mechanism is confirmed, not that this wording, this verdict, or this correct-when clause was checked. The composition of mechanism into entry is this skill's, and it is the part most likely to be wrong. Single-occurrence, inverted, and absent material is registered in `references/limits.md`; where an entry leans on any of it, the entry says so inline, and if it does not, that is a defect worth reporting.

Section letters map onto gates: A to the charge column, B to the sign column, C to surface and accuracy, D to scenario and advance, E to Layer 0.

## A. Charge column — failures of the accent palette

### A1. Adjacent equals merged into one spot
Two neighbours in the block ordering carrying the same charge are not read as two; at surface gaze they defocus into one blob and both are skipped, and equal weights specify no traversal order at all, so attention control is simply switched off.
RU: соседние равные заряды слипаются в одно пятно и пропускаются оба; равные веса не задают порядок обхода.
- **Governing reading:** slot 8 (required span) and the block's function in the scenario.
- **Verdict when the block is not a choice among equivalents:** the cure is isolation — separate the pair spatially or move one to another contour — not recolouring; colour applied to a merged pair merges the colour too. Neighbours differing by 2–4× (illustration, not a norm) is the usual working range.
- **Correct when:** the block *is* a choice among equivalent options. Equal charges are then the right answer and the work is exclusion (эксклюзия) — separating equals so each is findable — not accent. Also correct when the two points should have been collapsed into one unit of comparison instead of separated.
- **Status:** confirmed; the span figures are illustrations that float across the corpus.

### A2. A block added, the palette left alone
The frame's charge budget is closed between cognitive acts. A new block takes weight silently from every existing one, the charges converge, and the hierarchy dies without any single decision having caused it.
RU: новый блок молча отбирает вес у прежних, доли сближаются, иерархия умирает.
- **Governing reading:** slot 5 (obligatory block count) and slot 8.
- **Verdict:** after any addition, re-read the whole accent palette, not the new block. When the count is objectively large, attack the *number* of blocks — contest one, push one to the second contour, collapse a row into one unit — rather than pushing contrast harder.
- **Correct when:** nothing. Adding is legitimate; adding without re-reading is not. Note the budget does **not** conserve across a cognitive act: after a click, a scroll, a paragraph read, or a field filled, blocks re-charge and the palette must be read again for the new state.
- **Status:** core-confirmed; narrowed — "fixed attention budget on a screen" is too strong, the closure holds only between cognitive acts.

### A3. An element that never exhausts
Exhaustion is what lets attention move on. An element that renews its accent status on its own schedule — travelling with the scroll, animating, updating — is never exhausted, and so it takes charge continuously regardless of its area or brightness. Motion wins permanently, which is exactly why it is rarely free.
RU: акцент отбирает не яркость, а невозможность исчерпания; движущийся вместе с контентом элемент обновляет статус бесконечно.
- **Governing reading:** slot 4 (renewal events on this carrier) and slot 1.
- **Verdict when this element is not accent #1:** fix it, remove it from the carrier, or strip its accent weight. Dimming an unexhaustible competitor does not work — it re-charges each pass; it comes off the carrier or it stays a competitor.
- **What motion may legitimately be spent on**, because "remove it" is only half an answer and the other half is a derivation, not a prohibition. Motion cannot be exhausted, so it cannot be budgeted like a charge; what it *can* do is carry a **state change that hands charge from one block to another** — the case where two live actions genuinely coexist and the resolution is a transfer rather than two simultaneous holders. Price it the same way as any per-pass device: the attention it takes on each pass, multiplied by slot 4's pass count, against what the state change delivers. On a carrier with no renewal events that multiplier is one, and motion is correspondingly cheap; on a daily surface it is unbounded, and that is the whole of the objection.
- **Correct when:** the unexhaustible element *is* accent #1 — the thing the product exists for. Then permanence is the instrument, and everything else is the claimant.
- **Status:** confirmed as the mechanism (motion never exhausts). The pricing above is this skill's composition of that mechanism with the pass count, not a separate corpus claim.

### A4. The accent loop
Two points that re-charge each other across a cognitive act. A neighbour that remains in the field of view while a hard act runs (reading a paragraph, filling a field) gets part of its charge back, and the cycle repeats — the cost is paid on every pass and the probability of the break-away rises until it dominates.
RU: всё, что остаётся в поле зрения во время действия, перезаряжается и образует петлю; конкурента убирают с носителя, а не приглушают.
- **Governing reading:** slot 4 — how many renewal events exist and where.
- **Verdict:** name the pass count first. A loop paid once is cheap; a loop paid on a daily path is the most expensive object on the screen.
- **Correct when:** the carrier has no renewal events at all — a single-pass carrier has no loops and the diagnosis is inapplicable. Say so instead of importing it.
- **Status:** confirmed.

### A5. The default peak on what the user already knows
Charge spent on the heading you arrived by, the navigation that will be found anyway, the user's own name on a screen reached by tapping their own icon. The path to the screen has already exhausted its title; the weight is spent on zero information and taken from the parameters the screen exists for.
RU: акцент отдают тому, что иначе не будет найдено, а не тому, что важно на словах; путь до экрана исчерпывает заголовок.
- **Governing reading:** slot 5 (who came here for what).
- **Verdict:** write down what has to be learned first for the decision to be made, and demote everything not on that list. Where the declared accent and the accent the form actually produces disagree, that is a provable error, not a matter of taste.
- **Correct when:** the block genuinely is not findable without weight — an unfamiliar mechanic, a state the user cannot predict, a datum whose miss is expensive. Criticality sets the contour: the higher the cost of missing it, the closer to the first contour.
- **Status:** confirmed.

### A6. Accent colour split across predicates
One accent colour carrying several different entities at once — the mark, a heading, two buttons. The spots join into a single structure, the actualisation order becomes unpredictable, and the user reads "accent" as "rank" and presses everything that carries it.
RU: акцентный цвет — ограниченный ресурс; дробить его между разными сущностями нельзя даже ради удобства.
- **Governing reading:** slot 7 (sign budget) plus the predicate occupancy check — what does this colour already mean here.
- **Verdict:** bind the accent colour to one entity and keep it for the target action; a large neutral field with one accent inside it (90/10 is an illustration, not a norm) is one way to reach the span, not the way.
- **Correct when:** the colour is carrying a *code* rather than an accent — status, category, ownership — and is read as a code by this audience. Then repetition is the point, and the accent must be built by another instrument.
- **Status:** confirmed; the inversion move (dropping the accent colour to the background and neutralising the target) rests on a single occurrence — see `references/limits.md`.

### A7. Span spent at two limits at once
Building the accent with weight and contrast both pushed to the edge of legibility — an accent that exists in the editor and does not exist on the device. The extremes compress toward each other, the span is not achieved, and the reading cost is paid on every pass.
RU: акцент, существующий в макете и не существующий на устройстве: экстремумы сжимаются, размах не набран.
- **Governing reading:** slot 8, plus the carrier's real viewing conditions.
- **Verdict:** build the span with the coarsest instrument that reaches it (usually size and position), add finer differences afterwards, and check the result under bad conditions — a cheap display is his own check.
- **Correct when:** the surrounding blocks are already differentiated by another instrument, and the fine difference is carrying separation, not accent.
- **Status:** core-confirmed. The adjacent remarks about print and about the left third of a colour box belong to a guest in the corpus and must not be attributed to the author or used as rules; see `references/limits.md`.

## B. Sign column — failures of sign-load and plot

### B1. Low sign-load occupying the plot slot
Low sign-load (малознаковость) is a legitimate strategy, not a defect. It becomes a defect in exactly one configuration: when a low-sign object is placed in the plot slot to fill an empty area. It then holds compositional weight while transmitting nothing, and once its origin is recognised — as generated, as bought in bulk, as arbitrary — the sign-load falls to its minimum and the advance with it.
RU: малознаковость — стратегия, а не дефект; дефект — когда малознаковое занимает сюжетный слот, чтобы закрыть пустое место.
- **Governing reading:** slot 7 (which slot gets high sign-load and which gets low).
- **Verdict:** either move the low-sign object to the background where it belongs, or repair it — take it into multiplicity by number, or add detail so that sign-load plus detail becomes plot-load.
- **Correct when:** the low-sign placement is deliberate and slotted — a background that must not compete, or a mark built low-sign on purpose, which is one of several equally valid ways to build a mark.
- **Status:** confirmed. Do not convert this entry into a list of disallowed imagery; the diagnosis is about the slot, never about the genre of the picture.

### B2. Emptiness treated as a single-cure problem
An empty carrier is a fork, not a rule. It is cured either by spreading the hierarchy — widening the span among what is already there — or by adding sign and plot. The failure is committing to one of the two without stating which reading chose it.
RU: пустота лечится либо разносом иерархии, либо добавлением знака и сюжетки; развилка, а не правило.
- **Governing reading:** slots 1 and 2 together — is the emptiness costing time, or costing affect.
- **Verdict:** name the branch out loud and name what it costs; both branches are used in the corpus, sometimes on the same work.
- **Correct when:** both — that is the point of the entry.
- **Status:** confirmed as a fork; anyone stating it as a rule has flattened it.

### B3. A mark whose complexity comes from duplication or from one shape family
Copies of a near-identical element are exhausted at a glance, and geometry drawn entirely from one family of forms is passed through by the first perceptual filter without being resolved. Complexity was added; sign-load was not.
RU: копии почти неотличимы и мгновенно исчерпываются; однотипную геометрию первичный фильтр восприятия проскакивает насквозь.
- **Governing reading:** slot 7, run through the circle / square / triangle filter and the decomposition of the form into entities.
- **Verdict:** introduce an exclusive entity, mix form types, change distances and the type of symmetry; then reduce the variant to a single load number and compare.
- **Correct when:** the repetition itself is the sign — a system, a count, a rhythm the audience reads as meaning. Note the correction: symmetry is itself a self-similar structure, so load comes from *breaking* it, not from having it.
- **Status:** confirmed.

### B4. Stylisation spread until it competes with the logos
Every additional stylised surface takes accent away from the logos the stylisation was introduced to serve. The text is primary: strip it out and what remains is a shell of surplus densities, not a surviving impression.
RU: каждая лишняя стилизация смещает акцент с логосов, ради которых стиль и заводился.
- **Governing reading:** slot 2 (affect carrier) — if affect is already carried elsewhere, the interface adds none.
- **Verdict:** pick the specific logos that can carry detail and stylise those; a device applied everywhere is a device applied nowhere.
- **Correct when:** the carrier is dedicated to impression and is not on a hot repeated path — an achievement screen, a story frame, a card. There stylisation is a long-term asset and is strengthened, not trimmed.
- **Status:** confirmed; the reverse test ("remove the text — does the plot survive") is recorded in the corpus with the *opposite* conclusion and must not be used — see `references/limits.md`.

### B5. A device used once
A device that occurs once builds no layer; it reads as an exception and introduces a rhythm nothing answers. Related: a difference too small to resolve — an element made slightly smaller, slightly lighter — neither unites nor separates, and perception hangs between the two bins, which is read as sloppiness.
RU: приёму нужен ответ — второе вхождение; разница «чуть-чуть» не объединяет и не разделяет.
- **Governing reading:** slot 7 and the visual-rules count.
- **Verdict:** either give the device a second occurrence or remove it; make the difference explicit and multiple, without breaking the relation.
- **Correct when:** the single occurrence *is* accent #1 and its uniqueness is its exclusivity — the singular thing on the carrier. Exclusivity is the precondition of accent: large among large, or a photo among photos, holds no accent whatever its own weight.
- **Status:** confirmed.

## C. Surface and accuracy

### C1. Substrates and outlines instead of separation
An outline or a rule is a block of the ordering in its own right: it adds density where no accent was planned. Nesting compounds it — by the third level the spacing stops separating, the levels' spacings become comparable, and the screen fills with ripple. Division is imitated by form while the blocks stay equal by charge.
RU: обводка — самостоятельный блок секвенции; на третьем уровне вложенности отступ перестаёт разделять.
- **Governing reading:** the four ordered layer tests — information, own exclusivity, spacing progression, composition holding without a substrate — stopping at the first that fires.
- **Verdict:** two levels of **card** nesting is the confirmed limit; for outlines, rules and other layer types treat two as the working ceiling by analogy and say that the extension is this skill's. Having spent it, change the instrument of separation rather than adding a layer. Two prohibitions: a layer must not duplicate a separation that already exists, and a legal layer must not be so weak that removing it changes nothing. Before adding a substrate, build the maximum configuration here and now and see how many substrates will follow.
- **Correct when:** the composition genuinely does not hold without a substrate — then the substrate is legal and must itself be stylised, not left neutral filler.
- **Status:** confirmed.

### C2. Spacing set as absolute numbers
A spacing value chosen without looking at the level above and the level below cannot be checked, because the object being checked is the progression along letter → space → line → paragraph → block, not any single gap. The question is always "is there a block on the other side".
RU: отступ — это отношение к соседним уровням, а не число: буква → пробел → строка → абзац → блок.
- **Governing reading:** the progression just derived for this work, counted by eye.
- **Verdict:** violate the progression only by naming one of three and only three legal grounds — there is nothing on the far side (a screen edge); the separation is already carried by a non-spatial means (this ground rests on a single passage from one conversation with a guest — the weakest of the three, and say so when you lean on it); the violation actually split two concrete groups harder than the progression could. A fourth ground is invention. The accent multiplier is a different multiplier and must not be imported into spacing.
- **Correct when:** the progression is what produced the number — then the number is an output, not a rule, and it does not travel to the next brief.
- **Status:** core-confirmed; the author left the admissible zone of exaggeration undefined, which stays open. Multiples of four and eight are a guest's criterion the author disputes and are not an argument (forbidden — see `references/limits.md`).

### C3. Visual rules accumulating; two systems on one screen
Each new rule — another weight, another case, another corner radius, a bespoke device per screen — introduces another rhythm. Their sum is desynchronisation, which authors explain to themselves as liveliness. The count of visual rules is the measure.
RU: каждое правило — новый ритм; их сумма даёт расинхрон, который себе объясняют как живость. Счётчик визуальных правил — мера.
- **Governing reading:** slot 3 and the separability criterion.
- **Verdict:** count the rules; reuse what is already introduced; carry one principle of finishing to the end even at the cost of a less striking passage. Introduce a new entity only against a demonstrated systemic need.
- **Correct when:** the second rule is carrying a segment boundary that genuinely exists in the scenario — a hot repeated path inside an otherwise atemporal product, or a dedicated carrier inside an imperative one. One product legitimately carries several readings; that is where internal variety comes from, and it is not the same thing as an uncounted pile of rules.
- **Status:** confirmed.

### C4. A translucent layer over arbitrary content
A layer laid over content that was not prepared for it makes contrast and accent a function of a random image, and everything visible becomes a block. Where the image is the only carrier of impression, the layer kills it to buy legibility that a prepared frame would have given for nothing.
RU: слой поверх произвольного контента делает контраст и акцент функцией случайной картинки.
- **Governing reading:** slot 2 (is this image the affect carrier) and the four layer tests from C1.
- **Verdict:** prepare a place for the text inside the frame, or use light and shade already in the scene. An expensive supplied raster is scanned for signs to build on, not framed and covered.
- **Correct when:** the composition does not hold otherwise and the image is not the affect carrier — then it is an ordinary substrate decision and runs through C1.
- **Status:** core-confirmed. Claims about specific colour behaviour under overlay are not part of the verified model; do not import them.

### C5. "Made it cleaner" by deleting scenario blocks
Deleting blocks deletes logos with them: the user's questions go unanswered, and the cleanliness is paid for in the time needed to reconstruct state. Separately, "fewer densities, therefore faster" is the model's own name for fake method — it is a time claim with no measurement artefact behind it.
RU: вместе с блоками уходит логос — вопросы пользователя остаются без ответов; «меньше плотностей — значит быстрее» это схематоз.
- **Governing reading:** slot 5, plus the accuracy account.
- **Verdict:** remove shell and duplicates while keeping the answers the block ordering owes. (The stronger form — demanding an intercepting mechanism for every removed logos — rests on a single corpus occurrence; raise it as a question, do not enforce it as a gate. See `references/limits.md`.) If the change cannot alter group membership, contour assignment, or the accent palette, call it accuracy out loud, put it on the atemporal account, and stop dressing it as speed — accuracy is roughly a fifth of the assessment (confirmed correction), not half.
- **Correct when:** the deletion changes group membership or lets data merge into a foreign group — then it is critical and is argued through time, with the artefact named.
- **Status:** confirmed.

## D. Scenario, advance, and the cost of every pass

### D1. Duplicating so that it is definitely noticed
Duplication is an operation on **accent**, not on information. It costs only when the duplicate has to be noticed or read; a duplicate that falls under an eye already standing in the cell costs nothing.
RU: дублирование — операция над акцентом, а не над информацией; цена возникает, только если дубль надо заметить или прочитать.
- **Governing reading:** slot 4 (where the eye already is) and slot 8.
- **Verdict:** strike out the insurance repeat — the icon beside the text that decodes it, the footer copying the header, one status in two places. The threshold is sharp: once more than one field has to be duplicated, the gain has ended.
- **Correct when:** the duplicate is read by an eye already in the cell — a unit, a currency mark, a status inside the row it belongs to. Keep it and make the cell composite.
- **Status:** confirmed.

### D2. A key held in a legend, and state held in memory
Pulling the key — price, status, mapping — into a separate block makes memory a load-bearing resource of the scenario. By the time the block is read the legend is gone, and a return loop is paid on every pass while the layout gains nothing.
RU: память — самый ненадёжный ресурс сценария; легенда оплачивается петлёй на каждом проходе.
- **Governing reading:** slot 4 (pass count) versus the self-similarity cost of the duplicate.
- **Verdict:** compare the two costs explicitly. A duplicate is damped by self-similarity once; a legend loop is charged every pass — which usually decides for the composite cell, but the comparison must be run, not recalled.
- **Correct when:** the carrier is single-pass, or the fields needing duplication exceed one — see D1's threshold.
- **Status:** confirmed.

### D3. The main action hidden behind a disclosure
Cost multiplies by repetition frequency. An action on the main path placed behind an icon, a modal, a disclosure, or a confirmation turns the primary scenario into a maze, and a disclosure additionally destroys diagonal scanning of what it hides.
RU: стоимость умножается на частоту повторения; клик ради раскрытия — неочевиден и лишний.
- **Governing reading:** slot 6 (advance and entry point) and slot 3.
- **Verdict:** the main action belongs to the first contour. Imperativeness amnesties costs paid **once, while learning** — an unclear label, an unexplained icon, one episode of wandering. It never amnesties costs paid on **every pass** — a mis-hit, a small target, a long gaze traverse, an extra step in a frequent scenario, membership, separability, accuracy. Hiding is a per-pass cost only if the control is needed per pass.
- **Correct when:** advance says so — hiding a control on a repeat visit is one of the decisions advance and only advance settles. A long session and human onboarding widen the amnesty; a short frequent visit narrows it.
- **Status:** confirmed.

### D4. Onboarding before the first reward
A gated tour — everything blocked, tips in series, system permission requests before engagement — unloads information before any value has been received and separates the person from the product at the point where advance is lowest.
RU: онбординг выгружает информацию до первой награды и отделяет человека от продукта.
- **Governing reading:** slot 6, walked joint by joint: does this step add advance or burn it.
- **Verdict:** let the user act, and supply hints reactively at the moment they are earned; keep controls active and, on press, show what is missing rather than disabling and leaving the gap to be guessed.
- **Correct when:** the advance curve across the segment says onboarding is warranted — this is one of the four decisions advance settles, and it is settled by the curve, not by the presence or absence of a tutorial in comparable products.
- **Status:** confirmed.

### D5. The call before the reason
An element that is purely temporal — a call to act — placed ahead of the atemporal unit that informs, takes the accent from the thing that was supposed to earn the action. On a one-pass carrier the order attract → inform → lead away is an order, not a proportion.
RU: юзер получает призыв раньше причины; триада «привлечь → проинформировать → увести» это порядок, а не пропорция.
- **Governing reading:** slot 6 (entry point) — cold traffic carries almost no advance; a return carries a lot.
- **Verdict:** place the call by accumulated advance, and place friction immediately before the point where the user is already up against value, not earlier.
- **Correct when:** absolute temporality — the user has already decided and there will be no drop. The advance question switches off; say so out loud, because that is the switch being visible.
- **Status:** confirmed.

### D6. A device copied without its function recovered
A borrowed device arrives with the mythology of the product it came from. Copying competitors also fixes the ceiling at their level, and an assembly of attractive fragments does not yield an attractive whole — a hoard of devices (соберуха) does not transfer to a new task because nothing is derivable from it.
RU: заимствованная форма приходит из чужой мифологии; из красивых кусков красивое целое не следует.
- **Governing reading:** slot 3 and slot 7; read this business's own mythology and take the device only where its original function is needed.
- **Verdict:** structure first, content fitted to it; a device is admissible when you can state the function it performs here.
- **Correct when:** the element must be **found** by someone looking for it — navigation, mechanics, layout. There the mass solution is the correct choice, and a departure is paid for with a new logic you can articulate. The width of the audience sets the range of permissible departure, and repetition inside your own layout is not covered by this at all.
- **Status:** core-confirmed. The criterion for the opposite case — an element that must **intercept** a gaze looking for something else, where the mass device is dead regardless of execution — is reconstructed from the author's account of banner blindness and is never stated by him in one sentence; treat it as open, see `references/limits.md`.

## E. Layer 0 — failures of argument

### E1. Handing the decision to an external arbiter
"It works", a conversion figure, a public vote, a big company's precedent, a test with neither the sample nor the attribution to support it. Any workable layout will let the scenario complete, so completion proves nothing about what would have worked better; and an unattributable fact closes the question instead of answering it.
RU: метрика законна как источник задачи и незаконна как закрывающий аргумент.
- **Governing reading:** Layer 0, always active.
- **Verdict:** when struck with a metric, ask for attribution (what else changed) and provenance (who, how, on what sample). When verification is impossible, fall back on consistency with decisions already accepted, and on usability tests and corridor checks — his own prescription. A model is refuted by a series of failed variants, not by one.
- **Correct when:** the metric is the *source* of the task or its target. Rejecting a test for insufficient traffic or unattributable results is not rejecting measurement as a method.
- **Status:** confirmed. Remarks about the comparability of periods in short tests belong to a co-host, not the author.

### E2. Claims about someone else's perception
"Obvious", "intuitive", "faster this way", "the user won't notice anyway", "the managers won't approve it". Each substitutes a speculative chain for a measurement, and none survives a flat contradiction, because there is no artefact behind it.
RU: утверждение о времени требует названного замера — иначе его не произносят.
- **Governing reading:** Layer 0, currency rule — the reading decides which defence is admissible; a defence paid in the wrong currency is void even when it sounds right.
- **Verdict:** name the measurable quantity — traversal order, time on task, step count, a usability report, an eye-tracker — or relabel the claim honestly as accuracy and put it on the atemporal account.
- **Correct when:** never as a closing argument; always as a hypothesis, if labelled as one out loud.
- **Status:** confirmed.

### E3. Definitions that are lists, and prohibitions from someone else's handbook
Nothing is derivable from an enumeration. A blind prohibition imports someone else's visual practice in place of reasoning, and a schematisation eats exactly the part of the phenomenon that made it interesting.
RU: из перечисления признаков ничего не выводится; запрет навязывает чужую практику вместо рассуждения.
- **Governing reading:** Layer 0, derivability test — plus the paired question: where would I knowingly break this rule, with a gain?
- **Verdict:** run the substitution test on any definition offered as a list. Restate every prohibition as the question "where does this device work, and does it survive competition with the functionality here". Require of any model both its boundary of applicability and a case where it could be wrong.
- **Correct when:** the practice is derivable on the spot. Visual practice is not a vice in itself — a device is praised and adopted when a model-level reason for it can be given immediately. The vice is the practice untethered from the specifics of this task.
- **Status:** confirmed; the term соберуха names a genre of content, not a property of a layout, and must not be used as the name of the model-versus-practice axis.

### E4. Generalisation past the demarcation line
A model that answers both "how does this interface work" and "how does a person walk down a corridor" answers neither. Cross-domain transfer is a source of hypotheses and never a link in a derivation.
RU: модель, отвечающая на слишком широкий класс вопросов, не отвечает ни на один.
- **Governing reading:** Layer 0.
- **Verdict:** when extending a concept, name the class where it stops working — this is compulsory, not optional. An analogy may stay in the reasoning but may not be cited in the verdict. Applied to someone else's term inside its own field, the right verdict is usually "not applicable here", not "empty word".
- **Correct when:** the transfer is marked out loud as a hunch or a joke, and the verdict is re-derived from inside the model.
- **Status:** confirmed.

### E5. Research shown as volume
Artefacts produced for the fact of their existence — a wall of screens, a stack of documents — do not show the problem the design started from, so the solution has nothing to be checked against, and the credibility of the whole case falls.
RU: не показано, от какой проблемы шёл дизайн, поэтому решение нечем проверить.
- **Governing reading:** Layer 0.
- **Verdict:** for every conclusion drawn from research, immediately show which decision closes it. A finding with no decision attached is decoration; a decision with no finding is taste declared as method.
- **Correct when:** the artefact is doing work — it eliminated a hypothesis, shortened the path to a decision, or produced a prediction. That is the same derivability test applied to process rather than to form.
- **Status:** core-confirmed; specific deliverable checklists are not part of the verified model, so do not turn this into a required set of documents.

### E6. Judging against the previous version only
Comparing "before" against "after" makes difference the criterion. Accumulated edits then look like development while being drift (дрейф): each layer moves further from the value, and nothing in the comparison can detect it.
RU: накопление правок выглядит как развитие, а является дрейфом.
- **Governing reading:** slot 5 — the original value, held in view.
- **Verdict:** test each edit against delivery of value, not against the previous state. And do not judge from inside your own drawing: get the work out of your own frame before assessing it.
- **Correct when:** the previous version is the artefact under examination — a stated regression, a known defect — and the comparison is the measurement, not the argument.
- **Status:** confirmed.

### E7. Global balance instead of local pairs
Evening out the amount of information between halves of a screen optimises a quantity perception does not compute. The verdict always comes from an interval — a pair of neighbours in the block ordering — and the reading is local: per segment, per screen, per contour.
RU: глобальный баланс масс на восприятие не влияет; проблема всегда локальная.
- **Governing reading:** the block ordering, read pairwise, including overlapping sets.
- **Verdict:** watch that neighbours do not merge; state which pair produced any verdict you give. A verdict without its interval is not a verdict.
- **Correct when:** the object under judgement genuinely is the whole frame — an identity, a single-pass carrier read at one glance — and even then the extremes are what is measured, not the masses.
- **Status:** confirmed.

### E8. Treating a level of hierarchy, or any device, as an absolute good
"Make it high, you'll never lose" is a starting assumption, not an argument of defence. Products with many scenario-obligatory blocks are unavoidably low in hierarchy and that is legitimate; grids, minimalism, and consistency are frequently justified by the convenience of whoever implements them rather than by the task.
RU: нужный уровень иерархичности выводится из числа обязательных блоков и функции блока, а не постулируется.
- **Governing reading:** slot 5 and slot 8 together.
- **Verdict:** derive the required span from the count of scenario-obligatory blocks and the block's function. Few obligatory blocks (five to seven is a working threshold, illustration) → a wide span is mandatory and "complex product" is not a defence. Objectively many → attack the number, not the contrast. Check the inverse error too: the span may be present and given to the wrong block.
- **Correct when:** flatness is forced by content — then say so and work on separation of equals. Diagnose which fork you are on: flatness imposed by the material, or flatness the designer created.
- **Status:** confirmed. This entry governs every other entry in this file: an anti-pattern promoted to an absolute is itself E8.

## F. Rejections that verification struck out — do not re-import

These circulated as anti-patterns of this model and are not. Each is either inverted, single-occurrence, or absent from the corpus; `references/limits.md` holds the full register with the evidence.

- **Entering a critique from the surface is not an error.** In the overwhelming majority of live critiques the author starts from whatever first catches the eye and reconstructs the frame afterwards. What is illegitimate is *committing* an edit before the frame is written down, not looking at the surface first.
- **Not a multiple of two** — inverted; the author's own step is close to that and he explicitly permits it. Multiples of four and eight are a guest's criterion he disputes.
- **"Accent is not a property of a block"** — his definition says the opposite.
- **"Remove the text — does the plot survive"** — the experiment exists with the reverse conclusion: the logos is primary.
- **Outlines returning an element to its own layer** — contradicts his position; the mechanism he uses is self-similarity and merging densities.
- **Interrogating named laws of perception for derivability** — those names do not occur in the corpus at all.
- **"A block everyone reworks is underdefined"** — inverted; a shared complaint about one block localises the error and is good news to him.
- **The opposition around the term секвенция**, retracted by the author himself, together with the repeatability criterion he dropped with it — see `references/limits.md` and do not reconstruct it.
- **Calibrating detail on a hyperdetail axis**, the five-part addressee taxonomy, naming the niche before reading the brief, and hunting for a refusal screen — absent from the corpus.

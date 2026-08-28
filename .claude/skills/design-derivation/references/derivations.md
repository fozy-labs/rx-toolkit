---
astp-source: fozy-labs/astp
astp-bundle: design
astp-version: 1.0.0
astp-hash: 281a41e94037919c9ea443642f54661941b4d06ab07d938df78ffd7d6f9a8799
---
# Worked Examples

> Loaded when: a Ledger line is contested; you cannot see how a gate produces a structural difference; a verdict needs the inference that would justify it; or you are early in using this skill and need to watch a derivation run end to end.

## How to read this file

Each entry is one judgment, taken apart into four parts: **Situation** (what was on the screen), **Noticed** (the observation that started the reasoning), **Inference** (the step that turns the observation into a verdict — the only part worth learning), **Principle** (what generalises, paired in the author's Russian), and **Counter** (the conditions under which the same form is correct).

The Counter line is not a caveat. It is the proof that the operation is unsigned: every entry here describes an act that is a gain at one reading and a loss at another, and the entry is useless without the reading that signs it. An entry read without its Counter becomes a rule, and a rule is what this skill exists to avoid.

Rules for using them:

- **Never carry a verdict across.** Carry the inference. If your brief resembles a case here, that resemblance is not evidence; run the gate.
- **All situations are paraphrased and anonymised.** Products, studios and authors are not identified, numbers from the original cases are stripped unless the number is the point, and no line here reproduces anyone's speech.
- **Entries name the gate and Ledger slot they feed.** That tag is where the case joins your own derivation.
- Every number carries its status inline. A number without a status is not usable — see `references/limits.md`.

**Verification standing of this file.** The cases below come from the extraction layer. The adversarial verification pass audited the axes, the moves in the six stages, and the tensions — it did **not** audit the worked judgments case by case. Most of the mechanisms a case turns on are traceable to a verified move, and where a case leans on single-occurrence, open, or someone else's material it says so inline. The framing of each case as Situation / Noticed / Inference / Principle / Counter is this skill's, not the author's. Treat a case as an example of a derivation running, never as a precedent.

---

## Two Ledgers, side by side

This is the section to read first. It is the only place in the skill where the artefact every output must contain is shown filled, and it is filled twice on deliberately unlike briefs so that the divergence is visible rather than promised.

Neither Ledger is a template to copy. What is worth taking is the *shape of the disagreement* between them — which slots moved, what in the brief moved them, and which operations came out with opposite signs as a result.

### Ledger A — an imperative daily working surface

```
LEDGER — shift-handover screen, internal records system

1 TEMPORAL READING   8/10 (illustration scale); defended by time-to-find-current-medications; artefact: the ward handover log
2 ATEMPORAL + CARRIER 1/10; carrier: nobody — no content, world or object carries affect on this surface
3 TOPICAL POSITION   block — the solution sits inside one carrier; surrounding orderings are fixed by clinical workflow
4 CARRIER            block = one labelled data group; ordering identity → orders → alerts; 4 renewal events per pass; advance live
5 VALUE + OBLIGATORY the clinician came to decide the next intervention; obligatory blocks: 11
6 ADVANCE            return, many times daily → ON, starting high; permissible aggression near zero
7 SIGN BUDGET        ward staff on shift; 3 unambiguous interpretants; high load → alert row, low → everything else
8 REQUIRED SPAN      narrow; 11 obligatory blocks exceeds the five-to-seven threshold (illustration), so operate on count and on separating equals

FLIP          slot 5 — contest the count down to five and slot 8 inverts to a mandatory wide span
SEGMENTS      handover screen / patient chart / alert modal; the modal is absolutely temporal, so advance is OFF there and ON here
INAPPLICABLE  nothing fails: renewal events exist, a next step exists, temporality is not absolute here, the audience is named, the carrier is inside the demarcation
DIVERGENCE    against Ledger B: axis 1 and axis 4 both move; contact frequency and entry point moved them
```

### Ledger B — an affect-led one-pass carrier

```
LEDGER — drop announcement frame, cold traffic

1 TEMPORAL READING   3/10; elements defended by affect, not by time; the one time claim here belongs to the checkout segment
2 ATEMPORAL + CARRIER 9/10; carrier: the act's own sleeve art and press photography — affect is already delegated
3 TOPICAL POSITION   scenario — the solution is in linking this frame to the product page and the checkout
4 CARRIER            block = one visual spot at defocus; ordering attract → inform → lead away; 0 renewal events; advance live
5 VALUE + OBLIGATORY the visitor came to judge whether this drop is worth money; obligatory blocks: 3
6 ADVANCE            cold traffic → ON, starting near zero; a modal here produces the exit
7 SIGN BUDGET        existing listeners of this act; 2 unambiguous interpretants; high load → the drop image, low → price and size rows
8 REQUIRED SPAN      wide; 3 obligatory blocks is under the threshold, so a wide span is mandatory and "we have a lot to say" is not a defence

FLIP          slot 2 — withdraw the sleeve art and the interface becomes the affect carrier; the propagation route closes and the budget must be earned by the layout
SEGMENTS      drop frame / size-and-price block / checkout; the checkout is absolutely temporal, advance OFF, sign budget deliberately zero
INAPPLICABLE  zero renewal events: the renewal law, the loop diagnosis and every per-pass cost argument are void on this frame
DIVERGENCE    against Ledger A: axis 1 and axis 4 both move; contact frequency and entry point moved them
```

### What diverged, and which operations it re-signed

Seven of the eight slots hold different values, and slot 8 is **computed** from slot 5 in both — so the difference in required span is not a preference, it has an arithmetic cause either Ledger can state. Three operations come out with opposite signs, each for a reason that lives in a named slot:

- **Stylise.** A loss in A: slot 2 says the interface would be the carrier, so a return exists, but slot 4's pass count is unbounded and slot 1 reads 8 — cost dominates. A gain in B: slot 2 names an external carrier, so *added* affect returns zero, but the propagation route is open and the pass count is one, so a surface that carries the existing sign is cheap and effective. Note that the two verdicts do not share a reason; a rule of the form "stylise less on working surfaces" would have reached A's answer for the wrong cause and B's not at all.
- **A layer that dissolves boundaries** (glow, blur, a shadow standing in for an edge). Cancelled in A: membership errors are possible and expensive there, so the separability gate fires. Legal in B: no datum on that frame has to be attributed to any group, so the gate has no precondition and the surface language is reachable by derivation rather than permitted by exception.
- **A flat gradient.** In A it is the correct output of the flat branch — the equals are genuinely equals and the work is separating them. In B it is a defect, because slot 5 puts the obligatory count under the threshold and there is nothing forcing the flatness.

Run this comparison on your own two answers. If you cannot produce three lines of this kind, the second answer inherited the first, and the DIVERGENCE line in the output contract is what should have caught it.

---

## Frame, value, scenario — Gate 1

### 1. A number in the brief with an invisible constraint behind it

**Situation.** A booking interface for a physical venue; the brief specified small groups, the layout offered a party several times larger.
**Noticed.** The larger figure appears nowhere in the brief and nowhere in any research attached to it.
**Inference.** The brief's number is not an arbitrary limit chosen by a copywriter; it is almost certainly the visible end of a physical constraint the designer cannot see — capacity, staffing, equipment count. Generosity beyond the letter of the brief is therefore not free variation; it is a claim about the real world that the layout cannot honour. The critic who reads only the explicit system files the complaint against the wrong object.
**Principle.** Variation beyond the letter of the brief is usually paid for by a hidden physical constraint; before widening a number, name the constraint that produced it.
RU: расширение сверх буквы ТЗ обычно оплачено скрытым физическим ограничением; прежде чем менять число, назови ограничение, которое его породило.
**Counter.** Where the constraint is informational rather than physical — a limit someone set by habit, a default nobody defends — assuming the wider case is the correct move, and it belongs *inside* the solution rather than as an objection to the brief.
**Feeds.** Ledger slot 5 (value and obligatory blocks).

### 2. Background as a lever, and the time claim that has to be paid for

**Situation.** A content-management tool used by staff every working day, drawn dark-on-light inverted.
**Noticed.** The surface treatment was chosen before the reading of the task was written down anywhere.
**Inference.** Two separate moves are packed together here and they must be separated. The sound one: background, typeface, density, share of area under image and the admissibility of stylisation are paradigm-level levers, and the temporal reading decides them — they are not taste, and a daily-contact working tool with time instrumentalised has already spent the argument that would defend an atmospheric background. The unsound one: "reading is slower on this treatment" is a claim about time, and under Layer 0 a time claim owes a measurement artefact (time on task, step count, usability report, eye-tracker). Without one, the claim is fake method (схематоз) no matter who makes it.
**Principle.** The modus decides the paradigm-level levers; a claim that a lever costs time is a separate claim and owes its own measurement.
RU: модус решает парадигмальные рычаги; утверждение, что рычаг стоит времени, — отдельное утверждение, и оно требует замера.
**Counter.** On a carrier where affect is the deliverable and contact is rare — a dedicated screen, a one-pass surface, a story frame — the same lever is derived in the opposite direction, and the measurement is owed by whoever objects.
**Feeds.** Ledger slots 1–2; Layer 0.

### 3. The path to value, and what each screen in front of it spends

**Situation.** An app whose entire value is a conversation; authorisation, a legal screen, a decorative onboarding illustration and two interstitials stood in front of it.
**Noticed.** Nothing before the conversation delivers any part of the value the user came for.
**Inference.** Name the value first, then count the steps to it, then judge each step by what it adds against what it spends. An onboarding screen is legitimate when it informs or transfers responsibility; it is not legitimate as decoration, because at this entry point (cold, voluntary) the advance (аванс) is near zero and every screen draws on credit that has not been earned. The instant-delivery experiment settles it: hand the user the conversation immediately and name what they lose. Whatever is not on that list is spend.
**Principle.** Find the value, measure the length of the path to it, and cut what is on the path without paying for its place.
RU: найди ценность, измерь длину пути до неё и вырежи то, что стоит на пути, не оплачивая своё место.
**Counter.** Where responsibility genuinely transfers (consent, irreversible action, money) the step is not spend, and where the entry point is a return visit the advance is high enough that the same interstitial costs almost nothing.
**Feeds.** Ledger slots 3, 5, 6.

### 4. One product, two sub-scenarios, two different readings

**Situation.** Two cases side by side. A music-rating app where a stylised spinning-disc gesture was required to set or change a rating. A game where opening the inventory could be instant, or could play an animation of the character taking off a pack.
**Noticed.** In the first, the affect the app trades in already arrives from cover art, clips and the competition itself. In the second, the identical function exists in two versions, one instant and one deliberately delayed.
**Inference.** Atemporality is decided by the carrier and by the stretch of scenario, never by the product type. In the first case the affect carrier is already named and is not the interface, so the interface adds none; and the stylised gesture sits on a hot repeated path, where an atemporal device is charged on every pass — so a neutral solution would not be a deficiency and the stylised one is a straight loss. In the second, the delay is not an error: the sub-scenario has been moved from the temporal reading to the atemporal one on purpose, and it extracts affect that the combat path has no room for. Adjacent sub-scenarios of one product legitimately live under different readings, and measuring them with one metric is the mistake.
**Principle.** Before demanding atmosphere from an interface, name its current carrier; and read each stretch of scenario separately, because one product carries several readings.
RU: прежде чем требовать атмосферы от интерфейса, найди её нынешнего носителя; каждый отрезок сценария читается отдельно — один продукт несёт несколько чтений.
**Counter.** A dedicated carrier — an achievement screen, a story frame, a card the user meets rarely — is strengthened rather than cut, because there the same device is a long-term asset instead of a per-pass toll.
**Feeds.** Ledger slots 1–2; the recompute triggers (segment boundary crossed).

---

## Charge and the block ordering — Gate 2, charge column

### 5. The first accent answers "what is this"

**Situation.** The home screen of a service for a life situation most visitors have never been in; the subject of the service was legible only from the placeholder text inside the search field, while the strongest accent went to a "get our mobile app" plate.
**Noticed.** The accent palette had been handed to a piece of functionality before the subject had been stated at all.
**Inference.** Charge is distributed along the order in which meanings must arrive, and the first meaning is what this is. Give the peak to a secondary action and the user reads the life situation wrongly — not slowly, wrongly. The fix is not to dim the plate; it is to give the peak to the block that answers the question, which changes the block ordering rather than the contrast.
**Principle.** The order of accents must match the order in which meanings have to arrive; the first accent belongs to the answer to "what is this".
RU: порядок акцентов обязан совпадать с порядком поступления смыслов; первый акцент принадлежит ответу на вопрос «что это».
**Counter.** On a screen reached from inside the product, the subject is already delivered by the path, and repeating it there is charge spent on the known — see entry 6.
**Feeds.** Ledger slot 8; accent #1.

### 6. Charge spent on what the user already knows

**Situation.** Two cases. A profile screen where the user's own name was set in an enlarged size, reached by tapping the user's own avatar. Two nearly identical layouts differing only in the weight of an explanatory heading, on a page the user arrives at by clicking that same heading.
**Noticed.** In both, the largest charge sits on information the user demonstrably already has.
**Inference.** Reconstruct the path *to* the screen before assigning charge. The heading you arrived by is exhausted before the screen loads; the name on a screen opened by tapping your own icon is zero information. Charge spent there is not neutral, it is subtracted from whatever the screen was opened for — the menu, the day's figures. Between two otherwise equal variants, the one that does not spend accent on the known wins, and the reason is statable.
**Principle.** Size goes to what the user came to find out, not to what they already know; the path to the screen exhausts its heading.
RU: размер отдают тому, что юзер пришёл узнать, а не тому, что он уже знает; путь до экрана исчерпывает его заголовок.
**Counter.** After a hard cognitive act — a click, a scroll, a filled field, a read paragraph — blocks recharge, and a heading exhausted on arrival can legitimately be re-read as a landmark further down. Motion never exhausts at all.
**Feeds.** Ledger slot 8; the renewal law.

### 7. The accent the author declares against the accent the form produces

**Situation.** A tracker whose author stated in writing that accent #1 belonged to the navigation bar.
**Noticed.** The tab bar is a learned, habitual element; it will be found without help. The day's statistics — the reason the app is opened — sat second.
**Inference.** Read what *is* off the form with the content ignored, then compare it with what the author says *ought* to be. The verdict is only the divergence. Here the divergence is provable rather than tasteful: accent goes to what would otherwise not be found, and spending it on a self-finding element takes it from the block the product exists for. Note the direction — the error is not "too much contrast", it is the peak landing on the wrong block.
**Principle.** Accent goes to what would otherwise not be found, not to what is important in words; a mismatch between the declared and the actual emphasis is a demonstrable error, not a matter of taste.
RU: акцент даётся тому, что иначе не будет найдено, а не тому, что важно на словах; расхождение заявленного и фактического — доказуемая ошибка, а не вкус.
**Counter.** A habitual element that has been moved, restyled or newly introduced is not self-finding yet, and the same peak on it is then correct — paid for, per the mass-solution reading, by a new logic the designer can articulate.
**Feeds.** Ledger slot 8; what ought to be / what is.

### 8. The loop: reading recharges the neighbour that stayed on the carrier

**Situation.** A long-form article with an advertising block in the right column, and a heading the length of a paragraph.
**Noticed.** The eye came off the text towards the block at roughly every paragraph break, not once.
**Inference.** Reading a paragraph is a hard cognitive act, so it triggers the renewal law: charges reset. The competitor did not leave the carrier during the act, so it returns to full charge and competes again — and again, once per paragraph, until the cumulative probability of the break becomes dominant. The cost is not paid once, it accrues per pass. Therefore the operation is removal from the carrier, not dimming: dimming lowers one charge, it does not stop the recharge. Second reading: a heading long enough to be *read* is itself such an act and re-computes the whole screen's palette after it.
**Principle.** Anything that stays in the field of view during a cognitive act is recharged by it and forms a loop; take the competitor off the carrier rather than quietening it.
RU: всё, что остаётся в поле зрения во время когнитивного действия, перезаряжается им и образует петлю; конкурента убирают с носителя, а не приглушают.
**Counter.** A carrier with no renewal events — a one-pass banner, a printed sheet, a screen that is looked at and left — has no loops at all, and this diagnosis is simply inapplicable there. Say so rather than importing it.
**Feeds.** Ledger slot 4 (renewal events); Ledger slot 8.

### 9. The element that never exhausts, and the objection that tests the argument

**Situation.** Two cases. A commerce listing where a saturated action button sat in the first contour of every card, present throughout the scroll. A pinned action button in a mobile product card, defended by an opponent on the grounds that it can be pressed from anywhere.
**Noticed.** In the listing, the button moves with the content and is therefore never left behind. In the second case, the opponent's defence does not survive the standard objection that users mentally filter a static element out as furniture.
**Inference.** What takes accent is not brightness but the impossibility of exhaustion: an element travelling with the scroll renews its status continuously, so it keeps taking charge from the goods the scroll exists to compare, and the user is forced to spend attention filtering it. The same mechanism is what actually justifies the pinned button in the second case — not "it's reachable", but that after every hard cognitive act the block regains first place by charge. The weak argument and the strong argument point at the same button; only one of them survives an objection, and only that one is a model.
**Principle.** Accent is taken by what cannot be exhausted; and a defence that does not survive the objection "the user just filters it out" is a heuristic, not a model.
RU: акцент отбирает то, что не исчерпывается; обоснование, не переживающее возражения «его просто отсечёт», — эвристика, а не модель.
**Counter.** Sometimes the unexhaustible element is the correct accent #1 — where the travelling control *is* what the product exists for, the same permanence is the asset. The question is which block it is taking from, not whether it travels.
**Feeds.** Ledger slot 8; Layer 0 (black box).

### 10. Equals: merging into one spot, and a row collapsing into one unit

**Situation.** Two cases. A top bar where a primary action stood among neighbours of the same charge. A diagram with several large equal shapes and one very small point.
**Noticed.** In the first, the surface gaze skips the whole cluster rather than choosing wrongly inside it. In the second, the small point loses against every arbitrary pair drawn from the large ones — including overlapping sets.
**Inference.** Two different mechanisms with the same look. Equal neighbours defocus into a single spot, and the cure is isolation — space, zoning by function — not more colour, because colour does not un-merge equals. And a row of similar items collapses into one unit of comparison: the small point is no longer competing with an element, it is competing with a block, which is why size alone can never build the hierarchy there. Devaluation inside such a row sets in around the fourth or fifth item (illustration, not a norm), so the count of visible items is limited by the attention left for the last one, not by the grid.
**Principle.** Accent is lost by sticking to an equal neighbour, not by being weak; a row of duplicates collapses into one unit of comparison.
RU: акцент теряется не от слабости элемента, а от слипания с равным соседом; ряд дублей схлопывается в одну единицу сравнения.
**Counter.** A block that is a choice among equivalent options is *correctly* flat, and the work there is separation of equals (эксклюзия), not accent. Before separating anything, check you have not split points that were already equal and could have stayed collapsed.
**Feeds.** Ledger slot 8; gradient shapes 1, 2 and 10.

### 11. An accent colour divided

**Situation.** A landing page where a single distinctive colour appeared in the mark, in a kicker above the heading, and in two different buttons.
**Noticed.** The coloured spots read as one structure spread across the page rather than as one destination.
**Inference.** Accent comes from scarcity on the screen, not from the intensity of the colour. Split the scarce colour across several points and the order of actualisation becomes unpredictable — the ordering has no first step. Concentrating it restores a legible chain (background → heading → action). Where two live actions genuinely coexist (a sticky header detaching), the resolution is a state change that hands the charge from one to the other, not two simultaneous holders.
**Principle.** The accent colour is a scarce resource concentrated on the target action; dividing it dissolves the ordering.
RU: акцентный цвет — дефицитный ресурс, сосредоточенный на целевом действии; дробление растворяет секвенцию.
Proportions quoted in the corpus for this (a dominant field against a small accent share) float between occurrences and are illustrations, not norms.
**Counter.** Where the colour is carrying identity rather than action, its recurrence is the point and the accent has to be built by another instrument. Name which job the colour is doing before deciding whether repetition is a fault; a colour cannot hold two predicates at once — see entry 21.
**Feeds.** Ledger slot 8.

### 12. Flatness attacked at the block count, not at the contrast

**Situation.** The home screen of a product that presented every one of its scenarios at once to a visitor who had not yet signed in, including several stacked modal offers.
**Noticed.** The complaint reads as "everything shouts", which invites a redistribution of weight.
**Inference.** Required hierarchy is a function of how many blocks the scenario actually makes obligatory. Here the count is not a given — the screen contains scenarios that this user segment cannot even act on. So redistributing charge cannot succeed: even a block holding a small share of the accent continues to spend advance. The operation is at the level above: contest the block, move it to the second contour, or collapse it into a row. Only when the obligatory count is genuinely high does the argument move to contrast at all — and then "complex product" is not a defence either.
**Principle.** Low hierarchy on a screen is cured by removing scenarios, not by redistributing weight among them.
RU: низкая иерархичность экрана лечится удалением сценариев, а не перераспределением веса между ними.
**Counter.** Where flatness is forced by content — an objectively long set of equally obligatory blocks, or a menu of equivalent choices — the flat gradient is not the defect, and the derivation moves to separation and to the contour assignment instead. Diagnose which flatness you have before operating; the two take opposite operations.
**Feeds.** Ledger slots 5 and 8; T1.

---

## Sign, mark and graphics — Gate 2, sign column

### 13. Identical structures leave no entry point

**Situation.** A key visual and its matching screen for a seasonal event in a large consumer app: a character, several reward objects, currency, a streak flame, all rendered at the same level of detail and charge; two of the reward objects identical.
**Noticed.** Every object is individually well drawn, and the screen is still skipped whole.
**Inference.** Identical areas collapse into self-similarity and remove the accent from the character without handing it to anything else. Where structures are equal the viewer gets no entry point, so the surface gaze passes over the composition entirely — the failure is at the level of the count of distinct structures and the difference in charge between them, not at the level of execution quality. What the composition needs is one key element plus small secondaries, each with its own exclusivity (эксклюзивность).
**Principle.** The number of structures and the charge difference between them decide more than the quality of the drawing.
RU: число структур и разница их зарядов решают больше, чем качество рисовки.
**Counter.** A deliberately even field is a legitimate strategy when it is a background: low sign-load placed on the background is not a defect. It becomes a defect only when it occupies the plot slot in order to fill empty space.
**Feeds.** Ledger slot 7; `references/sign.md`.

### 14. A device needs an answer, and self-similarity rides on the rule

**Situation.** A wordmark where a sighting-notch cut was made in one letter, then repeated in a second, and a third variant existed with the cut in all three possible letters.
**Noticed.** In the second letter the device is at its most recognisable; in the third the shape of the cut has to change to fit, and the all-three version feels like too much.
**Inference.** A single occurrence would not read as a device at all — it reads as an accent on one letter, which is a different statement. So the second occurrence is what constitutes the device: a device needs an answer. But self-similarity is carried by the recognisability of the *rule*, not by literal identity, and each further occurrence that has to deform the rule adds variance instead of confirming it. The ceiling is set by the complexity of the mark: a simple mark tolerates less variance before the rule stops being read.
**Principle.** A device is constituted by its second occurrence; self-similarity rests on the recognisability of the rule, and the tolerable load is normed by the complexity of the mark.
RU: приём конституируется вторым вхождением; самоподобие держится на узнаваемости правила, а допустимая нагрузка нормируется сложностью знака.
**Counter.** In a mark that is already complex, a third and fourth occurrence stop being variance and start being texture — the same repetition then reads as a system rather than as drift. Symmetry itself is a self-similar structure; load comes from breaking it, not from having it.
**Feeds.** Ledger slot 7.

### 15. The sufficiency point between sign and impression

**Situation.** A product card for a food set. One version showed the full count of items on a plate; another showed two of them large, with a third crossing the edge of the frame.
**Noticed.** In the full-count version nothing is legible; in the reduced version the objects stay large and appetising and the set still reads as a set.
**Inference.** Two loads compete here: transmitting the sign "this is a set" and producing the impression that sells it. Maximising either alone loses. Two objects are the minimum sufficient sign of plurality; the object crossing the edge extends the set past the frame without spending area on it — the invariant part is taken off-frame. What is being computed is a point of sufficiency, not a maximum on one parameter.
**Principle.** Between transmitting the sign and the strength of the impression you look for the point of sufficiency, not the maximum on either.
RU: между трансляцией знака и силой впечатления ищут точку достаточности, а не максимум по одному параметру.
**Counter.** Where the count itself is the value — an inventory, a comparison, a catalogue — reducing it destroys the information, and the derivation runs the other way: keep the count and move the impression to another carrier.
**Feeds.** Ledger slot 7; the sufficiency principle.

### 16. Sign value is measured in this audience, at this moment

**Situation.** A first screen carrying an illustration that a viewer can immediately identify as machine-generated.
**Noticed.** For the audience this page addresses, that visual register is already everywhere in their feed.
**Inference.** Sign-load is defined with the audience inside the definition: how many interpretants *this* audience reads unambiguously, and what affective response they give. Here the response is not neutral — the register has been tagged with a meaning the brief did not want (low budget), so the graphic carries a sign, just not the intended one. For a different audience the same graphic still transmits. The verdict is therefore not about execution quality and cannot be improved by rendering it better.
**Principle.** The value of a sign is set by how worn it is in the environment of this particular audience, not by the quality of its execution.
RU: стоимость знака задаётся его затёртостью в среде конкретной аудитории, а не качеством исполнения.
**Counter.** For an element that must be *found* by someone already looking for it, the mass register is the correct choice and its familiarity is the asset; the register only dies where the element must intercept a gaze looking for something else. The mass-solution criterion is a reconstruction from the author's account of banner blindness and is not stated anywhere in one sentence — see `references/limits.md`.
**Feeds.** Ledger slot 7.

### 17. An unresolved contradiction, kept unresolved: mark against identity

**Situation.** A minimal, plot-free mark for a delivery business, discussed against the observation that large companies generally strip narrative out of their marks.
**Noticed.** From a distance the shape does not resolve, and the association with the business's field does not arise without the name beside it.
**Inference.** Two of the author's own positions collide here and he does not reconcile them. One: if large companies empirically remove narrative from the mark, narrative has been delegated to the wider identity, so a bare mark is correct and it only has to inform about the name. The other, run through the remove-the-mark test: if a graphic needs the wordmark in order to mean anything, its recognisability has been delegated away and it is a bet, not an asset — and elsewhere he uses that same test to deny recognisability to elaborate graphics rather than to bare ones. Both readings are in the corpus. Do not collapse them into a rule.
**Principle.** Where the model contradicts itself, mark the fork and state which branch your Ledger takes and why; a contradiction resolved by preference is not a derivation.
RU: там, где модель противоречит себе, фиксируй развилку и называй ветку, которую берёт твой Ledger; противоречие, снятое предпочтением, — не вывод.
**Counter.** The fork is decided in your brief by slot 2: if an affect carrier already exists outside the mark, the bare mark costs nothing; if the mark is the only carrier, the bet is real and has to be named as a bet.
**Feeds.** Ledger slots 2 and 7; `references/limits.md` (open tensions).

---

## Operations on an existing layout

### 18. Duplication against a legend, and duplication as insurance

**Situation.** Three cases. A grid of time slots whose availability was explained by a legend outside the grid. A calendar where the currency symbol was stated once, away from the numbers. A game screen where the author had repeated two status values in a second block.
**Noticed.** In the first two, the eye travels between the cell and the key. In the third, the author's own reason for the repeat was fear that the user would not look in the right place.
**Inference.** Duplication is an operation on accent, not on information, so its cost appears only if the duplicate has to be *noticed* or *read*. A repeated unit inside a cell the eye is already standing in costs approximately nothing; the legend, by contrast, charges a loop on every single pass, and loop cost accrues while duplication cost decays into self-similarity. So the composite cell wins, and the legend is justified only where the value physically cannot be written into the object — genuine cartographic density. The third case is different in kind: a duplicate placed so the user will not miss something is the designer's own uncertainty transferred into the layout and paid for in hierarchy. The threshold is stated: once more than one field has to be duplicated, the gain is over.
**Principle.** Connectedness of an entity is worth more than cleanliness; a legend is justified only where a caption cannot be written into the object, and insurance duplication is paid for out of hierarchy.
RU: связность сущности дороже чистоты; легенда оправдана только там, где подпись нельзя вписать в объект, а страховочный дубль оплачивается иерархией.
**Counter.** Above the threshold — several fields, a dense matrix — the duplicates themselves become a row that collapses into self-similarity and the legend becomes the cheaper instrument. Compute the threshold; do not remember it.
**Feeds.** T7; `references/charges.md`.

### 19. An icon standing beside the word it repeats

**Situation.** A settings-style list where each row carried an icon next to a label naming the same thing, plus a chevron on every tappable row.
**Noticed.** Both the icon and the chevron restate something already stated — by the label, and by the platform's own convention.
**Inference.** First check whether it is a duplicate at all: an icon that distinguishes neighbours in a row, or a label carrying its own information, are not duplicates and both stay. Where it genuinely is a duplicate, what decides is whether *this* audience already has a cost-free sign-to-meaning link — a universal cliché, or an imperative product used daily. Where they do not (games, free exit, a steady inflow of newcomers, domain pictograms) the duplicating logic does not help perception; it takes charge from the logic that is not duplicated. Removing them and enlarging the text produces a stronger layout with no new element added.
**Principle.** Duplicating logic does not assist perception — it takes accent from the logic that does not duplicate.
RU: дублирующая логика не помогает восприятию — она отбирает акцент у той, что не дублируется.
**Counter.** Where both text and icon are learned, remove whichever one pulls accent off the key formulation; and removing text "so they will learn it later" is not permitted — the amnesty of imperativeness covers costs paid once during learning, never costs paid on every pass.
**Feeds.** T8; T6.

### 20. De-energising instead of deleting

**Situation.** An in-vehicle control screen where a large, highly detailed rendering of the vehicle occupied a third to a half of the area while serving, functionally, about three controls.
**Noticed.** The object is simultaneously the most detailed and the most charged thing on a screen whose controls the driver will learn regardless — and it is also what carries the transitions and the strategic view of the automated modes.
**Inference.** The interface is imperative and used daily, so the visual key does not pay for its area and it crowds out alerts. But deleting it destroys a second function that nothing else carries. When an element is needed for one reason and harmful for another, the operation is neither keep nor delete: lower its charge — outline, monochrome, reduced detail — so it stays available to the function that needs it and stops competing for the peak.
**Principle.** When an element is needed for one reason and harmful for another, de-energise it rather than cutting it.
RU: когда элемент нужен по одной причине и вреден по другой, обесточивай его, а не вырезай.
**Counter.** De-energising is illegitimate when the element's whole value is its charge — an affect carrier on a dedicated screen. Then the fork is keep or remove, and de-energising produces the layer that a legal layer must never become: so weak that removing it would change nothing.
**Feeds.** `references/charges.md`; Gate 3's second prohibition.

### 21. Criticality sets the contour, and colour has a predicate already

**Situation.** Two cases from combat interfaces. Information that decides the outcome of a fight for the whole team, placed in a corner and revealed only on a held key. A spectator scoreboard for several players, where a sub-block could not be attributed to its owner, and the proposed fix was to tint the icons with each player's colour.
**Noticed.** In the first, depth of placement runs inverse to criticality. In the second, the two colours available for tinting are already carrying state.
**Inference.** Contour assignment is derived from the degree of importance of the information: the higher the cost of missing a datum, the closer it must be to the contour that reads without any action. And there is a second, independent constraint: module positions are learned in a calm state and used under stress, so a placement that is fine while exploring can be wrong in the only moment it matters. In the scoreboard case, the failure is a missing visible carrier of ownership, not crowding — and colour cannot supply it while its predicate is occupied. Before loading a colour with a new function, inventory the functions it already has; restore the ownership link through a property of an element already present.
**Principle.** Criticality sets the contour; and before loading colour with a new function, take stock of the duties it already holds.
RU: критичность задаёт контур; прежде чем нагружать цвет новой функцией, проведи инвентаризацию его нынешних обязанностей.
**Counter.** Reference knowledge that does not decide anything in the moment moves the other way — out to on-demand — and what stays on screen is what produces the impression. Both moves are the same criterion read in opposite directions.
**Feeds.** Ledger slots 3 and 4; colour as a code.

### 22. When business and user diverge, move the scenario rather than degrade the layout

**Situation.** A pre-match lobby with a block of consumable boosters. A single "activate all" control is convenient for the player and shortens the paid session; stacking them triggered a prohibiting dialog.
**Noticed.** The convenient control and the business interest point in opposite directions, and the current compromise is an interruption that punishes the user for using the product correctly.
**Inference.** The choice is not between a good layout and a good business outcome. Split the first contour so it shows one active item and the list of inactive types, and the deep, less convenient path stays reachable in the inventory. The retention effect is obtained by depth of placement, and the prohibiting dialog disappears because the state that produced it is now localised where the user is deliberate. Depth is the instrument; degrading legibility is not.
**Principle.** Where the user's interest and the business's diverge, move the inconvenient scenario deeper while keeping it reachable, instead of making the interface worse.
RU: когда интересы юзера и бизнеса расходятся, сдвигай неудобный сценарий вглубь, оставляя доступным, а не ухудшай интерфейс.
**Counter.** Where the inconvenient scenario is one the user is entitled to reach without friction — cancelling, exporting, refusing consent — depth is the degradation, and the divergence has to be resolved outside the layout. Friction belongs immediately before the point where the user is already up against the value, nowhere else.
**Feeds.** Ledger slots 3 and 6.

---

## Surface and accuracy — Gate 3

### 23. The nesting budget, and what to do when it runs out

**Situation.** Three cases in one product family. An early sketch of a clinical information system in which every group sat on its own plate. The current version of the same patient card, built with no plates at all. A game screen where highlighted list items received a plate inside the plate of the block containing them.
**Noticed.** In the sketch, putting the large groups on plates immediately obliges the header and the date inside them to get plates too. In the plate-free version, the hierarchy comes from a large heading offset outside the content edge, high contrast on values and lowered contrast on labels. In the game screen, nesting has reached a third level.
**Inference.** Build the future before adding a substrate: ask how many more substrates this one obliges you to add. Past two levels the eye stops distinguishing the steps, the child's belonging to its parent is lost, and when everything is plated nothing is accented — a screen fully filled has no accent structure left. When the nesting budget is spent, change the instrument of separation (contrast, spacing, a rule, colour) instead of adding another layer. The plate-free version is the demonstration: hierarchy set by contrast and size replaces frames and does it more precisely, because significant dark elements spaced apart form supports the eye jumps between while labels fall into the background.
**Principle.** Nesting depth is a hard budget — two levels of card nesting is the confirmed limit, and the extension of that ceiling to plates and substrates generally is this skill's analogy, not the corpus's; once the budget is spent you change the instrument of separation rather than adding a layer.
RU: глубина вложенности — жёсткий бюджет: подтверждены два уровня карточек; распространение на плашки — расширение этого скилла.
**Counter.** A substrate is legal when the composition genuinely does not hold without it — but then it must be stylised, it must not duplicate a separation that already exists, and it must not be so weak that removing it changes nothing. Test in the maximum configuration, here and now: separators that are harmless at the minimum become noise at the maximum.
**Feeds.** T3; T4; `references/limits.md` (nesting limit).

### 24. A violation that is only apparent

**Situation.** A layout where the space from the last block to the edge of the screen was smaller than the space between two blocks; a reviewer called the spacing progression broken.
**Noticed.** Formally the progression is violated. Nothing sits on the far side of that edge.
**Inference.** Test the rule against the definition of the entity that generated it. Spacing exists to separate a block from a block; at the edge there is nothing to separate from, so the rule is not in force and the violation is only apparent. This is the general shape of the move: a rule is admissible in an argument only where the entity it was derived from is present. It is also one of the three and only three grounds on which the progression may legally be broken; a fourth ground is invention.
**Principle.** A rule is checked through the definition of the entity that produced it; where that entity is absent, the rule does not apply and its violation is apparent only.
RU: правило проверяют через определение сущности, породившей это правило; там, где сущности нет, правило не действует.
**Counter.** The same reasoning bans the convenient inverse: if you cannot name which entity generates the rule you are breaking, you are not breaking it knowingly, you are drifting. Count by eye, not by ruler; multiples of four and eight are a guest's criterion the author disputes (forbidden — see `references/limits.md`).
**Feeds.** T4; Layer 0 (derivability).

### 25. A difference below the threshold of being noticed

**Situation.** Highlights on a control: their angles differed slightly, their spacings were nearly but not quite equal, their thicknesses recurred.
**Noticed.** Viewers report discomfort and cannot name its cause.
**Inference.** Perception has to decide whether to group these or to separate them, and a difference in the intermediate zone supports neither decision. Either the difference is below the threshold of noticing — then make them identical and let them group — or it is explicit — then it separates and does its work. The middle is the defect, and because it is unnameable it gets misdiagnosed as taste. Counting the visual rules in play is the measure of how far out of sync the surface is.
**Principle.** A difference is either below the threshold of noticing or explicit; the intermediate zone is where unnameable discomfort is manufactured.
RU: различие либо ниже порога заметности, либо явное; промежуток — источник неназываемого дискомфорта.
**Counter.** Deliberate near-repetition is legitimate where the near-miss is itself the content — a break in symmetry that carries load. The test is whether you can say what the difference does; if you can, it is explicit by definition.
**Feeds.** Gate 3; the visual-rules counter.

### 26. Comparable costs are decided by consistency

**Situation.** Unavailable time slots in a picker. Removing them leaves a gap that reads ambiguously — absence, or the user's own mistake. Greying them keeps the sequence intact but a dead plate still pulls charge for something the user cannot act on.
**Noticed.** The two options cost approximately the same, and no measurement is available to separate them.
**Inference.** Where the costs of the variants are comparable and no metric exists, the deciding criterion is consistency with decisions the system has already made — here, that past dates are already hidden rather than disabled. Consistency fills the verification vacuum: it is a real argument, not a fallback, because an inconsistent system charges the user a rule-learning cost on every screen. Note what it is not: it is not "cleaner". If the change cannot alter group membership, contour assignment or the accent palette, name it accuracy (аккуратность) out loud and put it on the atemporal account instead of dressing it as speed.
**Principle.** When variant costs are comparable, the system's own consistency decides; when the change cannot move membership or accent, call it accuracy rather than speed.
RU: при сопоставимых ценах вариантов решает согласованность системы с собой; правку, не меняющую принадлежность и акценты, называй аккуратностью, а не скоростью.
**Counter.** Consistency loses the moment a variant does change group membership or lets data merge into a foreign group — that is critical, and it is argued through time, with the measurement that a time claim owes.
**Feeds.** T12; Layer 0.

---

## Arguments about design — Layer 0

### 27. Test an aesthetic criterion at its limit

**Situation.** A defence of a layout resting on a general formula: beauty as balance of the composition.
**Noticed.** Balance, taken literally, means equal charges.
**Inference.** Push the criterion to its limit and see what it produces there. Perfect compliance yields a layout with equal accents everywhere — which is precisely the flat gradient the same critic would reject, and the effect they actually admire comes from disproportion. A criterion whose limiting case produces nothing is not a criterion; it is a reified word that has to be operationalised into something that changes a decision, or dropped.
**Principle.** Test an aesthetic criterion at its limit: if the limit yields emptiness, the criterion is wrong.
RU: проверяй эстетический критерий на пределе: если предел даёт пустоту, критерий неверен.
**Counter.** The same test protects criteria that survive it: run it before discarding a soft word, because some of them operationalise cleanly and then become usable. A foreign term applied inside its own field usually deserves the verdict "not applicable here", not "empty word".
**Feeds.** Layer 0 (soft word); T10.

### 28. A verdict must be a function of enumerable properties

**Situation.** Two layouts scored far apart by the same external reviewer, sharing a useless outline, an identically over-contrasted action in the first contour, and a comparable hierarchy.
**Noticed.** The spread in the scores cannot be derived from any property either layout has or lacks.
**Inference.** If two objects share the properties a verdict claims to rest on and still receive opposite verdicts, the verdict is not a function of those properties — the reviewer is measuring impression and narrating it as assessment. This is the test to apply to your own output as well: state the interval or the pair of blocks the verdict came from, and if you cannot, you have produced taste with vocabulary on top. The self-check for the same failure inside a single layout is substitution: swap in different content of the same size; if the weighting is unchanged the complaint is structural, if it changed you are judging semantically and owe the value you derive it from.
**Principle.** A verdict must be a function of enumerable properties, otherwise it is inductive taste; a property that depends on the content substituted into it cannot ground a compositional decision.
RU: вердикт обязан быть функцией перечислимых свойств, иначе это вкусовая индукция; свойство, зависящее от подставляемого содержимого, не может быть основанием композиционного решения.
**Counter.** An intuition that fired is not disqualified — it is unfinished. Formalise it: name the difference, say how it acts, and only then apply it. What is rejected is the unreflected feeling, not the feeling.
**Feeds.** Layer 0; T13-B.

### 29. Hermeneutics sells the layout and does not generate it

**Situation.** An identity presentation justifying a mark through a count of round letterforms in the name and through the merging of two geographic outlines.
**Noticed.** Every justification is derived backwards, from properties the form happened to have.
**Inference.** None of these accounts could have produced the form; each was fitted to it afterwards. That does not make them useless — they give a decision weight in a defence — but it does make them a rhetorical frame rather than a model, and the discipline is to call it by its name. The operational consequence is direct: a Ledger written to justify a drawing that already exists is layout hermeneutics (герменевтика макета). Discard it and re-derive; never edit it into shape.
**Principle.** Hermeneutics is useful for handing a project over and generates no form; name it for what it is, and never write a derivation backwards from a drawing.
RU: герменевтика полезна при сдаче проекта и формы не порождает; называй её своим именем и никогда не пиши вывод задним числом от готовой рисовки.
**Counter.** Retroactive frame-building is legal as *entry*: in most live critique the reasoning starts from whatever first catches the eye and the frame is reconstructed afterwards. What is forbidden is leaving it silent and unfalsifiable. Write the frame down, and let it be capable of overturning the drawing that prompted it.
**Feeds.** Layer 0; the entry-is-free / commitment-is-gated rule in SKILL.md.

# Canonical banked mule delivery

## Contract and generation

`speedrun/helpers/mule-itinerary.ts` is the shared helper/runner authority for
delivery geometry. `muleDelivery(row, options?)` returns
`{row, at: {x,z,level}, bank: {x,z,level}}`; `muleItinerary(rows, options?)`
selects a nonempty, unique ordered list. Unknown rows fail closed. The runner
must use the same binding for its readiness check, not a second coordinate map.

`muleRunOptions(ledger, cueRoot, {deliveryRun, serve, itinerary?})` builds complete
runtime options from `muleFromLedger` output and validates them through
`muleOptions`. Both the unique-per-attempt run token and receiver are required.
The generator cannot prove global uniqueness: the launcher must mint a new
token for every attempt. It does not emit `final:true`; completion is the
session-bound engine's responsibility. Every package has an explicit meeting
tile and staging bank, including planes. No bank or meeting point falls back to
Varrock. Notes, fixed amounts, top-up maxima, scopes and on-request status
remain the supplied ledger's. `materializeDeliveryPackage` resolves each name
against the shared content metadata in `lib/items.ts`, requiring exactly one
tradeable object identity. Ambiguous or unknown names require an explicit ledger
`@ID`; the current bank contents never select a variant. Generated delivery
options contain numeric IDs, and runtime delivery rejects name-only or
untradeable lines before staging. Stock validation uses this same boundary.
The observed inventory must match the withdrawal plan's IDs, forms and full
counts before readiness; successful withdrawal acknowledgements alone do not
prove staging.

```sh
bun speedrun/helpers/mule-ledger.ts --rows H1,H4,H4k --on-request '' --delivery-run attempt-unique-token --serve RECEIVER --cue-root /run/cues
bun speedrun/helpers/mule-ledger.ts --rows H1,H4,H4k --on-request '' --check /private/mule-options.json --delivery-run attempt-unique-token --serve RECEIVER --cue-root /run/cues
```

`--rows`, `--on-request`, `--manifest` and `--form ask|fixed` retain their
existing meanings. Runtime `--check` compares the run, receiver, cue directory,
all ledger items, and exact canonical `at` and `bank` coordinates and planes.
A bare package array remains an item/stock-only comparison, not a launch verdict.
Programmatic `muleDrift` accepts `{delivery: {deliveryRun, serve, itinerary?}}`
to enforce the expected attempt and rehearsal geometry; runtime options with
delivery fields are also checked without this argument.

### Persisted production lab artifact

[`mule-delivery-production.json`](../research/mule-delivery-production.json)
contains the actual generated production selection: 19 ordered rows plus
conditional H4e, partitioned between mule1 east, h55 west and the separately
prepositioned H20-only h03. H3 stays with the
production ring givers; H4m is explicitly excluded from attempt 1. The file records
the source revision, manifest hash, stable lab run token, anonymous lab receiver
and cue root. The regression test reads that persisted file and compares it with
fresh generator output, including exact items, locations, planes, carry metadata,
account coverage and absence of terminal flags.

The artifact now contains numeric object identities generated from the
owner-authorized [lab ledger projection](../research/mule-delivery-ledger.md).
Its [provenance](../research/mule-delivery-ledger.provenance.json) records the
original manifest revision/hash and exact owner-approved ordinary-item IDs and
H21d hammer-only correction. The protected production manifest is not silently
rewritten. Artifact tests hash that explicit projection rather than pretending
it is the default production source.

The artifact is explicitly **blocked for full-route acceptance**: H13 still
requires the shared explicit-drop dependency and corrected receiver fixture,
and the approved H20-only h03 configuration still needs its profiled route,
long-idle health/readiness and row-stop logout proof. The previous H19/H20
same-carrier assignment failed the pre-T23-24 gate and is not used by this
configuration. Numeric package validity does not resolve these launch gates.

This is a **lab-only configuration artifact**, not an installed run-host
configuration or proof of bank stock. Live receiver binding, private credentials,
staging, profile checks and authorization remain separate. Regenerate it after
canonical ledger changes rather than editing item quantities by hand.

### Rehearsal is explicit, not a production reassignment

Production H3 remains the three ring givers' responsibility and is absent from
`MULE1_ORDER`. The rehearsal planner owns the approved manifest overlay through
`applyLedgerSubs(manifest, subs.ledger)` in `speedrun/lab/twin-rehearsal.ts`.
Pass that transformed text to `muleFromLedger` with an explicit row selection,
then supply `itinerary: {rehearsal: {firemakingEnd}}` when generating options.
The end must come from that run's canonical firemaking geometry, with an explicit
plane. Missing geometry is rejected; neither the historical coop row nor the
rehearsal's current endpoint is hardcoded.

The CLI equivalent is
`--rehearsal-firemaking-end '{"x":3223,"z":3219,"level":0}'`, but the caller must
derive those values from its own selected geometry. H3 rune substitution and the
approved H7 amulet omission belong in the explicit rehearsal overlay, never in
the production generator. The full H7 kit remains in unmodified production
output. The rehearsal owner's actual sanitized artifacts are archived in
[rs496 comment 5](cairn://p/rs/496/comments/5) and its supplied GIVE-ledger in
[comment 6](cairn://p/rs/496/comments/6). They contain all ten selected delivery
rows, including H7's remaining kit, but predate numeric-ID materialization and
must be regenerated before current runtime use. They are not deployed configs.

That overlay changes given packages, not the full step-effect ledger. S04 still
records ring consumption, S07 still drops the original axe, and T11-12 still
drops the omitted potion. The full rehearsal inventory walk therefore remains
unresolved. Variable spell consumption must come from actual runtime effects
or observed censuses, not invented counts to make the fixture pass.

## Travel and trade initiation

Delivery walks use the existing `lib/passages.ts` topology and crossing driver
before the final exact-tile walk. This includes the Gnome Stronghold gate on
both the bank-to-H8/H12 route and the return journey. Crossing inputs use the
scanned object option, bounded retries and existing dialogue handling.
Cancellation and death are checked around awaited scans, walks, inputs and
tick waits. A dispatch acknowledgement is not arrival: readiness still requires
the observed exact meeting tile and a subsequent fresh observation.

A ready helper must not chase the recipient. Delivery-only pre-requests and
reciprocal requests require a non-overlapping cardinal neighbour that the
canonical entity-side collision predicate can already reach. Known unreachable
players and masked-door vicinity are conservatively refused. The ordinary
receiver interaction is unchanged. This avoids overlapping bilateral trade
requests moving either trader unpredictably; it does not widen readiness,
relocate the rendezvous or add a scored walking step.

The helper rechecks cue authorization, preparation cancellation, observation
freshness and its exact stand before requesting. Existing carried and generic
banked serving retain their previous trade initiation behavior.

## Authority and coordinate differences

The hand-off authority is SUPPLIES section 1. Integrated placement was checked
against `runner/chain.ts` at `94edf68907dd4476df68bf894e180710f8512745`
(the integrated run branch, not main). Coordinates reuse `runner/legs.ts`
`TILES`, the Plague City exported `ARRIVAL`, the Thieving stun-pack anchor,
and the teleport landing definition. Staging bank coordinates come only from
`helpers/questitems.ts`'s exported ground-level `BANKS` roster.

- H4: helper exactly (2951,3451), one tile west of the leg centre
  (2952,3451), within its tolerance 1.
- H4k: helper exactly **(2911,3494,0)**, southwest of the unchanged receiving
  area `(2912,3495,tol:1)`. The centre contains tree 1278; the southwest stand
  was reached in the lab and explicitly approved by the route owner. Exact
  readiness is not widened to make a blocked centre pass.
- H6: Edmond (2568,3334), confirmed by Plague City's arrival export and the
  integrated H6-before-S08 placement after T07-08. Not Camelot's teleport tile.
- H9, H10 and H13: helper exactly (2658,3301), west of the Ardougne landing
  spread. The proposed S16 cellar relocation is not approved and is not used.
- H14: (2670,3305), the actual stun-pack anchor, not the older leg's knight
  centre (2655,3305). Courier top-ups are separate from this load-zero swap.
- H22: helper exactly SUPPLIES' (3191,3363), one south of the leg/quest arrival
  (3191,3364), within leg tolerance 1 and the quest's outside area. The parent
  confirmed the SUPPLIES helper tile.
- H4m: the explicitly documented overflow meeting point (2605,3234), not the
  ordinary H4p arrival (2604,3235).

These are exact readiness locations, not proof that every tile is reachable by
the assigned account or that adjacent trades succeed on the current engine.

H13 also has an independent tradeability gate: the Khazard helmet and platemail
cannot be traded. The ledger's H13 row drops them on the tile (`drop` outputs,
#470), and drops never become helper take-backs, stock credits or trade offers.
With that grammar and its recipient fixture in place, H13 readiness and its
exact trade pass mechanically at the current landing (route table below). The
monkey greegree is held, not worn, at H13: the engine wrenches it into the pack
when its wearer leaves the greegree zone (`quest_mm/scripts/mm_greegree.rs2`),
so the lab fixture stages it in SCORED's before-inventory
(`speedrun/lab/mule-delivery-fixtures.ts`). This does not authorize moving its
rendezvous.

## Full row audit and feasibility gate

All tiles below are plane **0**, including every staging bank. **E** and **W**
are east- and west-resident carrier roles. The coordinator approved mule1 east
(or mule2 east for rehearsal) and h55 west **for generated configurations and lab
validation only**. **E20** is the H20-only h03 carrier, also approved for
configuration/lab only, logged in before SCORED and prepared during S22.
Live assignment, staging and login remain gated on observed
profiles, prerequisites, stock and route evidence. **R** is the explicit
rehearsal giver assignment. **Ordered** rows are staged in
selected order after the previous delivery finishes; the departure column gives
the planning trigger, not a claim that the scored runner already emits it.
Conditional rows need explicit preparation early enough to stage and travel;
a request first sent at arrival is not a timing proof.

**U** in the route column means the full previous-meeting → bank deposit and
withdrawal → next-meeting duration is **unmeasured** for the real carrier.
**Pending** readiness means no session-bound live ready snapshot or end-to-end
proof was established by this generator audit. Every row requires the engine's
fresh matching run/row/receiver, inventory-ready and exact-tile/plane status,
with bank, trade and travel inactive. Green generator tests are not that proof.

| Row | Account / mode | Helper tile | Staging bank | Departure trigger and available scored window | Full route duration | Readiness evidence |
|---|---|---|---|---|---|---|
| H1 | E ordered | 3222,3222 | Draynor 3092,3245 | Prepare before scored login; login gated on readiness | 97 ticks from bank start to ready in lab | Mechanical pass, exact ready + trade; minimum HP 7, not a survival guarantee |
| H4 | E ordered | 2951,3451 | Falador west 2946,3369 | After H1; S02–S04, intended staging during S03–S04 | H1 success to exact ready: 264 / 308 ticks (a third run, 331, during a host load spike); the spread is mule1's Lumbridge→Falador route, 378–477 tiles (rs/658, 2026-10-24, bgsrv-ub 400 ms, 21144552, 2 clean runs) | Exact ready and the 20-ring trade passed mechanically; Draynor jail guards hit mule1 on the H1 approach (HP 8–9), back to 10 by H4; scored deadline pending |
| H4k | E ordered | 2911,3494 | Falador west 2946,3369 | After H4; readiness gate BEFORE T06-07, conservative 132 ticks; 206 is later arrival, not the gate | Carry-ahead 44 ticks; bank-return baseline 132 ticks | Exact ready + canonical-area receiver trade passed mechanically; paired scored gate still unmeasured |
| H6 | W ordered | 2568,3334 | Ardougne north 2615,3333 | Preposition west before run; prepare during S07, gate before T07-08 | Initial bank-to-ready 77 ticks; default mountain crossing rejected | Canonical trade passed in uninterrupted western prefix; actual h55 profile |
| H4p | W ordered | 2604,3235 | Ardougne south 2654,3283 | After H6; during S08, gate before T08-09 (the leg's 50 ticks are not preparation allowance) | 100 ticks to ready | Canonical trade passed mechanically; paired scored gate pending |
| H7 | W ordered | 2504,3191 | Ardougne south 2654,3283 | After H4p; during S09, gate before T09-10 | 145 ticks to ready | Canonical trade passed mechanically; paired scored gate pending |
| H8 | W ordered | 2465,3489 | Ardougne north 2615,3333 | After H7; during S10b, gate before T11a; later approach time is excluded | 280 ticks to ready via bank and Stronghold gate | Exact ready and trade passed; reverse gate and final bank passed; prefix minimum HP 88 |
| H9 | W ordered | 2658,3301 | Ardougne south 2654,3283 | After H8; during S11b, gate before T11-12a | 235 ticks via return gate and bank | Exact readiness and real trade passed mechanically |
| H10 | W ordered | 2658,3301 | Ardougne south 2654,3283 | After H9; during S12, gate before T12-13a | 61 ticks | Exact readiness and three-shark top-up passed mechanically |
| H12 | W ordered | 2465,3489 | Ardougne north 2615,3333 | After H10; S13/S14, gate before receiving leg T14-15 | 208 ticks with canonical gate traversal | Exact readiness, seven-shark top-up and returns passed; helper and recipient peak 28 slots |
| H13 | W ordered | 2658,3301 | Ardougne south 2654,3283 | After H12; during S15, gate before T15-16a | H12 success to exact ready: 245 / 245 ticks via the Stronghold-gate road and bank (rs/658, 2026-10-24, bgsrv-ub 400 ms, 96a3d599, 2 runs) | Exact ready and #470 drop-mode trade passed (Khazard pieces dropped, not returned; greegree held; `shark to 2` top-up served); HP 90; scored deadline pending |
| H14 | W ordered | 2670,3305 | Ardougne south 2654,3283 | After H13; during S16, gate before T16-18 | H13 success to exact ready: 81 / 81 ticks (rs/658, 2026-10-24, bgsrv-ub 400 ms, 96a3d599, 2 runs) | Exact ready and trade passed (knife returned); HP 90; scored deadline pending |
| H15 | W ordered | 2716,3302 | Ardougne south 2654,3283 | After H14; during S18, gate before T18-19 | H14 success to exact ready: 82 / 82 ticks (rs/658, 2026-10-24, bgsrv-ub 400 ms, 38db295e, 2 runs) | Exact ready and trade passed with the walked returns; HP 90; scored deadline pending |
| H16 | W ordered | 2820,3486 | Seers 2725,3491 | After H15; during S19, gate before T19-20; continuous window unmeasured | H15 success to exact ready: 172 ticks via Seers, observed h55 profile, in all five runs (rs/551 ×2 bgsrv-mac; rs/658 ×3 bgsrv-ub 400 ms, 38db295e, 2026-10-24) | Overlapping-request baseline preserved; guarded repeat and three further trades passed without helper displacement; scored deadline acceptance pending |
| H18 | E ordered | 3241,3248 | Draynor 3092,3245 | East carrier prepares after H4k/selected H4e, during S20/S21 at latest; gate before T21-22 | H4k success to exact ready: 318 / 318 ticks via Draynor (rs/658, 2026-10-24, bgsrv-ub 400 ms, 96a3d599, 2 clean runs; agrees with a spike-time 318); no western return assigned | Exact ready and trade passed; **Draynor jail guards (NPC 917, aggressive, huntrange 5) hit mule1 at (3120–3129,3250–3254)**: ready at HP 7 in one run, HP 5 on the walk back in both; scored deadline pending |
| H19 | E ordered | 3209,3215 | Draynor 3092,3245 | After H18; during S22, gate before T22-23 | Initial Draynor-to-ready 110 ticks; H18 transition still U | Initial bank preparation and trade passed; minimum HP 8, no paired scored gate |
| H20 | E20 h03, single ordered row; config/lab only | 3045,3257 | Draynor 3092,3245 | Log in before SCORED; prepare during S22, gate before T23-24 | Profiled h03 route unmeasured; old H19 predecessor took 147 ticks versus 12 allowed | Independent preparation, over-ten-minute idle health/readiness and row-stop logout pending |
| H21d | E ordered | 3185,3436 | Varrock west 3185,3436 | After this carrier's H19; S24 plus S25a window before S25d | Planned H19 predecessor U; old H20 predecessor measured 174 ticks | Real 17-stack delivery and hammer-only return passed; no platebody seed; planned carrier transition still pending |
| H22 | E ordered | 3191,3363 | Varrock west 3185,3436 | After H21d; remaining S25, gate before T25-26 | H21d success to exact ready: 88 / 88 ticks at this stand (rs/658, 2026-10-24, bgsrv-ub 400 ms, 38db295e, 2 runs); **68 / 68 / 68 ticks at the ruled stand (3191,3366)** (bgsrv-mac 400 ms, lab-only patch on 24bb891c, 3 runs) | **Trade refused at this stand in both runs:** (3191,3363) is the Champions' Guild door tile and SCORED's T25-26 target (3191,3364) is beside it, so the delivery door guard (`findDoorsAlongPath`, endpoint plus cardinal neighbours) refuses. The ruled pair, SCORED (3191,3365) tol 0 with the carrier at championsGuild z+1 (3191,3366), passed 3 of 3: SCORED arrived on (3191,3365) each time in 42 ticks, and the trade opened 9–10 ticks later and completed exactly; rs/667 commits the pair |
| H4e | E conditional | 2920,3406 | Falador west 2946,3369 | Explicit fallback preparation before S07 ends; east carrier only, with a separately prepared western H6 | U; fallback trade 4 scored ticks measured, not a delivery-route duration | Pending |
| H4m | W conditional audit only; excluded from attempt 1 | 2605,3234 | Ardougne south 2654,3283 | No implemented receiving window; attempt 1 uses the approved stock-only overflow fix instead | U; no same-arrival trip assumed | Retained for audit; no invented attempt-1 trigger |
| H3 | R rehearsal only | supplied canonical firemaking end | Draynor 3092,3245 | Explicit rehearsal selection; prepare during S03, ready before substitute S04 | U; geometry-dependent | Pending |

### What this audit does and does not establish

The approximately 206-tick H4→H4k arrival window includes T06-07 and therefore
cannot justify the readiness gate **before** that leg. The conservative pre-leg
window is approximately 132 ticks, pending integrated-runner measurement. This
is a mixed-source estimate (Doric remainder 6 + 5, leg 61, Runecraft 60), not a
guaranteed lower bound. Browser leg measurements give a different sum. The
bank-return lab met 132 exactly with zero margin, which is not enough to claim
robust scored readiness.
Canonical carry-ahead subsequently reached fresh H4k readiness in **44 ticks**,
including 42 ticks of direct travel and two observation/control ticks. It retained
20 returned rings plus the exact three-item next kit, with no intervening bank.
That leaves 88 ticks against the 132 model, not a measured scored deadline.
A receiver that waits for readiness in a lab proves mechanics, not on-time scored
arrival. H19→H20 has a **hard conflict with the current pre-T23-24 gate**.
The integrated chain places H19 immediately before Cook's Assistant, whose
browser-accepted duration is 12 ticks. The two meeting tiles differ by 164
tiles on their longest axis: even an unobstructed run at two tiles per tick
needs at least 82 ticks, before banking or observation overhead. Carry-ahead
cannot repair this bound. The measured banked transition took 147 ticks.
T23-24's later travel time must not be counted toward a gate before that leg.

H20 therefore needs a carrier independently prepositioned while the H19 giver
stays in Lumbridge. The approved configuration/lab plan assigns H20 alone to
h03, preserving H18 and H19 as separate canonical hand-offs. Its launcher entry
uses `stopOn: {step: 'H20', family: 'mule'}`, no arrival-triggered login and no
entry `final: true`. A terminal H20 cue closes that account's scope and invokes
the existing logout path. The chosen-address plan adds one login before SCORED:
25 initially and 26 at S21, plus the optional R8 reserve. Live assignment remains
unauthorized until the full gates pass. No third-account lower bound is claimed
globally. The old H20→H21d route measured 174 ticks, but the new eastern assignment
needs H19→H21d measured instead; S25a's smithing window remains available.

The observed eastern mule profiles have Magic 1 and Hitpoints 10, with no gear.
No teleport spell, protection prayer, quest shortcut or scored-account travel time
is assumed available to them. `lib/kandarin.ts` records repeated
10-HP deaths crossing White Wolf Mountain even running with retaliation off.
Therefore H4k→H6 and the later return east need a measured safe route or an
explicitly authorized prepositioned carrier; a coordinate binding alone cannot
make those routes safe. Ship fares, quest access, food, gear and staging
inventory capacity must be measured/approved rather than silently added.

The standalone carried H12o helper (h45 in the deployed roster) keeps its own
bank-free lifecycle and two atoll meeting points. It is not assigned to this
banked itinerary and the generator does not change it. H3 production ring
givers, H14 courier loads, the H21a anvil giver and the H21c wine giver likewise
remain separate. No carrier reassignment, fleet/config deployment or demo login
is authorized by this document.


## Preparation, readiness and serving lifecycle

The banked delivery path lives in the existing mule role, not a rehearsal
wrapper. It stages the first selected package before any serving cue, closes the
bank, travels to its exact meeting tile, and publishes readiness only after a
new game observation following preparation/travel. After a proven trade it
durably records the run/row session and starts preparing the next selected row.
Top-up amounts still come from the receiver's scoped ask; ID-specific and noted
items use the same ledger and trade machinery.

There are two controls with different purposes:

1. `prepareMule(dir, {runId,account,row,receiver,at})` selects a package without
   authorizing any trade. Its returned sequence identifies this preparation
   generation. The runner reuses a matching active preparation rather than
   repeatedly writing a new one. A different selection is deferred while the
   prior row's cue or trade remains active.
2. The existing scoped serving cue authorizes the actual receiving step. Its
   session is `deliverySession(runId,row)`, stable across preparation, top-up,
   retry and stop. The cue writer must continue its persisted sequence on
   restart. A nonfinal stop revokes authorization; it does not invent a
   successful delivery for an untraded row.

The readiness consumer checks `readyFor(readMuleReady(dir,account), expected)`.
Expected identity includes run, account, row, receiver, exact tile/plane and the
preparation sequence returned by the selected control. Status requires the full
staged inventory, a live player, no bank/trade/shop/dialog/generic interface,
and no active travel. A ready timestamp is the time of the latest **newly
observed game tick**, not the time the helper rewrites its file. Frozen frames
therefore cannot renew readiness.

`cancelMulePreparation` only cancels the matching run/account. Cancellation,
malformed control, or a different preparation generation immediately invalidates
the old ready file, even if cancel and reprepare occur in the same millisecond.
The preparation generation is deliberately distinct from the stable trade
session: invalidating readiness must not enable duplicate delivery.

Success is journaled before the next row is selected. A durable unresolved
trade attempt faults on restart instead of restocking and replaying an
ambiguous exchange. The shared giver observes completed settlement before
processing a receiver cue stop. A stop after confirmation enters the existing
late-decline settlement path; it never sends another accept. Unproved settlement
requires reconciliation, not an automatic retry.

A served helper keeps its exact stand until the receiver closes that session's cue
(`keepsStandAfterServe` in `helpers/mule.ts`). A final stop ends service where it
stands, so the launcher's stop scope logs it out from the stand; a plain stop, a newer
cue, or the run's prepare for another row releases it to bank or travel. Leaving on the
trade's own frame raced the final stop: a walk already sent keeps moving on the server
after the role is aborted. After the last row's plain stop the helper banks once and
then only waits: the served journal and `selectNextDelivery` leave nothing pending, and
a prepare for a served row is refused. The receiver must therefore stop every mule cue
after its trade.

Carry-ahead links bounded consecutive packages with `carryNext` and ledger-derived
`takeBackSlots`. The initial bank withdrawal reserves all linked fixed quantities
and top-up maxima. Readiness checks the full inventory, including later packages
and retained returns, while the existing trade engine offers only the active
package. Capacity includes cumulative take-backs and unasked top-up leftovers.
A valid nonempty confirmation snapshot is retained across empty completion
packets; offered-item escrow is not mistaken for a stable inventory boundary.
After proven settlement, any unexplained inventory difference writes a durable
`mule-delivery-fault` and records the successful row without continuing. Restart
cannot erase that fault or replay the successful trade; reconciliation is required.

A `CueWriter` constructed with an explicit stable session resumes a persisted cue
only after validating the complete schema, exact scope and receiver hash, and safe
integer sequence. It preserves turns, schedule and opening tick. A nonfinal stop
can rearm at the next sequence; a final stop is terminal, including after restart.
Different fresh sessions inherit no turns. This is a single-writer protocol, not a
distributed compare-and-swap mechanism.

## Run owner

The scored run's side of this lifecycle has one implementation, `DeliveryOwner` in
`speedrun/runner/delivery-owner.ts`. `run.ts`'s mule `CueKeeper` and the lab
harnesses (`lab/mule-delivery.ts`, `lab/delivery-chain.ts`) all use it. A carrier
configured with `deliveryRun` authorizes a trade only when the live cue carries
its row's session (`deliveryCueAuthorizes` in `helpers/mule.ts`). A cue under any
other session, such as the random one a plain `CueWriter` mints, is refused at
every row.

For each delivery row R on the path, in chain order:

1. **Prepare.** Each carrier's first row still ahead is prepared after the start
   gates and before SCORED logs in. A later row is prepared when the same
   carrier's previous row stops after its step succeeded. A failed step's stop
   prepares nothing, so the re-run reopens the unserved row. A matching live
   prepare is reused.
2. **Ready gate.** The `{R, mule}` cue's open first stops any open cue, then
   waits (at most `READY_MAX_TICKS` observed ticks) for
   `readyFor(..., preparationSeq)`. It refuses with the carrier's last status,
   and refuses at once on a delivery fault. The gate is at the cue's open, so a
   hand-off step's own precondition (the partner in view, which the resume
   walker also uses to place SCORED at the meeting) is evaluated before it.
3. **Cue.** The cue is written under `deliverySession(run, R)`. While it is
   open it is rewritten (same session, seq+1) every `CUE_REFRESH_TICKS`, and
   again just before a hand-off's first trade click (`beforeTrade`). The
   carrier refuses a cue older than `STALE_CUE_MS`. A re-run reopening an
   unserved row adopts the persisted session and continues its sequence.
4. **Stop.** The stop is final on each carrier's last row (`cueMuleRows`) and
   plain otherwise.

The run id is the run config's `delivery.run`. It is the same token every
carrier's options are generated with (`mule-ledger.ts --delivery-run`).
`run.ts`'s preflight refuses before any login when the path has a delivery row
and any of these hold:

- `delivery.run` is missing or malformed;
- the launcher config at `delivery.launcherConfig` cannot be read;
- a row's carrier entry there has another `deliveryRun`, another `serve`,
  another cue directory, or no package for the row;
- a carrier attempt this run cancelled has not been resumed by the operator.

`run.ts` writes no hold. A hold only works written before the carrier starts:
a running carrier with no control file stages its first row at once, and a
later hold never passes `heldFor`. The hold is therefore the run host's step
before the helper launcher, once per carrier:
`bun speedrun/tools/mule-hold.ts --config <launcher config> --account <carrier>`.
It reads everything from the generated entry. A carrier never held works through
the same prepare and ready sequence.

## Explicit carrier assignment and launch gates

`muleRunOptionsByAccount(ledger,cueRoot,{deliveryRun,serve,itinerary?,accounts})`
takes a complete row-to-account map and returns one canonical option set per
account. It rejects missing, extra or blank bindings and normalizes equivalent
login/display names so aliases cannot hide an unsafe combined itinerary.
This is a planner API, not login authorization.

The generator rejects cross-region ordered routes, bank-to-meeting routes and
conditional insertions using the existing `westOfTaverley` boundary. The runtime
also refuses an initial staging trip across that boundary: a western itinerary
launched on an eastern account cannot silently walk over White Wolf Mountain.
There is no unsafe bypass. Region consistency is necessary, not sufficient:
doors, quest access, hazards and scored timing still need measurement.

The lab-approved E/W partition above removes the known low-level mountain
crossings. It does not prove two carriers suffice or establish either carrier's
stock or live authorization. The western carrier may finish at H16; any
logout/live account budget is the coordinator's decision. H4m remains in the
conditional audit, but is excluded from attempt 1 in favor of the approved
stock-only overflow fix. No same-arrival receiving window is fabricated.

### Observed profiles, not assumed travel capabilities

| Carrier | Observed profile | Inventory and equipment | Observation limits |
|---|---|---|---|
| mule1, production east | Hitpoints 10; all other levels 1, including Magic | Empty inventory; no equipment | Parent read-only observation; no teleport capability assumed |
| mule2, rehearsal east | Hitpoints 10, Attack 2, Woodcutting 40; other published skills 1, including Magic | Empty inventory; no equipment | Profile at 2026-10-23 01:01:59.927Z; QP 0; exact quest stages and bank unobserved |
| h55, lab-approved west | Hitpoints 90, Attack 29, Defence 27, Strength 27, Magic 99; other published skills 1 | Empty inventory; staff of air (1381) equipped | Profile at 2026-10-23 01:10:18.569Z; QP 0; exact quest stages and bank unobserved |
| h03, H20-only config/lab | Hitpoints 69, Attack 85, Thieving 99; all other levels 1, including Magic, Defence and Strength | Nine kebabs and 1,940 coins; no equipment; observed at 3211,3463, plane 0 | Parent observation at 2026-10-23 01:58:38Z; bank and quest stages unknown |

The profile-only diagnostics were separately authorized and independently logged
out. They do not authorize live delivery staging. An empty published quest map is
not proof of every quest stage or an unlock. Western lab measurements must name
whether they used the actual h55 profile or a conservative fresh-account profile;
the earlier H1/H4/H4k proofs used the low-level eastern profile. Magic 99 alone
does not add a teleport itinerary, runes, quest access or spare inventory slots.
The shared delivery engine currently walks its region-consistent routes.

Inventory and stock are separate gates. A banked row must stage its full fixed
counts and top-up maxima before readiness. Travel currently assumes no carried
teleport kit, healing stock or equipment; adding any requires explicit slot,
stock, prerequisite and timing evidence. The measured H4/H4k carry-ahead
layout is 15 H4 slots plus three H4k items, 18 slots before H4; after H4 it is
20 returned rings plus three reserved items, 23 slots. Both actual trades and
the final bank deposit passed in the lab with this layout; paired scored timing
and the remaining route are still separate gates.

The first measured paths and their limitations are preserved in
[`mule-delivery-lab.md`](../research/mule-delivery-lab.md). All other U/Pending
rows remain launch gates. In particular the full S00–S14 rehearsal must use its
actual generated artifacts and approved overlay, including all H7 items except
the explicitly omitted amulet; quantity-only archived bank tests do not prove
delivery.


### Per-row pack and regional stock audit

The following slots are calculated by `muleFromLedger` from the actual manifest,
with top-ups staged at their maxima. They exclude any unapproved travel kit.
A number below 28 is capacity, not authority to add stock.

| Region | Row | Full staged package slots |
|---|---|---:|
| E | H1 | 6 |
| E | H4 | 15 |
| E | H4k | 3 |
| E | H18 | 16 |
| E | H19 | 6 |
| E20 | H20 | 13 |
| E | H21d | 17 |
| E | H22 | 27 |
| E | H4e conditional | 2 |
| W | H6 | 11 |
| W | H4p | 2 |
| W | H7 | 14 |
| W | H8 | 5 |
| W | H9 | 6 |
| W | H10 | 11 |
| W | H12 | **28** |
| W | H13 | 9 |
| W | H14 | 24 |
| W | H15 | 3 |
| W | H16 | 8 |
| W | H4m conditional, not wired | 7 |

**H12 has no spare slot for food or teleport runes.** Readiness cannot assume
an undisclosed travel kit fits that package. Unasked top-ups remain in the
helper inventory and must be included with take-backs in the post-trade capacity
check; incoming items are exchanged after outgoing items free their slots.

The split also changes reuse: the mithril scimitar returned at H12 is now in
the western carrier's bank, but H22 needs it in the east. The eastern stock
gate cannot credit that return. It needs its own initially staged scimitar or
an explicitly authorized pre-run stock arrangement. The stock owner now proposes
h63's spare to avoid competing with h92's cannon obligations. The earlier
conditional approval of one h92 scimitar is not an executed transfer. Source
selection, fresh unallocated-stock confirmation, transfer authorization and
observed eastern stock remain pending; no scimitar is credited twice.
The per-account
`stockWalk` regression covers this distinction; a single combined stock pool
would incorrectly pass it.

Conservative outgoing envelopes, taking every top-up maximum and counting each
conditional package once, include:

| Item | E maximum | W maximum |
|---|---:|---:|
| Air rune | 110 | 1630 |
| Law rune | 12 | 31 |
| Fire rune | 80 | 3 |
| Water rune | 5 | 22 |
| Shark | 10 | 30 |
| Death rune | 0 | 135 |
| Chaos rune | 0 | 40 |
| Blood rune | 0 | 590 |
| Nature rune | 0 | 180 |
| Prayer potion(4) | 0 | 5 |
| Staff of fire | 0 | 2 |

These are requirement envelopes, **not observed bank stock**. They deliberately
credit no returns and do not represent repeated conditional H4m loads. The
western candidate's separately reserved 550 air runes for R8 cannot also count
toward these 1630. All bank distribution and attempt isolation remains under the
stock owner's and coordinator's approval.

### Preparation-window audit

The following is a **planning comparison, not paired scored acceptance**.
It uses the expected/best columns of [RUN-ORDER section 2](../RUN-ORDER.md)
and the module evidence in [STEP-MANIFEST](../STEP-MANIFEST.md). A sampled
best or a model is not a guaranteed minimum duration. The comparison omits
the receiving leg entirely, and generally omits other intervening legs too.
The actual runner must measure from the previous trade's completion to its
readiness gate. Resume/skip paths cannot borrow work that they skip.

The predecessor is the preceding row **on that carrier**, not the preceding
handoff globally. In particular, the east carrier advances from H4k (or its
conditional H4e) to H18; it does not make a western H16-to-Lumbridge trip.
The western carrier's initial H6 stock and placement remain an explicit
pre-run requirement.

| Receiving row | Carrier predecessor / usable scored work | Planning budget in ticks | Measured preparation | Conclusion |
|---|---|---:|---:|---|
| H1 | Initial east staging, before scored login | Outside scored clock | 97 | Mechanical pass; survival/stock and fresh prelogin gate still required |
| H4 | East H1; S02 + S03 + S04 | 865 sampled-best composition; 874.3 expected | Unmeasured full H1 transition | Depart after H1; do not wait until T04-05 |
| H4k | East H4; Doric remainder + T05-06 + S06 | 132 mixed-source model | 44 carry; 132 bank-return baseline | Carry has 88 model ticks spare, not a paired deadline result |
| H6 | Initial west staging; S07 | 2,969 best-model work ticks if started with S07 | 77 from lab bank start | West residency and stock must already be valid; no mountain crossing assumed |
| H4p | West H6; S08 Plague City | 381 sampled best | 100 | 281 model ticks spare; paired gate pending |
| H7 | West H4p; S09 Mining | 3,148 best-model work ticks | 145 | 3,003 model ticks spare; paired gate pending |
| H8 | West H7; S10b Tree Gnome Village | 665 sampled best, excluding later S11a and all legs | 280 | 385 model ticks spare; real gate traversal and trade passed |
| H9 | West H8; S11b Grand Tree | 1,259 sampled best | 235 | 1,024 model ticks spare; real Stronghold return and bank passed, paired gate pending |
| H10 | West H9; S12 Fight Arena | 506 sampled best | 61 | 445 model ticks spare; same meeting still required banking and fresh generation |
| H12 | West H10; S13 Dwarf Cannon + S14 cannon session | 914 best-column composition (810 + 104) | 208 | 706 model ticks spare when preparing after H10/during S13; S14-only 104 is insufficient |
| H13 | West H12; S15 Monkey Madness | 4,277.7 best-model composition | Unmeasured | Landing remains canonical; explicit-drop integration and receiver fixture required |
| H14 | West H13; S16 Mage Arena | 336 sampled best | Unmeasured | Must retain full incoming-return/slot proof |
| H15 | West H14; S18 stun pack | 1,925 best-column work ticks | Unmeasured full transition | Depart after H14; bank credits remain account-local |
| H16 | West H15; S19 Sea Slug | 304 sampled best | 172, guarded repeat | 132 model ticks spare; fixed trade-start rerun passed without helper displacement, paired gate pending |
| H18 | East H4k/conditional H4e; can stage long before S20 | S20 alone has 318 sampled-best ticks; S21 adds more | Unmeasured full transition | Prepare early; do not use the retired nature-altar S21 number as current body timing |
| H19 | East H18; S22 Fishing | 1,969 best-column work ticks | 110 initial bank-to-ready only | H18-to-H19 bank cycle still unmeasured |
| H20 | Independent h03; prepare during S22 | S22 preparation window; old H19 predecessor allowed only 12 | h03 route pending; old same-carrier route 147, direct lower bound 82 | Independent config/lab assignment approved; profiled route, idle readiness and logout still gates |
| H21d | Original east after H19 once H20 is reassigned; S24 + S25a | 1,378 best-column composition (475 + 903), excluding internal legs | Unmeasured | Smithing window belongs before this receiving step; no platebody return |
| H22 | East H21d; S25d/e/c | At least 244 in the selected-column comparison from S25e + S25c alone (167 + 77), excluding Crafting | Unmeasured | Separate eastern scimitar stock still required |
| H4e | Conditional east diversion during S07 | Trigger-dependent; no numeric allowance until selected | Unmeasured delivery route | Must prepare before the fallback receiving boundary; never an arrival cue |
| H4m | Conditional west audit only | No attempt-1 trigger | Unmeasured | Excluded from attempt 1; no invented timing window |

The H8–H12 sequence at `72593a60` completed all four real trades and final banking on bgsrv-mac. It asked for three sharks at H10 and seven at H12, reached a 28-slot helper peak and a 28-slot H12 recipient post-swap pack, and banked every observed return plus eight unasked sharks. The h55-profile carrier remained at 90 HP through the last readiness observation, then reached a minimum of 86 on the final return. The recipient's initial Ranged 70 was an explicit mechanical fixture seed for the later bow, not a claim about its earlier H8 scored profile. The guarded H15–H16 repeat at `adae3081` retained exact helper position and all returns. Neither sequence ran the intervening scored quests; the comparisons above remain planning evidence, not paired receiving-gate acceptance.

Automatic after-success staging is important to this schedule. A later explicit
preparation acknowledges the already selected next row; it must not force the
helper to sit at the previous meeting until that later trigger. Cancellation
still stops travel and invalidates readiness. The runner owns the exact trigger
and must prove that abort, resume and skip preserve this distinction.

These production windows **do not substitute for rehearsal measurements**.
The actual rehearsal GIVE projection changes packages but leaves downstream
step effects unresolved. Its ten numeric packages can be validated while the
full S00–S14 readiness/space/timing proof remains incomplete.

### Receiving gates to measure

Preparation may begin automatically after the previous successful assigned
row. The runner's conservative checks are at the following boundaries, not
arbitrary arrival-time waits:

| Row | Latest planned preparation phase | Readiness decision |
|---|---|---|
| H1 | Before scored login | Before scored login |
| H4 | S03/S04 | Before T04-05 |
| H4k | After H4, during S06 | Before T06-07 |
| H6 | S07, western carrier already resident | Before T07-08 |
| H4p | S08 | Before T08-09 |
| H7 | S09 | Before T09-10 |
| H8 | S10b | Before T11a |
| H9 | S11b | Before T11-12a |
| H10 | S12 | Before T12-13a |
| H12 | Immediately after H10/during S13; acknowledge no later than S14 | Before receiving leg T14-15 |
| H13 | S15 | Before T15-16a |
| H14 | S16 | Before T16-18 |
| H15 | S18 | Before T18-19 |
| H16 | S19 | Before T19-20 |
| H18 | S20/S21, east carrier still resident | Before T21-22 |
| H19 | S22 | Before T22-23 |
| H20 | Independently during S22, not after H19 | Before T23-24 |
| H21d | S24 and S25a smithing | Before H21d receiving step, not before T24-25 |
| H22 | S25 | Before T25-26 |

This is the runner owner's integration contract. The mission snapshot reviewed
for this audit does not yet contain preparation/readiness consumption; the
consumer implementation and paired timing remain required. H4e is explicitly
conditional; H4m currently has no implemented receiving window. Rehearsal
early preparation must use the same contract and the actual transformed ledger,
not an arrival-written serving cue.

### Idle prepositioning

Delivery mode defaults to five-minute client activity while a healthy, freshly
observed package is staged at its exact meeting tile. It uses the SDK's
stationary wait action, not the carried helper's out-and-back step. No bank,
trade, generic interface, travel, cancellation or stale observation can qualify
for that activity. An action acknowledgement does not refresh readiness;
only a new observed world tick can do that.

The browser resets its ten-minute inactivity timer when it receives an SDK
action. The lite client instead emits its existing transport keepalive
independently; its idle watchdog detects missing incoming packets, not a player
standing still. Neither mechanism proves survival or availability for an entire
run. Account-specific long-idle health and readiness still require a real lab
measurement. An explicit `keepAliveMinutes: 0` disables helper activity and
must not be treated as browser idle protection.

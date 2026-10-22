# Anvil helper (H5: the bars for S25a Smithing)

`speedrun/helpers/anvil.ts`, a run-machine role started by the launcher (`standalone.ts`,
HELPERS.md "Helpers on the run machine"), like the altar and bone givers. While the scored
account smiths on the Varrock west anvil (3188,3426) from (3187,3426), the helper stands on
(3187,3427) holding exactly the next inventory and keeps a trade request standing. The scored
account's trade click after the inventory's last item opens both screens at once. The helper
offers the bars (one press per item id, the accept behind them; `lib/trade.ts give`) and takes
back whatever products the scored account offers in the same trade. Then it restocks at the
Varrock west booth while the next inventory is smithed, and is back and requesting before it
ends. About 31 trades take Smithing from 1 to 99 (`skills/smithing.md` section 1; SUPPLIES.md
H21a).

## Why on the run machine

Every reaction of the helper's half (the offer and accept when the screens open, the re-accept
after the scored account's products reset both accepts, the confirm accept) sits on the scored
account's clock, about 3 reactions per trade, 31 trades. A helper relayed from bbs lands each
one 2-3 ticks late (`LAB.md`), which would cost on the order of 200-300 ticks over S25a. On the
run machine, through the launcher's loopback gateway, a reaction lands on the next tick, which
is what the lab measures below. The role uses only the SDK surface (state, trade, bank, walk),
so the launcher's direct path (`path: 'direct'`, rs/163) should apply to it unchanged once it
lands. It is not needed for the turnaround: the relay already puts the helper's half at the
3-tick floor.

## The protocol (agreed with rs/197, `speedrun/skills/smithing.ts` `ANVIL_CONTRACT`)

The scored side owns the plan and writes it into the cue directory (`RC_CUE_DIR`):

- `cue.json` (`CueWriter`, `altar-cue.ts`): the receiver's name hash. The helper requests only
  to whoever in sight matches it, and declines a trade opened by anyone else. The run publishes
  it together with seq 0.
- `anvil-plan.json` (`writeAnvilPlan`): `{session, seq, give}`, the inventory the scored side
  wants next, by debug name (`bronze_bar`, `iron_bar`, `steel_bar`, `mithril_bar`,
  `adamantite_bar`, `hammer`), unnoted, at most 28 items. Seq 0 is written before SCORED reaches
  the anvil and carries `hammer: 1` beside the first 24 bars when SCORED holds none. SCORED
  writes seq N+1 on the tick seq N's bars arrive, so the helper has the ~25 smithing ticks to
  restock.
- The final hand-back: `{seq: last+1, give: {}, collect: true}`. The helper empties its own
  inventory, offers nothing, accepts as soon as anything is offered (re-accepting after any
  reset), accepts the confirm screen, and counts it delivered once the items are in. Then
  `{stop: true}` ends the role.
- A new S25a entry uses a new `session` with seq from 0. The helper records the last
  `(session, seq)` it handed over in `ctx.state` (`anvil.delivered`), so neither a new trade
  nor a helper restart stages an inventory twice. A trade that comes back unsettled still
  counts as delivered when the planned items are gone, because only a completed trade takes
  them (the helper never drops).

Per trade, the helper's own offer is checked exactly on both screens (`give`'s rules). The
scored account may offer anything, including nothing (`ANY_OFFER`): it hands back what it
made, and a refused make click leaves 4 platebodies instead of 5.

## The cycle

`nextStep` decides, from the plan, the delivered record, the inventory and the position: stop,
wait for a plan, stage, go to the tile, wait for the scored account, or request. `staging`
says what it takes to carry exactly the plan: one deposit-all per item id outside the plan
(products, a note stack of a planned name, or a planned item over count) and the shortfall to
withdraw. Restock `bank` re-clicks the booth nearest the anvil every tick until the bank
opens, then in that tick deposits and withdraws (the deposits go first in the same tick, and
the server handles them in order). The booth wait (`openBooth`) is bounded: it gives up after
40 clicks or 50 ticks with a reason, and an empty bank counts as open once it has stayed open
into the next tick, so `labStock` can fill it in the lab and elsewhere staging fails with "the
bank is empty, so short of ..." instead of waiting for items that never come. It reports the
bank (`ctx.reportBank`) and walks back onto the tile. The standing request is the bone giver's `requestUntilOpen`, on `lib/trade.ts`'s one rule for trade clicks (`decideTradeClick`, `bone-giver.md`): a refusal ("is busy at the
moment") is answered on the frame that carries it.

## Options (`ROLE_OPTIONS`)

| Option | Default | Meaning |
|---|---|---|
| `restock` | `{ kind: 'bank' }` | `bank`: the Varrock west booth. `cheat`: `~clearinv` and `::give` on the tile (local lab only). `labStock: true` (lab only) tops the bank up with staff-made notes when it runs short |
| `tile` | 3187,3427 | where to stand |
| `trades` | no limit | stop after this many (else the plan's or the cue's `stop`) |
| `noReplyTicks`, `resendTicks` | 2, 100 | the standing request |
| `cueDir` | `RC_CUE_DIR`, else `run-machine/rc-cue` | |

Launcher entry: `{ account: ..., role: 'anvil' }`. Its bank must hold the bars (SUPPLIES.md
H21a: bronze 15, iron 39, steel 120, mithril 305, adamantite 365, and the hammer); stock moves
from the smelters go through rs/41.

## Measured (local engine, `NODE_TICKRATE=300`, bgsrv-mac at load ~5-6 of 12 cores, 2026-10-21 16:25-16:37 PDT)

`docs/speedrun/scripts/smithing-trade.ts --from 1 --until 99 --restock bank` is the stand-in
scored side. It writes the cue and the plan and runs this role standalone as the helper
(cairn_a01; the stand-in is cairn_a02). The helper restocks at the real booth, with the bank
topped up by `labStock`.

```
NODE_TICKRATE=300 LAB_HELPERS=cairn_a01 WEB_PORT=9610 WEB_MANAGEMENT_PORT=9611 HISCORES_WEB_PORT=9612 NODE_PORT=44310 AGENT_PORT=8610 \
  speedrun/lab/lab.sh cairn_a02 'docs/speedrun/scripts/smithing-trade.ts:--helper:cairn_a01:--from:1:--until:99:--restock:bank'
```

(`bots/create-bot.ts` refuses `cairn_` names, so write `bots/cairn_a0{1,2}/bot.env` by hand
first, as `speedrun/lab/bone-giver.ts` does.)

| Two full routes, 31 trades each | dialogs left open | dialogs clicked through (`--dialog click`) |
|---|---|---|
| Trades failed | 0 | 0 |
| First request to level 99 | **1,024 ticks** | 1,058 (the first trade waited 19 on the helper's lab setup) |
| Turnaround, last xp to the next make click (30 trades) | 8 x16, 9 x7, 10 x3, 11 x1, 12 x3; mean 8.93 | 8 x17, 9 x6, 10 x3, 11 x1, 12 x3; mean 8.90 |
| Screens open to bars in the scored inventory | **3 on every trade** | 3 on every trade |
| Helper restock: trade done to staged on the tile, requesting | 14 (17 when the lab tops up a new tier) | same |
| Helper staged before the screens open | 11-20 ticks | same |

Against the old script's figures (1,147 ticks; turnaround 9-10; screens to bars 3-9, typically
4-5), the helper's half is at its floor: 3 ticks from the screens to the bars, and the restock
has about 15 ticks to spare.

**The four trades over 10 are the scored side.** They are trades 1-4 (levels about 34-60),
where each inventory crosses several levels. In them the helper's request was standing 3-4
ticks before the screens opened, but the scored account's own click took 6-7 ticks to open
them against 3 later. The excess falls steadily (7, 7, 7, 6, 5, 5, 5, 4, 4, 4, 3) as level-ups
per inventory thin out. rs/197 traced the mechanism, and it is an engine floor rather than
something either side can script away. Each item that crosses a level queues `[advancestat]`
on the engine queue (`Player.ts` addXp). That queue runs only while the player is accessible,
and a make-5 chain keeps SCORED delayed until the last item's `p_delay(2)`, so no page exists
before the last xp. After it the queued scripts open one page per tick. SCORED's trade click
closes the open page, but the same tick's engine queue opens the next one before the trade
interaction runs. So the trade opens about one tick per item that crossed a level. Clicking the
dialogs through made no difference, here or in `smithing.md`. From trade 5 on, every
turnaround is at most 10, and from trade 11 on it is 8-9; read the 10-tick bound against the
inventories without a level-up backlog.

Not measured: the demo, the run machine itself, and `path: 'direct'`.

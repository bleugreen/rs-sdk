# h45 private max-load duty: PASS

Observed 2026-10-23 01:55–02:02 UTC on the local Darwin arm64 executor, Bun 1.3.13.
The completed lab process exited 0 with 20 result checks and no failed checks.
proof.json retains exact inventory/equipment/skill snapshots, health changes,
trade offer and confirmation frames, role logs, launcher logs and source hashes.

## Exact source and command

This was a verdict-only composite, not a test of a claimed integrated branch:
base 649e4fcd12fa492b3f971e0ebe2a972d611d4494 plus composite.patch,
SHA-256 ffcbbfef12a92a23188951b7842ee650a98dff0c4b8b322bf57ce13ab46b3a25.
The patch adds the parent's literal ledger adapter and this lab harness only;
the base's existing carried trade engine is unchanged.
The harness was originally committed at 23109737616ccd006db8f48db57031a9349183b6;
its executed SHA-256 (also reconstructible from the archived patch) is
e2a86d3c6962787598d6f1fd0bd14ed7cfa7a5e0c1dabb95f23c54d349637f2f.
The full generator, engine and manifest hashes are in proof.json.

In a disposable checkout of that immutable base, apply the archived patch and
execute in ONE invocation (separate verdict-only batch items reset tracked edits):

    git apply /absolute/path/to/composite.patch
    bun install --frozen-lockfile
    (cd server/webclient && bun install --frozen-lockfile)
    (cd server/engine && bun install --frozen-lockfile)
    WEB_PORT=9730 WEB_MANAGEMENT_PORT=9731 HISCORES_WEB_PORT=9732 NODE_PORT=44730 AGENT_PORT=8730 NODE_TICKRATE=400 LAB_TIMEOUT=2400 LAB_LOG=/tmp/rs537-atoll-run3 speedrun/lab/lab.sh lab537max 'speedrun/lab/atoll-mule.ts:--gw=8731'

The run used dedicated ports 9730, 9731, 9732, 44730, 8730 and 8731, checked free
before launch and after cleanup. Accounts were private lab537max and
cairn_lab45; no live/demo account, login or staging was used.

## Observed acceptance

| Check | Observation |
| --- | --- |
| Profile | Attack/Strength/Defence99, HP68/99, Prayer1, Magic57, Agility76 |
| Worn | Adamant full helm1161, longsword1301, chainbody1111, platelegs1073 |
| Full start | 27 sharks385 + Superantipoison(4)2448 = 28 occupied slots |
| Generated packages | M shark cap15; P potion2448 cap1 then shark cap9 |
| M receiver | 12 retained logs, 16 free; dynamic ask15; received exactly15 in5 ticks |
| M departure | 12 sharks + potion remain; HP58 |
| Movement | Configured M2763,2704 to P2803,2724; after wildlife/trade actual departure2763,2705; walked23 ticks to exact P |
| P idle | Mule snapshot ticks102→952 =850 ticks at400ms, about340 seconds |
| Keepalive | Actual step2803,2724→2804,2724 and back,2 ticks after300199ms idle |
| P receiver | 17 retained logs,11 free; potion-first dynamic ask1+9; exact receipt in5 ticks, one spare slot |
| Survival | HP minimum55, final63; no death; 963 distinct observed frames, maximum gap1 tick |
| Own food | Zero consumed; exactly3 sharks remain; both deliveries fulfilled |
| Session | One launcher login; final cue logout observed2 receiver ticks later, unlisted799ms later |

The two seeded jungle spiders were killed in30 and25 ticks, with logged fight
damage3 and6. Across the full observed health history there were14 HP of
downward changes and9 HP of natural recovery (68→63); the health history also
covers post-fight losses, without asserting their cause from HP alone.

Ticks in SDK snapshots are per-client clocks. Role-log wrapper ticks use the
receiver clock; data.tick in a keepalive is the mule clock. Do not subtract
clocks from different clients.

## Limits and preceding attempts

This is an explicit private **atoll-start fixture**, NOT Stronghold-to-atoll route
proof, live pack/staging evidence, or an operational assignment. It proves this
natural-duty trial, not worst-case randomized survival. The carried engine does
not automatically eat guard food: the three reserve sharks were untouched, not
demonstrated autonomous protection. Parent-owned headless tests separately cover
partial asks and depletion accounting; they are not represented as natural
food consumption here.

Run1 was invalid as max-load evidence: a multi-item verdict-only batch executed
the old22-shark/rune fixture and hit its obsolete nonfinal stop cue. Run2 used the
correct28-slot/HP68/adamant fixture and passed with minHP46/final54, but lacked the
receiver's canonical spare slot. Run3, archived here, corrected that layout.
No failed or weaker run is being substituted for this result.

The raw temporary output path was /tmp/rs537-atoll-run3/output.log; its hash is
archived even if temporary storage expires. The structured archive retains all
acceptance snapshots, both full trade transcripts and the role/launcher logs.
Project-wide typecheck and regression-suite verdicts remain the parent task's
responsibility; this artifact claims the scoped runtime proof only.

## Standalone generated-config regression verification

On immutable own-branch revision `aa748e919f5514f1016ad1da8aeac4ec6b2336cb`, Fedora Linux x86_64, Bun 1.3.13:

```sh
bun install --frozen-lockfile
bun speedrun/helpers/mule-ledger.ts --carried-h45 --check docs/speedrun/scripts/h45-carried-packages.json
bun test speedrun/helpers/mule-carried-ledger.test.ts speedrun/helpers/mule.test.ts
```

Exact config check passed; **71 tests passed, 0 failed, 385 assertions**. This includes M requests 14/15 and partial asks, potion-first P caps, preservation of later stock/retained items, missing-potion receiver refusal, reserve depletion accounting, and numeric identity/ambiguity/untradeability regressions. The prerequisite is the owner's exact canonical materializer block from `649e4fcd12fa492b3f971e0ebe2a972d611d4494` in the same module, plus approved `items.ts` blob `c2900f6cdb9624d0f5b920e56dd45e6893a5a696` from `280031781eee96d3f090e6054fdc45a7b53b8604`. No parallel resolver or trade engine was introduced.

| File | SHA-256 at that revision |
| --- | --- |
| `speedrun/helpers/mule-ledger.ts` | `0a8a4e5e8ac343029eb719ed453ca976436e13511094314463ecb6a8718930bc` |
| `docs/speedrun/scripts/h45-carried-packages.json` | `2d46ba301b1840877793d53cd027f33b62710e6ef5ad2b23ea482a0615e2987b` |
| `speedrun/helpers/mule-carried-ledger.test.ts` | `21d6e334ec0df902a93448e41c0fcbc6c31cb03e04788295376e03723fe93423` |
| `speedrun/helpers/mule.test.ts` | `54f2f1eb708e16b0a948e3a3b282621c4958f70532d260bee9b556677aad4788` |
| `speedrun/lib/items.ts` | `7f20e016d0ce350d7bebca7b53eef2e342c3772181c2b5b3738cc5e31b0620f5` |

The headless verdict is separate from the pinned composite private-engine trial above. `cairn check run typecheck` could not produce a project-check verdict: this revision declares no configured checks. It is not a passing typecheck/build/lint claim.

Direct TypeScript checking initially caught the lab's `assertPrivate` parameter being narrower than `BotEnv`. The current source widens that type annotation to `Record<string, string | undefined>`; its runtime logic is unchanged. The archived patch preserves the exact source actually executed by the private lab, not this subsequent type-only correction.

### Archive sanitization

The structured `proof.json` replaces the executor's personal absolute worktree prefix with `<LAB_WORKTREE>` in the generated cue directory and its launcher-log entry. Raw artifact/source/patch hashes remain those of the originals; the sanitized archive has its own hash. Private fixture account labels are retained for trace correlation and are not observations of live accounts. No credential values or environment-file contents are archived.

# Parked patches

Work from closed child issues whose commits no live branch points to. A replay of
main can drop such commits, so their content is kept here as plain unified diffs.
These files are documentation only: none of them is applied to the code on this
branch, and each was parked by a ruling, not lost by accident.

## Applying one

Check out the patch's base commit (or a branch that contains it), then:

    git apply --3way docs/speedrun/rehearsals/parked/<patch>

`--3way` falls back to a three-way merge using the pre-image blobs named in the
patch's `index` lines, so it needs the base commit's objects in the repository
(the Cairn store has them; a fresh clone of the public fork may not). Against the
exact base the patch applies cleanly without it.

Each patch was exported from the Cairn store diff (`base=from`, tree to tree) and
verified on bgsrv-mac: `git apply --check` passes on a checkout of its base, and
after applying, every touched file's blob hash equals the patch's post-image hash.

## rs-290-resend.patch

- **Source:** rs/290, as carried by content in 76246159 ("Carry rs/290 (idle top-up re-send, requestResend) by file content").
- **Range:** `335ba794d97a..76246159f497`, one commit.
- **Base:** `335ba794d97a1e0f8ea47909f781e9daf9df3404`.
- **Size:** 41,083 bytes, 640 lines.
- **Files (+/-):** `server/webclient/src/bot/programs/pickpocket.ts` (+10/-5), `server/webclient/src/bot/programs/pickpocket.test.ts` (+96/-9), `server/webclient/src/bot/programs/stun-actions.ts` (+72/-11), `speedrun/lab/measure-thieving.ts` (+56/-13), `speedrun/skills/thieving.ts` (+17/-2), `speedrun/skills/thieving.test.ts` (+34/-2).
- **What it is:** an opt-in `requestResend` in the in-page pickpocket program: a trade request the engine never answered goes out once more a few ticks later. Thieving's idle top-up turns it on, and it is off by default.
- **Why parked:** the lab showed it safe, but it recovered none of the dropped requests. Main ruled it stays off, and it changes the server/ pickpocket program.

## rs-352-resend-lab.patch

- **Source:** rs/352, eleven [Build] commits `42df227e..d3bb098d`.
- **Range:** `727229040417..d3bb098d65ed`.
- **Base:** `727229040417f81a83d83273bfbc54d33328cdbd`. The store log of d3bb098d confirms the chain sits on it: the parent of rs/352's first [Build] commit, 42df227e, is 72722904.
- **Size:** 57,212 bytes, 821 lines.
- **Files (+/-):** `docs/speedrun/research/stun-pack.md` (+71/-0), `server/webclient/src/bot/programs/pickpocket.ts` (+10/-5), `server/webclient/src/bot/programs/pickpocket.test.ts` (+110/-7), `server/webclient/src/bot/programs/stun-actions.ts` (+75/-11), `speedrun/lab/measure-thieving.ts` (+81/-41), `speedrun/skills/thieving.ts` (+17/-2), `speedrun/skills/thieving.test.ts` (+17/-1).
- **What it is:** the later re-send lab work. It redoes `requestResend` on a newer base, with a test engine that can drop or delay the nth request and a `topupIdleDropped` golden. It adds `topUp.resend` in thieving.ts, `--resend=1` and per-due-stun checks in measure-thieving.ts, and stun-pack.md section 18, which covers seven browser arms: safe, but it recovers 0 of 3 dropped requests, so S18 leaves it off.
- **Why parked:** same ruling as rs-290. Main keeps the re-send off, and it changes the server/ pickpocket program.
- **Notes:** it touches the same re-send code as rs-290-resend.patch on a newer base, so apply one of the two, not both (this one is the later). The live branch's stun-pack.md already has a section 18 (rs/479's crowded-knight lab), so the re-send section needs the next free number if it ever lands.

## rs-480-knight-choice.patch

- **Source:** rs/480, six [Build] commits `10e8bd57..b34af438`.
- **Range:** `36edbf1d9e1c..b34af43847d7`, from the parent of 10e8bd5743bd.
- **Base:** `36edbf1d9e1c623ba8fe61990c7bdf505f502ad6`, the parent of 10e8bd57 per the store log of b34af438 (the Dwarf Cannon S13 commit, #372).
- **Size:** 30,744 bytes, 491 lines.
- **Files (+/-):** `docs/speedrun/skills/thieving.md` (+7/-1), `server/webclient/src/bot/programs/pickpocket.ts` (+18/-3), `server/webclient/src/bot/programs/pickpocket.test.ts` (+50/-0), `speedrun/skills/thieving.ts` (+116/-6), `speedrun/skills/thieving.test.ts` (+118/-1).
- **What it is:** an opt-in uncrowded knight choice. The pickpocket program gains a `prefer` list of npc indices for each fresh target, published as the `target` gauge, and thieving's knight bands gain `knight: { prefer: 'uncrowded' }`.
- **Why parked:** rs/479's crowded-knight lab showed that crowding costs no ticks.

## Noted, not exported

- **227cc071** (rs/186's work, from rs/512): "[Build] pickpocket: count routed knight clicks (routedClicks)", parent d60b4c06, touching `server/webclient/src/bot/programs/pickpocket.ts` and its test. It was still readable in the Cairn store on 2026-10-22 and is not on main. It belongs to rs/186 and is deliberately not carried here.

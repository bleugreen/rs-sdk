# Local test lab for speedrun measurements

Every measured number under `docs/speedrun/` comes from a local engine driven by
the headless lite client. This page is the shared setup.

## Setup

```sh
bun install                                   # repo root
(cd server/engine && bun install)
(cd server/webclient && bun install)
```

Run three long-lived processes (use terminals, not one-shot batches):

```sh
cd server/engine && BUILD_VERIFY=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 bun run start
cd server/webclient && bun run watch
cd server/gateway && bun run gateway
```

- `BUILD_VERIFY=false` skips the pack checksum check (`server/PATCHES.md:178`).
- `NODE_TICKRATE=100` runs 100 ms ticks, three times faster than production's
  300 ms (`fly.toml:26`). Report results in ticks, never in seconds.
- `LOCAL_STAFF_LEVEL=4` grants staff level 4 to every login when no login server
  is configured (`server/engine/src/server/login/LoginThread.ts`). It defaults to
  0, and production uses a login server (`fly.toml:22`), so the public server is
  unaffected. Staff 4 enables `::setstat <skill> <level>`, `::give <obj> <n>`,
  `::tele level,mx,mz,lx,lz` (map square x/z = tile >> 6, local = tile & 63; e.g.
  Varrock west bank (3185,3436) is `::tele 0,49,53,49,44`) and `::setvar`.

Bots:

```sh
bun bots/create-bot.ts <name> --local         # writes bots/<name>/bot.env (gitignored)
cd server/webclient && bun src/lite/runner.ts <name>   # headless client, leave running
bun bots/<name>/<script>.ts                   # scripts import runScript from sdk/runner
```

Do not use the browser client or MCP `execute_code` for rapid-fire tests; the
browser freezes. Scripts drive the lite client.

## Running several labs on one machine

Each process takes its ports from the environment, so parallel labs only need
distinct port blocks. Engine: `WEB_PORT`, `WEB_MANAGEMENT_PORT`, `HISCORES_WEB_PORT`,
`NODE_PORT` (`server/engine/src/util/WorldConfig.ts:234-241`, `Environment.ts`).
Gateway: `AGENT_PORT`, plus `WEB_MANAGEMENT_PORT` so it finds its engine
(`server/gateway/gateway.ts:20,141`). Bot: `SERVER=localhost:<WEB_PORT>` and
`GATEWAY_URL=ws://localhost:<AGENT_PORT>` in `bots/<name>/bot.env`
(`sdk/index.ts:71-84`, `server/webclient/src/lite/runner.ts:397,422`).

| Block | WEB_PORT | WEB_MANAGEMENT_PORT | HISCORES_WEB_PORT | NODE_PORT | AGENT_PORT |
|---|---|---|---|---|---|
| default | 8888 | 8898 | 8889 | 43594 | 7780 |
| agility | 8910 | 8911 | 8912 | 43610 | 7810 |
| mining | 8920 | 8921 | 8922 | 43620 | 7820 |
| woodcutting | 8930 | 8931 | 8932 | 43630 | 7830 |
| fishing | 8940 | 8941 | 8942 | 43640 | 7840 |
| thieving | 8950 | 8951 | 8952 | 43650 | 7850 |

Example (mining block):

```sh
cd server/engine && WEB_PORT=8920 WEB_MANAGEMENT_PORT=8921 HISCORES_WEB_PORT=8922 NODE_PORT=43620 \
  BUILD_VERIFY=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 bun run start
cd server/gateway && AGENT_PORT=7820 WEB_MANAGEMENT_PORT=8921 bun run gateway
# bots/<name>/bot.env: SERVER=localhost:8920 and GATEWAY_URL=ws://localhost:7820
```

All of a lab's processes and scripts must run on the same machine; pin every
batch to one executor.

## Measuring

- Log the server tick of every xp change and report the gaps; that is the cycle
  time. Report base xp: the local engine defaults to the production rate of 25x
  (`server/engine/src/util/WorldConfig.ts:102`), so base xp = game xp / 25.
- Level-up chat dialogs freeze gathering loops; dismiss them
  (`sdk.sendClickDialog(0)`) as soon as they appear.
- Commit measurement scripts under `docs/speedrun/scripts/<skill>-<what>.ts` so
  a number labelled measured names a script someone can rerun. They import
  `runScript` from `../../../sdk/runner` and take the bot name as an argument:
  `bun docs/speedrun/scripts/mining-cycle.ts <botname>` (credentials come from
  `bots/<botname>/bot.env`).

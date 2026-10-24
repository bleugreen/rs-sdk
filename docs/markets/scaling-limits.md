# Scaling limits on the demo: logins per address, login rate, registration, world cap

markets Q2d (rs/519). Phase 2 scales capital as (gp per login-hour) x (logins per address) x (addresses).
This is every limit on that product that the engine and web code enforce, with the timings measured in the
local lab. No demo login was made; the only demo contact was one public `/playercount` read.

Line numbers are against the base branch of rs/519 (`agent/rs-495-coordinator-0`, 2026-10-22). The demo's
deployed environment is not public: "committed" below means the repository's `fly.toml`, which may lag the
operator's real settings.

## The limits

| # | Limit | Enforced at | Setting and default | Value on the demo | Scope | Refusal | Lab (400 ms ticks) |
|---|---|---|---|---|---|---|---|
| 1 | **Concurrent sessions per address** | `World.ts:1052-1061` (check), `:916-925` (count), `:142` (setting) | `MAX_PLAYERS_PER_IP`, default 200 | committed `fly.toml:37` says 100; the operator announced **50** on Discord (RUN-HOST R43); our working cap is 45 | per address, **concurrent sessions in the world**, not logins over a window | code 7 "World is full", same code as a full world | e1: logins 1-50 ok, the 51st and 52nd refused |
| 2 | Address login limiter | `World.ts:2501-2512`, cache `:203` | `NODE_RATELIMIT_ADDRESS_LOGIN`, default 30; window 60 s | **off**: only runs when `NODE_PRODUCTION` is true, and the demo leaves it false (below) | per address | code 16 "Too many login attempts" | e4: the 30th attempt 400 ms apart refused; still refused after 30 s of silence; ok after 61 s |
| 3 | Device login limiter | `World.ts:2571-2582`, cache `:204` | `NODE_RATELIMIT_DEVICE_LOGIN`, default 5; window 15 s | **off** (as row 2) | per client `uid` at an address; every client we run sends uid 1337 (`GameConnection.ts:166`), so in practice per address | code 16 | e3: the 5th attempt 400 ms apart refused; retries every 5 s stay refused; ok after 16 s of silence, refused after 14 s |
| 4 | Same account already mid-login | `LoginServer.ts:406-415` (reply 8), mapped at `World.ts:2244-2248` | none | **on** (always) | per account, only while that account's previous request is still inside the login server | code 16 | e2: two simultaneous logins of one account, new or existing: one ok, one code 16 |
| 5 | Takeover throttle | `LoginServer.ts:577-589`, `:300` | `LOGIN_TAKEOVER_MIN_MS`, default 10 000 | on, 10 s | per account | code 5 "Account already logged in" | e2: takeover ok, an immediate second takeover refused, ok again after 10.5 s |
| 6 | Hop timer | `LoginServer.ts:603-620` | `hopTime` 45 s (`WorldConfig.ts:111`) | inert: the demo is one world, and the timer applies only when the last logout was on a different node | per account | code 21 | not measured |
| 7 | **World player cap** | `World.ts:2596-2600` | `NODE_MAX_CONNECTED` (`WorldConfig.ts:109`, `:251`), default 1000; admits while the count is not above it, so 1001 | set by the operator outside the public config: 1,395 online at 2026-10-22T23:33Z, 1,650-1,812 held for two days earlier, and 'World is full' refusals at about 1,100 after one restart (R43) | global | code 7 | not measured (lab population 50) |
| 8 | Player slots | `World.ts:1920-1927`, `:1064-1072` | 2046 slots, hard-coded | 2046 | global | code 7 | not measured |
| 9 | Login admission per tick | `World.ts:928` (10 per tick), `:911` (time budget min(50 ms, tick/6)) | hard-coded | 10 per tick, shared by every player logging in | global queue | none: the rest wait for the next tick | e2: 45 parallel logins all in 2.26 s, about 6 ticks |
| 10 | Address ban | `LoginServer.ts:418-428` | `ipban` table | unknown | per address | code 7 | not measured |
| 11 | Name and password rules | `World.ts:2584-2594`; `LoginServer.ts:437-448`; `Environment.ts:69` | name 1-12 characters, password 1-20; names are stored as base-37 safe names (a-z, 0-9, `_`; `toSafeName`); `BANNED_USERNAME_WORDS`, empty by default | banned-word list not in `fly.toml`; unknown | per name | code 3 | e1: 52 fresh placeholder names registered without refusal |

The login server also keeps a per-address account set (`ipLoginCount`, `LoginServer.ts:294-327`), but
`getLoginCountForIp` is never called: it enforces nothing.

### Is `NODE_PRODUCTION` on at the demo?

No, on three independent signs. `fly.toml` does not set it and the default is false (`WorldConfig.ts:103`). The
tutorial skip, which is offered only when production is off, was measured working on the demo (speedrun
`research/external.md` row 3). And the code 16 refusals our helpers saw on the demo (HELPERS.md "Login rate
limit") have a non-production source that fits them: row 4, a relogin of an account whose previous attempt the
login server is still processing, which is what a retry loop produces when the login server is slow. Rows 2 and
3 matter only if the operator turns production on; the ramp below is written to survive that too.

## How the per-address cap counts

Once per tick, before admitting anyone, the engine counts the players in the world whose client is a live
network socket, by that socket's address (`World.ts:916-925`); each session admitted in the same tick adds one,
so a same-tick burst cannot slip under the cap. The address is `Fly-Client-IP` on the websocket path
(`web/utils.ts:4-10`, `web/websocket.ts:77`, `:153`), which a client cannot spoof. Three consequences, two
measured:

- **It counts sessions, not logins.** A logout frees the place on the next tick; there is no window.
- **A dropped socket stops counting at once, but its player stays in the world.** On close, the player's client
  becomes a `NullClientSocket` whose address is `unknown` (`web/websocket.ts:220-222`, `ClientSocket.ts:10`).
  e1: after one of 50 sessions dropped, the world still held 50, and one more fresh login was admitted (the next
  was refused). The dropped player is asked to log out after 500 ticks without a connection and forced out after
  1000 (`World.ts:150-151`, `:834-843`): 200 s and 400 s at 400 ms ticks.
- **Takeovers are not checked.** A login of an account already in the world replaces it in place
  (`transferred`, `World.ts:1027-1036`, `:1055`). e1: the dropped account logged back in from the full address
  and the world held 51 from that address. Neither effect raises the number of sessions an address can drive at
  once above 50; they only mean the count can briefly read above it.

Inference, not verified: the raw TCP game port (43594) takes its address from the socket peer
(`tcp/TcpServer.ts`), which behind Fly's TCP proxy is the proxy, not the player, so all TCP clients would share
one count. Everything we run uses the websocket path.

## Registration

There is no registration form and no captcha. With `WEBSITE_REGISTRATION=false` (`fly.toml:28`) the first login
of an unknown name creates the account with the password given (`LoginServer.ts:437-459`); the SDK gateway's
authentication does the same (`LoginServer.ts:835-858`). The account row records `registration_ip`, but nothing
reads it: no per-address or per-time throttle on new accounts exists beyond the login limits above, which a
first login passes through like any other. e1 registered 52 names from one address back to back in 41 s.

## Other limits at scale

| Limit | Where | Finding |
|---|---|---|
| GE | `engine/market/MarketStore.ts:7`, `:127` | 6 offer slots per account; one offer's total at most 2,147,483,647 gp. No per-address, per-time or volume limit, and the market code never reads an address. |
| Player trade | trade handlers, `Player.ts` | No address or account-age check. Item-level untradeables only (content scripts such as `untradeable_holiday_items.rs2`). |
| Anti-cheat | `ClientGameProt.ts:14-21`; `World.ts:2797-2803` | The anticheat packets are declared but no decoder or handler is bound in `ClientGameProtRepository.ts`. The only macro hook is a player's abuse report, which turns on input logging for the reported player; nothing kicks or bans automatically. Random events are off (`fly.toml:25`). |
| Idle logout | `IdleTimerHandler.ts:8-12`; `World.ts:150-151`, `:834-843` | The browser client asks for an idle logout after 10 minutes without input; the server ignores it while `NODE_DEBUG` is true, which the demo sets (`fly.toml:16`), and the lite client never sends it. The server drops only lost connections (row above). A connected bot that sends nothing is never kicked. |
| Logout throughput | `World.ts:860` | At most 10 removals per tick within the same time budget; a mass logout drains at that pace. |
| Memory | `World.ts:140-141` | An 1,100-account swarm from two addresses ran the demo's 4 GB machine out of memory on 2026-07-21, which is why the per-address cap exists. The practical global ceiling may sit below the configured one. |

## Lab

`markets/research/rs519-login-ramp.ts`, run on fedora with `NODE_TICKRATE=400`. Each experiment boots its own
engine, so the in-memory limiters start empty. Every engine ran the committed `fly.toml` environment with
`MAX_PLAYERS_PER_IP=50`; experiments differ only in `NODE_PRODUCTION` and the two rate-limit values. Ports (block
M7 in `README.md`): web 9960, management 9961, hiscores 9962, game 44960, friend 45960, login 43960, logger
43961; agent 7960 reserved but not started. All were free on `lsof` before the run.

| Exp. | Config | Result |
|---|---|---|
| e1 | production off | 52 fresh names back to back: 50 ok, 2 code 7; 41.5 s; median login 800 ms (two ticks), slowest 805 ms. One socket dropped: world still 50; the next fresh login ok, the one after code 7; the dropped account's relogin ok (takeover); world 51. |
| e2 | production off | 45 logins at once: all ok in 2.26 s. Same account twice at once: one ok, one code 16 (new and existing account alike). Takeover ok; again at once code 5; after 10.5 s ok. |
| e3 | production on, defaults | 400 ms apart: 4 ok, the 5th to 8th code 16. Four retries 5 s apart: all 16 (each refusal re-arms the 15 s window). After 16 s silence ok; three more ok; after 14 s silence 16; after 16 s ok. |
| e4 | production on, device limiter off | 400 ms apart: 29 ok, the 30th to 32nd code 16. After 30 s silence 16; after 61 s ok. |
| e5 | production on, defaults | The ramp below for 45 fresh accounts: 45 of 45 ok in 271 s. |

Both limiters count every attempt, refused ones included, and each attempt re-arms the window
(`TTLCache.set`), so the window is measured from the **last** attempt, not the first: a client that keeps
retrying during a lockout never gets out.

## Answer

**Logins per address: 50 concurrent sessions** (the operator's announced value; 100 in the committed
`fly.toml`), counted live, so an address can hold 50 indefinitely and replace any that log out at once. Keep the
working cap at 45: a refusal at the cap is the same code 7 as a full world.

**How fast:** with the demo as configured (production off) nothing rate-limits logins from an address. One
address brought 45 accounts online in 2.3 s in parallel, or 36 s one after another at the two-tick login
latency. The only rule is never to start a login for an account whose previous attempt has not answered
(row 4: code 16). The fleet's own 4-per-minute bucket in HELPERS.md is far slower than the server requires;
its code 16 sightings are row 4, not a burst lockout. If the operator ever turns production on, the fastest
ramp that trips nothing is **chunks of 4 logins 400 ms apart, 16 s of silence between chunks, and 62 s of
silence after every 29th login**: 45 accounts in 271 s measured (e5), and a refusal must be followed by 16 s of
silence, never a retry. The address limiter is per address, so many addresses ramp in parallel.

**Global ceiling:** the world cap `NODE_MAX_CONNECTED`, operator-set and changeable at any restart, observed
between about 1,100 and over 1,812 (1,395 online at 2026-10-22T23:33Z); behind it the hard 2,046 slots and the
4 GB machine, which has already fallen over once at about 1,100 sessions from two addresses. Logins are
admitted at most 10 per tick server-wide. For phase 2 the binding limits are therefore the per-address cap
(45 working) times our address count, until the population nears the operator's world cap, where code 7 starts
refusing everyone, our sessions included, and where a large swarm of ours would be the visible cause.

---
name: executor-batches
description: Use when running the rs-sdk test suite, `tsc`, an engine build, or a Bun script (especially a puppeteer one) in a `run` batch on a remote or Linux executor — preparing a fresh build slot the way CI does, telling slot-setup failures from real ones, and the Bun auto-install trap that breaks puppeteer.
---

# Running tests and scripts on executors

## Prepare the slot in the same batch

A batch can land in a fresh build slot with no `node_modules` (seen on the fedora
and bgsrv-ub Linux executors), and the next batch may land in a different slot.
Unprepared, `bun run test` shows about 25 unrelated failures (`Cannot find package
'fflate'` or `'kleur'`, engine suites failing) and `tsc: command not found`. Those
are slot-setup failures, not yours.

Prepare as `.github/workflows/ci.yml` does, **in the same batch as the tests**:

```sh
bun install --frozen-lockfile
(cd server/webclient && bun install --frozen-lockfile)
(cd server/engine && bun install --frozen-lockfile && BUILD_VERIFY=false bun run build)
bun run check   # or: bun run test
```

The engine build is what the compiled-script regression test
(`server/engine/test/miscellania-coffers.test.ts`) needs. Prepare a base-branch run
the same way before comparing failure counts against it.

## Puppeteer scripts: `bun --no-install`

The root `bunfig.toml` sets `[install] auto = true`. Once `server/webclient`'s
dependencies are installed, `debug`'s optional `require('supports-color')`
auto-resolves supports-color@7.2.0 from Bun's global cache, and puppeteer's import
then fails in proxy-agent with `(0, debug_1.default) is not a function`. Run any
script that imports puppeteer (`docs/speedrun/scripts/tickprog-*.ts`,
`speedrun/lab/measure-relog.ts`, `server/webclient/src/lite/bench-browser.ts` and
the like) with `bun --no-install <script>`. It reproduces on a Linux executor with a
cold Bun cache.

// End-to-end duplication check on a real lab engine (markets Q1a, rs/498;
// write-up in docs/markets/generator-ge-persistence.md). The in-process probe
// (rs498-ge-persistence-probe.ts) covers each code path; this one runs them through
// the tick loop, the network handlers, the content trade scripts and a SIGKILL.
//
//   LAB_RUNNERS=0 LAB_BOTS="q1abuyer q1achurn" NODE_TICKRATE=400 \
//   WEB_PORT=9900 WEB_MANAGEMENT_PORT=9901 HISCORES_WEB_PORT=9902 NODE_PORT=44900 AGENT_PORT=7700 \
//   LAB_TIMEOUT=1500 speedrun/lab/lab.sh q1aseller \
//     markets/research/rs498-lab-ge-escrow-crash.ts:--partner=q1abuyer:--churn=q1achurn
//
// Phase A, Grand Exchange: SELLER lists 100 noted logs @10, BUYER bids 60 @12
//   (fills 60 @10, 2 gp each back to BUYER), SELLER cancels the 40 left, both
//   collect everything, SELLER collects twice. Oracle: live backpacks plus every
//   ledger offer row (escrow + claims) plus tax, before and after.
// Phase B, escrow across a crash: SELLER offers 1000 coins in a trade; CHURN
//   logs out, which checkpoints the whole world with those coins in SELLER's
//   tradeoffer (Player.save serializes them as recovery items); then both accept
//   and the coins reach BUYER; then the engine is SIGKILLed before any further
//   checkpoint. Oracle: the two accounts rows the next login loads
//   (PlayerLoading prefers them to the .sav), decoded here, recovery included.
//   A duplication would show the 1000 coins in both rows.

import { Database } from 'bun:sqlite';
import { existsSync, openSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Subprocess } from 'bun';
import { MarketClient } from '../../sdk/market';
import type { BotWorldState } from '../../sdk/types';
import { ROOT, closeSession, login, logoutClean, openSession, type Session } from '../../speedrun/lib/session';
import { openTrade, tradeOf } from '../../speedrun/lib/trade';
import { sleep, waitTicks, waitUntil } from '../../speedrun/lib/wait';
import { arg, botArg, result } from '../../speedrun/lab/common';
import { cheat, leaveTutorial, tele, VARROCK_WEST_BANK } from '../../speedrun/lab/setup';

const SELLER = botArg();
const BUYER = arg('partner', 'q1abuyer');
const CHURN = arg('churn', 'q1achurn');
const LAB_LOG = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? '/tmp', 'speedrun-lab');
const DB = join(ROOT, 'server', 'engine', process.env.GE_DATABASE ?? 'data/market.sqlite');
const COINS = 995, LOGS = 1511, LOGS_NOTE = 1512;

// ------------------------------------------------------------------ oracles

type Row = { owner: string; side: string; item: number; price: number; remaining: number; state: string; items: number; coins: number };

function withDb<T>(fn: (db: Database) => T): T {
    const db = new Database(DB, { readonly: true });
    try {
        return fn(db);
    } finally {
        db.close();
    }
}

/** Escrow and claims an owner holds in the ledger, in units of `item`. */
function ledger(owner: string, item: number): number {
    return withDb(db => {
        let n = 0;
        for (const o of db.query<Row, [string]>('SELECT * FROM offers WHERE owner=?').all(owner.toLowerCase())) {
            if (item === COINS) n += o.coins + (o.state === 'open' && o.side === 'buy' ? o.remaining * o.price : 0);
            else if (o.item === item) n += o.items + (o.state === 'open' && o.side === 'sell' ? o.remaining : 0);
        }
        return n;
    });
}
const tax = () => withDb(db => db.query<{ t: number | null }, []>('SELECT SUM(tax) t FROM trades').get()?.t ?? 0);

const live = (s: BotWorldState | null, ids: number[]) => (s?.inventory ?? []).filter(i => ids.includes(i.id)).reduce((n, i) => n + i.count, 0);

/** Units of `ids` in a saved player (every inventory plus the recovery list), decoded as PlayerLoading.load reads it. */
function savedUnits(owner: string, ids: number[]): { units: number; recovery: number; byInv: Record<number, number> } | null {
    const save = withDb(db => db.query<{ save: Uint8Array }, [string]>('SELECT save FROM accounts WHERE owner=?').get(owner.toLowerCase())?.save);
    if (!save) return null;
    const b = save;
    let pos = 0;
    const g1 = () => b[pos++];
    const g2 = () => (b[pos++] << 8) | b[pos++];
    const g4 = () => ((b[pos++] << 24) | (b[pos++] << 16) | (b[pos++] << 8) | b[pos++]) | 0;
    const gVarInt = () => {
        let byte = b[pos++], r = 0;
        while (byte & 0x80) {
            r = (r | (byte & 0x7f)) << 7;
            byte = b[pos++];
        }
        return (r | byte) >>> 0;
    };
    g2();
    const version = g2();
    pos += 2 + 2 + 1 + 7 + 5 + 1 + 2 + 4 + 21 * 5; // coords, level, body, colours, gender, energy, playtime, stats
    const varps = g2();
    for (let i = 0; i < varps; i++) {
        g2();
        if (version >= 7) gVarInt();
    }
    let units = 0;
    const byInv: Record<number, number> = {};
    const invs = g1();
    for (let i = 0; i < invs; i++) {
        const type = g2();
        const size = g2();
        for (let slot = 0; slot < size; slot++) {
            const id = g2() - 1;
            if (id === -1) continue;
            let count = g1();
            if (count === 255) count = g4();
            if (ids.includes(id)) {
                units += count;
                byInv[type] = (byInv[type] ?? 0) + count;
            }
        }
    }
    const afk = g1();
    pos += afk * 4 + 2 + 1 + 8; // afk zones, last zone, chat modes, last login
    let recovery = 0;
    const n = g2();
    for (let i = 0; i < n; i++) {
        const id = g2(), count = g4();
        if (ids.includes(id)) recovery += count;
    }
    return { units: units + recovery, recovery, byInv };
}

// ------------------------------------------------------------------ engine

let engineChild: Subprocess | null = null;
process.on('exit', () => {
    try {
        engineChild?.kill('SIGKILL');
    } catch {}
});
function killEngine(): void {
    process.kill(Number(readFileSync(join(LAB_LOG, 'engine.pid'), 'utf-8').trim()), 'SIGKILL');
}
async function startEngine(): Promise<void> {
    const log = join(LAB_LOG, `engine-q1a-${process.pid}.log`);
    engineChild = Bun.spawn(['bun', 'run', 'src/app.ts'], {
        cwd: join(ROOT, 'server', 'engine'),
        env: { ...process.env, BUILD_VERIFY: 'false', BUILD_LIVE_RELOAD: 'false', LOCAL_STAFF_LEVEL: '4' },
        stdout: openSync(log, 'a'),
        stderr: openSync(log, 'a'),
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 300_000) {
        if (existsSync(log) && readFileSync(log, 'utf-8').includes('World ready')) return;
        await sleep(500);
    }
    throw new Error(`replacement engine not ready (${log})`);
}

// ------------------------------------------------------------------ sessions

async function ready(name: string, prep: (s: Session) => Promise<void>): Promise<Session> {
    const s = await openSession(name, { launch: true, pathfinding: false });
    // BotSDK.buildClientUrl assumes a local web server on :8888; the lab serves on WEB_PORT.
    s.sdk.getGEAvailability = () => new MarketClient(`http://localhost:${process.env.WEB_PORT ?? 9300}/bot`).status();
    await leaveTutorial(s);
    await tele(s.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
    await prep(s);
    await logoutClean(s);
    await login(s);
    await waitTicks(s.sdk, 3);
    return s;
}

function must<T extends { success: boolean; message?: string }>(what: string, r: T): T {
    if (!r.success) throw new Error(`${what}: ${r.message}`);
    return r;
}

async function main(): Promise<void> {
    const seller = await ready(SELLER, async s => {
        await cheat(s.sdk, 'give cert_logs 100');
        await cheat(s.sdk, 'give coins 1000');
        await waitTicks(s.sdk, 2);
    });
    const buyer = await ready(BUYER, async s => {
        await cheat(s.sdk, 'give coins 2000');
        await waitTicks(s.sdk, 2);
    });
    const churn = await ready(CHURN, async () => {});
    const both = () => [seller, buyer];

    // ---- Phase A: Grand Exchange
    const snapshot = (label: string) => {
        const row: Record<string, unknown> = { step: label, tax: tax() };
        let logs = 0, coins = tax();
        for (const s of both()) {
            const st = s.sdk.getState();
            const l = live(st, [LOGS, LOGS_NOTE]) + ledger(s.name, LOGS);
            const c = live(st, [COINS]) + ledger(s.name, COINS);
            row[s.name] = { logs: `${live(st, [LOGS, LOGS_NOTE])}+${ledger(s.name, LOGS)}`, coins: `${live(st, [COINS])}+${ledger(s.name, COINS)}` };
            logs += l;
            coins += c;
        }
        row.logsTotal = logs;
        row.coinsTotal = coins;
        result('ge', row);
        return { logs, coins };
    };
    // Next to the exchange table (GrandExchange.ts EXCHANGE_TABLE): ge.open() otherwise walks, which needs the pathfinding service.
    await tele(seller.sdk, 3181, 3443);
    await tele(buyer.sdk, 3181, 3444);
    const t = { s: seller.bot.ge, b: buyer.bot.ge };
    const start = snapshot('start');
    must('seller open', await t.s.open(60_000));
    must('buyer open', await t.b.open(60_000));
    const sell = must('sell', await t.s.place({ item: LOGS, side: 'sell', quantity: 100, price: 10 }, 60_000));
    snapshot('seller lists 100 @10');
    must('buy', await t.b.place({ item: LOGS, side: 'buy', quantity: 60, price: 12 }, 60_000));
    await waitTicks(seller.sdk, 2);
    snapshot('buyer bids 60 @12');
    must('cancel', await t.s.cancel(sell.offer!.id, 60_000));
    snapshot('seller cancels the rest');
    must('seller collect', await t.s.collect(undefined, true, 60_000));
    must('seller collect again', await t.s.collect(undefined, true, 60_000));
    must('buyer collect', await t.b.collect(undefined, true, 60_000));
    await waitTicks(seller.sdk, 2);
    const end = snapshot('all collected');
    result('phase-a', { conserved: end.logs === start.logs && end.coins === start.coins, start, end });
    await seller.sdk.sendCloseModal();
    await buyer.sdk.sendCloseModal();
    await waitTicks(seller.sdk, 2);

    // ---- Phase B: trade escrow, checkpoint, completion, SIGKILL
    const coinsOf = (s: Session) => live(s.sdk.getState(), [COINS]);
    const sellerBefore = coinsOf(seller), buyerBefore = coinsOf(buyer);
    const [o1, o2] = await Promise.all([openTrade(seller.sdk, BUYER), openTrade(buyer.sdk, SELLER)]);
    if (!o1.ok || !o2.ok) throw new Error(`trade did not open: ${o1.reason ?? 'ok'} / ${o2.reason ?? 'ok'}`);
    const slot = seller.sdk.getState()!.inventory.find(i => i.id === COINS)!.slot;
    await seller.sdk.sendOfferItem(slot, 1000);
    const offered = await waitUntil(seller.sdk, s => live(s, [COINS]) === sellerBefore - 1000, { maxTicks: 20 });
    if (!offered.ok) throw new Error('coins did not leave the seller backpack');
    const out = await logoutClean(churn);
    if (!out.ok) throw new Error(`churn logout: ${out.reason}`);
    await closeSession(churn);
    await sleep(1000);
    const atCheckpoint = { seller: savedUnits(SELLER, [COINS]), buyer: savedUnits(BUYER, [COINS]) };
    result('checkpoint-with-escrow', atCheckpoint);

    const done = waitUntil(buyer.sdk, s => live(s, [COINS]) === buyerBefore + 1000 && !tradeOf(s).isOpen, { maxTicks: 60 });
    const accept = setInterval(() => {
        if (tradeOf(seller.sdk.getState()!).isOpen) void seller.sdk.sendAcceptTrade();
        if (tradeOf(buyer.sdk.getState()!).isOpen) void buyer.sdk.sendAcceptTrade();
    }, 600);
    const completed = await done;
    clearInterval(accept);
    if (!completed.ok) throw new Error('trade did not complete');
    const delivered = { seller: coinsOf(seller), buyer: coinsOf(buyer), tick: buyer.sdk.getState()!.tick };
    result('trade-completed-live', delivered);

    killEngine();
    await sleep(1000);
    const afterKill = { seller: savedUnits(SELLER, [COINS]), buyer: savedUnits(BUYER, [COINS]) };
    result('rows-after-sigkill', afterKill);
    // Rows hold every inventory; the live state shows only the backpack. Coins outside the
    // backpack (the 25 in the bank from the tutorial skip) did not move, so add them from the rows.
    const outsideBackpack = (r: ReturnType<typeof savedUnits>) => (r ? r.units - r.recovery - (r.byInv[93] ?? 0) : 0);
    const world = delivered.seller + delivered.buyer + outsideBackpack(afterKill.seller) + outsideBackpack(afterKill.buyer);
    const reloaded = (afterKill.seller?.units ?? 0) + (afterKill.buyer?.units ?? 0);
    const checkpoint = (atCheckpoint.seller?.units ?? 0) + (atCheckpoint.buyer?.units ?? 0);
    result('phase-b', {
        coinsInTheWorldAtTheKill: world,
        coinsInTheRowsAtTheCheckpoint: checkpoint,
        coinsTheNextLoginsLoad: reloaded,
        sellerGetsBack: afterKill.seller?.recovery ?? 0,
        verdict: reloaded > world ? 'DUPLICATION' : reloaded < world ? 'loss' : reloaded === checkpoint ? 'conserved: both rolled back to the checkpoint together' : 'conserved',
    });

    // The replacement engine proves the ledger opens and the rows load after the crash.
    await startEngine();
    result('engine-restarted', { rows: { seller: savedUnits(SELLER, [COINS]), buyer: savedUnits(BUYER, [COINS]) } });
}

await main().catch(e => {
    console.error(e);
    process.exit(1);
});
process.exit(0);

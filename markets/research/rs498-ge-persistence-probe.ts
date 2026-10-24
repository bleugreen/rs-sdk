// Duplication probe for the Grand Exchange ledger, save-v8 escrow recovery and
// whole-world checkpointing (markets Q1a, rs/498; write-up in
// docs/markets/generator-ge-persistence.md).
//
// Drives the real engine modules in-process, the way
// server/engine/test/market-recovery.ts does: real ObjType/InvType configs from
// the built pack, real GE button handlers, real Player.save()/PlayerLoading.load(),
// a throwaway SQLite ledger. A "crash" is what SIGKILL leaves behind: every
// player is rebuilt from the ledger's accounts row (PlayerLoading prefers it to
// the .sav), with nothing written after the last checkpoint.
//
// For every candidate it checks one invariant across the accounts involved:
//   items held (all invs, notes folded to the base item, escrow invs, saved overflow)
//   + ledger escrow (open sell remaining, open buy remaining * price)
//   + ledger claims (offer.items / offer.coins)
//   + GE tax (coins only, all probes share one ledger so it carries over)
// is constant. Each step prints the total and, per account, held/ledger. It also prints the bank value the wealth board would compute
// (LoginServer.ts updateWealthHiscores: sum of ObjType.cost * count over bank).
//
// Run from server/engine after `BUILD_VERIFY=false bun run build`:
//   cd server/engine && bun ../../markets/research/rs498-ge-persistence-probe.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ge-dup-probe-'));
process.env.GE_DATABASE = join(dir, 'market.sqlite');
process.env.GE_ENABLED = 'true';

const E = '../../server/engine/src';
const { default: World } = await import(`${E}/engine/World.js`);
const { default: Player } = await import(`${E}/engine/entity/Player.js`);
const { default: Component } = await import(`${E}/cache/config/Component.js`);
const { default: ObjType } = await import(`${E}/cache/config/ObjType.js`);
const { default: InvType } = await import(`${E}/cache/config/InvType.js`);
const { default: Packet } = await import(`${E}/io/Packet.js`);
const { PlayerLoading } = await import(`${E}/engine/entity/PlayerLoading.js`);
const { default: IfButtonHandler } = await import(`${E}/network/game/client/handler/IfButtonHandler.js`);
const { default: IfButton } = await import(`${E}/network/game/client/model/IfButton.js`);
const { openExchange, exchangeSearch, exchangeCount } = await import(`${E}/engine/market/GrandExchange.js`);
const { marketStore, MAX_GP } = await import(`${E}/engine/market/MarketStore.js`);
const { noteFor } = await import(`${E}/engine/market/MarketCatalog.js`);

type P = InstanceType<typeof Player>;
type Row = { id: number; owner: string; side: string; item: number; price: number; remaining: number; state: string; items: number; coins: number };

const results: { probe: string; verdict: 'conserved' | 'DUPLICATION' | 'loss' | 'error'; detail: string }[] = [];
let key = 1000n;

function canon(id: number): number {
    const t = ObjType.get(id);
    return t.certtemplate !== -1 ? t.certlink : id;
}

/** Every unit of `item` the player holds: all inventories (notes folded), plus saved overflow. */
function held(p: P, item: number): number {
    let n = 0;
    for (const inv of p.invs.values()) for (const o of inv.itemsFiltered) if (canon(o.id) === item) n += o.count;
    for (const o of p.recoveryItems) if (canon(o.id) === item) n += o.count;
    return n;
}

function ledger(owner: string, item: number, coins: number): number {
    const rows = marketStore().db.query<Row, [string]>('SELECT * FROM offers WHERE owner=?').all(owner);
    let n = 0;
    for (const o of rows) {
        if (item === coins) {
            n += o.coins;
            if (o.state === 'open' && o.side === 'buy') n += o.remaining * o.price;
        } else if (o.item === item) {
            n += o.items;
            if (o.state === 'open' && o.side === 'sell') n += o.remaining;
        }
    }
    return n;
}

/** Units a probe deliberately destroys (so making room is not reported as a loss). */
const sunk = new Map<number, number>();
const sink = (p: P, inv: number, item: number, n: number) => {
    p.getInventory(inv)!.remove(item, n);
    sunk.set(item, (sunk.get(item) ?? 0) + n);
};

const tax = () => marketStore().db.query<{ t: number | null }, []>('SELECT SUM(tax) t FROM trades').get()?.t ?? 0;

/** Same arithmetic as LoginServer.ts updateWealthHiscores, on the save the login thread would load. */
function boardValue(name: string): number {
    const loaded = PlayerLoading.load(name, new Packet(new Uint8Array()), null);
    const bank = loaded.getInventory(InvType.getId('bank'))!;
    let v = 0;
    for (const o of bank.itemsFiltered) v += ObjType.get(o.id).cost * o.count;
    return v;
}

function total(players: P[], item: number): number {
    const coins = ObjType.getId('coins');
    let n = 0;
    for (const p of players) n += held(p, item) + ledger(p.username, item, coins);
    if (item === coins) n += tax();
    return n + (sunk.get(item) ?? 0);
}

function make(name: string): P {
    const p = PlayerLoading.load(name, new Packet(new Uint8Array()), null);
    p.x = 3181;
    p.z = 3443;
    p.level = 0;
    World.playerLoop.add(key++, p);
    return p;
}

/** SIGKILL equivalent: drop the live objects, rebuild each player from its ledger checkpoint. */
function crash(players: P[]): P[] {
    for (const p of players) p.unlink();
    return players.map(p => {
        const q = PlayerLoading.load(p.username, new Packet(new Uint8Array()), null);
        q.x = 3181;
        q.z = 3443;
        q.level = 0;
        World.playerLoop.add(key++, q);
        return q;
    });
}

const click = (p: P, name: string) => {
    const press = () => new IfButtonHandler().handle(new IfButton(Component.getId('grand_exchange:' + name)), p);
    if (press()) return;
    // The home-screen button is not visible from every screen; reopen at home and retry once.
    openExchange(p, 3180, 3443);
    if (!press()) throw new Error('button not handled: ' + name);
};

function place(p: P, slot: number, side: 'buy' | 'sell', query: string, item: number, quantity: number, price: number) {
    openExchange(p, 3180, 3443);
    click(p, `slot${slot}_${side}`);
    if (!exchangeSearch(p, query)) throw new Error('search refused');
    if (!exchangeSearch(p, query, item)) throw new Error('select refused');
    click(p, 'offer_quantity');
    exchangeCount(p, quantity);
    click(p, 'offer_price');
    exchangeCount(p, price);
    click(p, 'offer_confirm');
}

function view(p: P, slot: number) {
    openExchange(p, 3180, 3443);
    click(p, `slot${slot}_view`);
}

function check(probe: string, players: () => P[], items: number[], body: (log: (step: string) => void) => void) {
    const names = players().map(p => p.username);
    const base = new Map(items.map(i => [i, total(players(), i)]));
    const steps: string[] = [];
    let worst: 'conserved' | 'DUPLICATION' | 'loss' = 'conserved';
    const log = (step: string) => {
        const parts: string[] = [];
        for (const i of items) {
            const now = total(players(), i);
            const was = base.get(i)!;
            if (now > was) worst = 'DUPLICATION';
            else if (now < was && worst === 'conserved') worst = 'loss';
            const where = players()
                .map(p => `${p.username}:${held(p, i)}/${ledger(p.username, i, ObjType.getId('coins'))}`)
                .join(',');
            parts.push(`${ObjType.get(i).debugname}=${now}${now !== was ? ` (${now > was ? '+' : ''}${now - was})` : ''} [${where}]`);
        }
        steps.push(`  ${step.padEnd(52)} ${parts.join('  ')}`);
    };
    try {
        log('start');
        body(log);
        const board = names.map(n => `${n}=${boardValue(n)}`).join(' ');
        steps.push(`  board value after reload: ${board}`);
        results.push({ probe, verdict: worst, detail: steps.join('\n') });
    } catch (e) {
        steps.push(`  threw: ${e instanceof Error ? e.stack : e}`);
        results.push({ probe, verdict: 'error', detail: steps.join('\n') });
    }
}

try {
    World.reload();
    const INV = InvType.getId('inv'), BANK = InvType.getId('bank'), TRADE = InvType.getId('tradeoffer'), DUEL = InvType.getId('dueloffer');
    const coins = ObjType.getId('coins'), logs = ObjType.getId('logs'), dagger = ObjType.getId('bronze_dagger');
    const logsNote = noteFor(logs);

    // P1: a sell offer partly filled, then cancelled; a buy offer partly filled at a better price, then cancelled.
    {
        let s = make('p1seller'), b = make('p1buyer');
        s.invAdd(INV, logsNote, 100);
        b.invAdd(INV, coins, 2000);
        check('P1 partial fill + cancel + collect', () => [s, b], [logs, coins], log => {
            place(s, 0, 'sell', 'logs', logs, 100, 10);
            log('seller lists 100 logs @10');
            place(b, 0, 'buy', 'logs', logs, 60, 12);
            log('buyer bids 60 @12 (fills 60 @10)');
            view(s, 0);
            click(s, 'view_cancel');
            log('seller cancels the 40 left');
            view(s, 0);
            click(s, 'view_cancel');
            log('seller cancels again (already cancelled)');
            click(s, 'collect');
            click(s, 'collect');
            click(b, 'collect');
            log('both collect-all, seller twice');
            place(b, 1, 'buy', 'logs', logs, 50, 15);
            log('buyer bids 50 @15 (no seller left)');
            place(s, 1, 'sell', 'logs', logs, 20, 11);
            log('seller lists 20 @11 (fills 20 @15)');
            view(b, 1);
            click(b, 'view_cancel');
            click(b, 'collect');
            click(s, 'collect');
            log('buyer cancels 30 left; both collect-all');
            World.checkpointPlayers();
            [s, b] = crash([s, b]);
            log('checkpoint, crash, reload both');
        });
    }

    // P2: collection overflow. Full backpack: the claim must stay in the ledger,
    // survive a crash, and pay out exactly once when space appears.
    {
        let s = make('p2seller'), b = make('p2buyer');
        s.invAdd(INV, logsNote, 50);
        // 600 coins: 100 stay behind, so the coin stack keeps its slot and 27 daggers fill the rest.
        b.invAdd(INV, coins, 600);
        for (let i = 0; i < 27; i++) b.invAdd(INV, dagger, 1);
        check('P2 collect with a full backpack (overflow retry)', () => [s, b], [logs, coins, dagger], log => {
            place(s, 0, 'sell', 'logs', logs, 50, 10);
            place(b, 0, 'buy', 'logs', logs, 50, 10);
            log('50 logs traded @10; buyer backpack full');
            for (let i = 0; i < 5; i++) click(b, 'collect');
            log('buyer collect-all x5 (no room)');
            World.checkpointPlayers();
            [s, b] = crash([s, b]);
            log('checkpoint, crash, reload');
            for (let i = 0; i < 5; i++) b.getInventory(INV)!.remove(dagger, 1);
            b.invAdd(BANK, dagger, 5);
            view(b, 0);
            click(b, 'view_collect');
            log('5 slots free; collect unnoted on offer screen');
            click(b, 'view_collect');
            log('collect unnoted again (backpack full again)');
            b.getInventory(INV)!.remove(dagger, 1);
            b.invAdd(BANK, dagger, 1);
            click(b, 'collect');
            log('1 slot free; collect-all as notes');
            click(s, 'collect');
            log('seller collects coins');
            [s, b] = crash([s, b]);
            log('crash without a new checkpoint, reload');
        });
    }

    // P3: the checkpoint inside a GE transaction fails after the backpack was
    // credited. The transaction must roll back the ledger and the backpack together.
    {
        let s = make('p3seller'), b = make('p3buyer');
        s.invAdd(INV, logsNote, 30);
        b.invAdd(INV, coins, 300);
        check('P3 failed checkpoint during collect (rollback)', () => [s, b], [logs, coins], log => {
            place(s, 0, 'sell', 'logs', logs, 30, 10);
            place(b, 0, 'buy', 'logs', logs, 30, 10);
            log('30 logs traded @10');
            const broken = make('p3broken');
            broken.save = () => {
                throw new Error('injected serialization failure');
            };
            for (let i = 0; i < 3; i++) click(b, 'collect');
            log('buyer collect-all x3 while a bystander save throws');
            broken.unlink();
            click(b, 'collect');
            log('bystander gone; buyer collect-all');
            [s, b] = crash([s, b]);
            log('crash, reload');
        });
    }

    // P4: player-owned escrow (tradeoffer) checkpointed, then the trade completes,
    // then the world dies at three different points.
    for (const variant of ['no later checkpoint', 'recipient-only save()', 'donor logs out (flushPlayer)', 'recipient logs out (flushPlayer)'] as const) {
        let a = make('p4a' + variant.length), b = make('p4b' + variant.length);
        a.invAdd(INV, coins, 1000);
        check(`P4 escrow then crash: ${variant}`, () => [a, b], [coins], log => {
            a.getInventory(INV)!.remove(coins, 1000);
            a.invAdd(TRADE, coins, 1000);
            World.checkpointPlayers();
            log('A offers 1000 coins; autosave checkpoint');
            a.getInventory(TRADE)!.remove(coins, 1000);
            b.invAdd(INV, coins, 1000);
            log('trade completes A -> B');
            if (variant === 'recipient-only save()') b.save();
            if (variant === 'donor logs out (flushPlayer)') {
                a.unlink();
                World.flushPlayer(a);
            }
            if (variant === 'recipient logs out (flushPlayer)') {
                b.unlink();
                World.flushPlayer(b);
            }
            if (variant !== 'no later checkpoint') log(variant);
            World.logoutRequests.clear();
            [a, b] = crash([a, b]);
            log('crash, reload both from the ledger');
        });
    }

    // P5: recovery runs exactly once, however often the player relogs.
    {
        let a = make('p5escrow');
        a.invAdd(DUEL, coins, 777);
        a.invAdd(TRADE, logsNote, 40);
        check('P5 escrow recovery is idempotent across relogs', () => [a], [coins, logs], log => {
            a.save();
            for (let i = 1; i <= 4; i++) {
                [a] = crash([a]);
                a.save();
            }
            log('save + reload x4');
        });
    }

    // P6: recovery overflow (inventory and bank stacks both full) stays saved, is
    // retried, and is never counted by the board.
    {
        let a = make('p6overflow');
        a.invAdd(INV, coins, MAX_GP);
        a.invAdd(BANK, coins, MAX_GP);
        a.invAdd(TRADE, coins, 1000);
        sunk.clear();
        check('P6 recovery overflow with full coin stacks', () => [a], [coins], log => {
            a.save();
            [a] = crash([a]);
            log(`reload: overflow saved = ${a.recoveryItems.reduce((n: number, o: { count: number }) => n + o.count, 0)}`);
            for (let i = 0; i < 5; i++) a.recoverItems();
            log('recoverItems() x5 with no space');
            a.save();
            [a] = crash([a]);
            a.save();
            [a] = crash([a]);
            log('save + reload x2');
            sink(a, INV, coins, 400);
            a.recoverItems();
            a.recoverItems();
            log('400 destroyed from inv, recoverItems() x2');
            a.save();
            [a] = crash([a]);
            log('save + reload');
        });
    }

    // P7: session takeover (World.processLogins "player already logged in"): the
    // old session is closed, saved, reloaded into the new one and removed without
    // a logout save or logout trigger. Replays that sequence with stake escrow.
    {
        let a = make('p7taken'), b = make('p7opponent');
        a.invAdd(INV, coins, 500);
        b.invAdd(INV, coins, 500);
        check('P7 takeover with stakes in dueloffer', () => [a, b], [coins], log => {
            a.getInventory(INV)!.remove(coins, 500);
            a.invAdd(DUEL, coins, 500);
            b.getInventory(INV)!.remove(coins, 500);
            b.invAdd(DUEL, coins, 500);
            log('both stakes in dueloffer (fight in progress)');
            a.closeModal();
            const existing = a.save();
            const transferred = PlayerLoading.load(a.username, new Packet(existing), null);
            a.unlink();
            transferred.x = 3181;
            transferred.z = 3443;
            World.playerLoop.add(key++, transferred);
            a = transferred;
            log('takeover of A (World.ts processLogins sequence)');
            World.checkpointPlayers();
            [a, b] = crash([a, b]);
            log('checkpoint, crash, reload');
        });
    }

    let failed = 0;
    for (const r of results) {
        console.log(`\n[${r.verdict}] ${r.probe}\n${r.detail}`);
        if (r.verdict === 'DUPLICATION' || r.verdict === 'error') failed++;
    }
    console.log(`\nSUMMARY ${results.map(r => `${r.verdict}:${r.probe.split(' ')[0]}`).join(' ')}`);
    process.exitCode = failed ? 1 : 0;
} finally {
    marketStore().db.close();
    rmSync(dir, { recursive: true, force: true });
    await Promise.all([World.loginThread.terminate(), World.friendThread.terminate(), World.loggerThread.terminate()]);
}

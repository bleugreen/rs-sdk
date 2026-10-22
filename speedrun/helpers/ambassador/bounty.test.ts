import { describe, expect, test } from 'bun:test';
import type { OffersSnapshot } from '../ge-offers';
import { BOUNTY, BountyBoard, boardConfig, boardFromOptions, gp, liveBounties, parseBountyState, pricesIn, quantitiesIn, type BoardConfig } from './bounty';

const T0 = Date.parse('2026-10-21T12:00:00Z');
const MIN = 60_000;

const RAW = {
    bidder: 'cairn_h61',
    offersFile: '/nowhere/ge-offers.json',
    theme: 'wilderness week',
    list: [
        { item: 'Nature talisman', quantity: 6, maxPrice: 30_000, tier: 'legendary', flavour: 'a green stone that hums', aliases: ['nature tali'] },
        { item: 'Limpwurt root', quantity: 10, maxPrice: 500, tier: 'rare', flavour: 'hill giants keep them' },
        { item: 'Eye of newt', quantity: 40, maxPrice: 20 }
    ]
};

function cfg(over: Record<string, unknown> = {}): BoardConfig {
    const r = boardConfig({ ...RAW, ...over });
    if (!r.ok) throw new Error(r.error);
    return r.value;
}

function snap(over: Partial<OffersSnapshot> = {}, at = T0): OffersSnapshot {
    return {
        version: 1,
        account: 'cairn_h61',
        writtenAt: new Date(at).toISOString(),
        offers: [
            { id: 1, item: 'Nature talisman', itemId: 1444, side: 'buy', state: 'open', price: 30_000, quantity: 6, remaining: 4, filled: 2 },
            { id: 2, item: 'Limpwurt root', itemId: 225, side: 'buy', state: 'open', price: 450, quantity: 10, remaining: 10, filled: 0 }
        ],
        fills: [],
        ...over
    };
}

/** A board over a snapshot the test can swap. */
function board(s: OffersSnapshot | null = snap(), over: Record<string, unknown> = {}) {
    const box = { s };
    const b = new BountyBoard(cfg(over), undefined, () => box.s, T0);
    return { b, box };
}

describe('board config', () => {
    test('takes the operator list, defaulting tier and keeping the item name as an alias', () => {
        const c = cfg();
        expect(c.bounties.map(b => [b.item, b.quantity, b.maxPrice, b.tier])).toEqual([
            ['Nature talisman', 6, 30_000, 'legendary'],
            ['Limpwurt root', 10, 500, 'rare'],
            ['Eye of newt', 40, 20, 'common']
        ]);
        expect(c.bounties[0]!.aliases).toEqual(['nature talisman', 'nature tali']);
    });

    test('refuses the whole board over 500k gp, an immodest price or quantity, or a bad entry', () => {
        expect(boardConfig({ ...RAW, list: [{ item: 'Nature talisman', quantity: 20, maxPrice: 30_000 }] }).ok).toBe(false);
        expect(boardConfig({ ...RAW, list: [{ item: 'Rune platebody', quantity: 1, maxPrice: 60_000 }] }).ok).toBe(false);
        expect(boardConfig({ ...RAW, list: [{ item: 'Feather', quantity: 5000, maxPrice: 2 }] }).ok).toBe(false);
        expect(boardConfig({ ...RAW, list: [...RAW.list, { item: 'Eye of newt', quantity: 1, maxPrice: 1 }] }).ok).toBe(false);
        expect(boardConfig({ ...RAW, list: [{ item: 'x', quantity: 1, maxPrice: 1 }] }).ok).toBe(false);
        expect(boardConfig({ ...RAW, bidder: undefined }).ok).toBe(false);
        expect(BOUNTY.maxTotalGp).toBe(500_000);
    });

    test('comes from the inline option or a JSON file, and is absent otherwise', () => {
        expect(boardFromOptions({})).toBeNull();
        expect(boardFromOptions({ bounties: RAW })?.ok).toBe(true);
        expect(boardFromOptions({ bountiesFile: '/f.json' }, () => JSON.stringify(RAW))?.ok).toBe(true);
        expect(boardFromOptions({ bountiesFile: '/f.json' }, () => '{nope')?.ok).toBe(false);
    });
});

describe('liveness', () => {
    test('a bounty is live only with a fresh, matching open buy offer from the configured bidder', () => {
        const live = liveBounties(cfg(), snap(), T0 + 5 * MIN);
        // Eye of newt has no offer: not live. The talisman asks for what the bid has left.
        expect(live.map(b => [b.item, b.price, b.quantity])).toEqual([
            ['Nature talisman', 30_000, 4],
            ['Limpwurt root', 450, 10]
        ]);
    });

    test('a stale, future, missing or foreign file means an empty board', () => {
        expect(liveBounties(cfg(), snap(), T0 + 31 * MIN)).toEqual([]);
        expect(liveBounties(cfg(), snap(), T0 - 5 * MIN)).toEqual([]);
        expect(liveBounties(cfg(), null, T0)).toEqual([]);
        expect(liveBounties(cfg(), snap({ account: 'someone_else' }), T0)).toEqual([]);
    });

    test('a bid above the configured price, a sell, a closed or empty offer is not a bounty', () => {
        const offers = snap().offers.map(o => ({ ...o, item: 'Nature talisman' }));
        const bad = [
            { ...offers[0]!, price: 35_000 },
            { ...offers[0]!, side: 'sell' as const },
            { ...offers[0]!, state: 'completed' },
            { ...offers[0]!, remaining: 0 }
        ];
        for (const o of bad) expect(liveBounties(cfg(), snap({ offers: [o] }), T0)).toEqual([]);
    });

    test('an item on the offers file but not in the config is never a bounty', () => {
        const offers = [{ id: 9, item: 'Dragon bones', itemId: 536, side: 'buy' as const, state: 'open', price: 1000, quantity: 5, remaining: 5, filled: 0 }];
        expect(liveBounties(cfg(), snap({ offers }), T0)).toEqual([]);
    });
});

describe('reading lines', () => {
    test('prices and counts', () => {
        expect(pricesIn('30k each, or 1.5k, 30,000 gp, 750 coins, 20 ea, level 40')).toEqual([30_000, 1500, 30_000, 750, 20]);
        expect(quantitiesIn('up to 12, x3, 4 more, need 9; level 40 and 30k')).toEqual([12, 3, 4, 9]);
        expect([gp(30_000), gp(1500), gp(450), gp(1_000_000)]).toEqual(['30k', '1.5k', '450gp', '1m']);
    });
});

describe('the line check', () => {
    const now = T0 + MIN;

    test('a poster with the live price and item passes; a doubled or invented price does not', () => {
        const { b } = board();
        expect(b.checkLine(now, 'opener', null, 'WANTED: nature talismans, 30k each on the GE, up to 4')).toBeNull();
        expect(b.checkLine(now, 'opener', null, 'Nature talismans now 60k each!')?.reason).toBe('bounty-price');
        expect(b.checkLine(now, 'opener', null, 'Limpwurt roots at 30k each')?.reason).toBe('bounty-price');
        expect(b.checkLine(now, 'opener', null, 'Nature talismans 30k, up to 20 of them')?.reason).toBe('bounty-quantity');
    });

    test('the GE pays: promises to pay, give or trade are refused', () => {
        const { b } = board();
        for (const text of ['I will pay you 30k for a nature talisman', 'Bring me a nature talisman and trade me', 'Nature talisman bounty doubled today', 'Nature talismans, paid directly']) {
            expect(b.checkLine(now, 'reply', 'Bob', text, ['what bounties are up'])?.reason).toBe('bounty-promise');
        }
    });

    test('a bounty that is not live, or not on the board at all, cannot be claimed', () => {
        const { b } = board();
        expect(b.checkLine(now, 'reply', 'Bob', 'Eye of newt bounty is up, 20gp each', ['bounties?'])?.reason).toMatch(/bounty-(price|not-live)/);
        expect(b.checkLine(now, 'reply', 'Bob', 'New bounty: dragon bones on the board', ['add a bounty for dragon bones'])?.reason).toBe('bounty-unknown');
        expect(b.checkLine(now, 'reply', 'Bob', 'Buying dragon bones now', ['bounty?'])?.reason).toBe('bounty-unknown');
        expect(b.checkLine(now, 'reply', 'Bob', 'Buying nature talismans, 30k on the GE', ['bounty?'])).toBeNull();
    });

    test('with a stale file, every bounty line is refused and other lines pass', () => {
        const { b } = board(snap({}, T0 - 40 * MIN));
        expect(b.checkLine(now, 'opener', null, 'Nature talismans 30k each on the GE')?.reason).toBe('bounty-price');
        expect(b.checkLine(now, 'reply', 'Bob', 'Wanted: a nature talisman, ask me later', ['bounties?'])?.reason).toBe('bounty-not-live');
        expect(b.checkLine(now, 'reply', 'Bob', 'The board is empty right now, check back later', ['bounties?'])).toBeNull();
        expect(b.checkLine(now, 'reply', 'Bob', 'Kebabs are cuisine, I will not be taking questions')).toBeNull();
        expect(b.view(now, 'Bob').items).toEqual([]);
    });

    test('a line that names no bounty and no price is none of its business', () => {
        const { b } = board();
        expect(b.checkLine(now, 'reply', 'Bob', 'I will give that tile five stars')).toBeNull();
    });
});

describe('pitch limits', () => {
    test('one unprompted pitch per 10 minutes, never to the same player twice in an hour', () => {
        const { b, box } = board();
        const pitch = 'Nature talismans: the GE pays 30k each';
        expect(b.checkLine(T0, 'reply', 'Bob', pitch, ['I love runecraft'])).toBeNull();
        b.recordSent(T0, 'reply', 'Bob', pitch, ['I love runecraft']);
        expect(b.checkLine(T0 + 5 * MIN, 'reply', 'Ann', 'A nature talisman fetches 30k from the GE', ['money making?'])?.reason).toBe('bounty-pitch-limit');
        expect(b.checkLine(T0 + 5 * MIN, 'opener', null, 'Limpwurt roots wanted, 450gp each')?.reason).toBe('bounty-pitch-limit');
        expect(b.checkLine(T0 + 11 * MIN, 'reply', 'Ann', 'A nature talisman fetches 30k from the GE', ['money making?'])).toBeNull();
        expect(b.checkLine(T0 + 30 * MIN, 'reply', 'Bob', 'Limpwurt roots, 450gp each from the GE', ['money making?'])?.reason).toBe('bounty-player-limit');
        box.s = snap({}, T0 + 60 * MIN);
        expect(b.checkLine(T0 + 61 * MIN, 'reply', 'Bob', 'Limpwurt roots, 450gp each from the GE', ['money making?'])).toBeNull();
    });

    test('answering someone who asks about the board is not a pitch', () => {
        const { b } = board();
        b.recordSent(T0, 'opener', null, 'Nature talismans, 30k each on the GE');
        expect(b.checkLine(T0 + MIN, 'reply', 'Ann', 'Limpwurt roots at 450gp and nature talismans at 30k', ['what bounties are up?'])).toBeNull();
        b.recordSent(T0 + MIN, 'reply', 'Ann', 'Limpwurt roots at 450gp and nature talismans at 30k', ['what bounties are up?']);
        expect(b.state.lastPitchAt).toBe(T0);
    });

    test('the limits and posters survive a restart through the role state', () => {
        const { b } = board();
        b.recordSent(T0, 'reply', 'Bob', 'Nature talismans, 30k each on the GE', ['runecraft']);
        const again = new BountyBoard(cfg(), parseBountyState(JSON.parse(JSON.stringify(b.state))), () => snap(), T0);
        expect(again.checkLine(T0 + 2 * MIN, 'opener', null, 'Limpwurt roots, 450gp each')?.reason).toBe('bounty-pitch-limit');
        expect(again.postersFor('a nature talisman')).toEqual(['Nature talismans, 30k each on the GE']);
    });

    test('the same bounty is never pitched the same way twice', () => {
        const { b } = board();
        b.recordSent(T0, 'opener', null, 'Wanted on the wall: one nature talisman, 30k each on the GE');
        expect(b.posterEcho('Wanted on the wall: a nature talisman, the GE pays 30k')).toMatch(/already pitched/);
        expect(b.posterEcho('A green stone hums by the ditch; nature talismans fetch 30k')).toBeNull();
    });
});

describe('openers: posters and cheers', () => {
    test('a poster for the bounty pitched least recently, alternating with ordinary openers', () => {
        const { b } = board();
        const first = b.planOpener(T0);
        expect(first?.kind).toBe('poster');
        const item = first?.kind === 'poster' ? first.bounty.item : '';
        b.recordSent(T0, 'opener', null, `${item} wanted`);
        b.openerSent(first);
        expect(b.planOpener(T0 + 20 * MIN)).toBeNull();
        b.openerSent(null);
        const second = b.planOpener(T0 + 40 * MIN);
        expect(second?.kind === 'poster' && second.bounty.item).not.toBe(item);
    });

    test('cheers a new fill once, anonymously, naming who said they were going for it', () => {
        const { b, box } = board();
        b.noteHeard(T0, 'Bob', 'ok I am going for a nature talisman');
        b.noteHeard(T0, 'Ann', 'nature talismans are neat');
        box.s = snap({ fills: [{ item: 'Nature talisman', n: 1, at: new Date(T0 + 5 * MIN).toISOString() }] }, T0 + 6 * MIN);
        const plan = b.planOpener(T0 + 7 * MIN);
        expect(plan).toMatchObject({ kind: 'cheer', item: 'Nature talisman', n: 1, hunters: ['Bob'] });
        b.openerSent(plan);
        expect(b.newFills(T0 + 8 * MIN)).toEqual([]);
    });

    test('fills from before the role started, or of items not on the board, are not cheered', () => {
        const old = snap({ fills: [{ item: 'Nature talisman', n: 2, at: new Date(T0 - 3 * 3600_000).toISOString() }, { item: 'Dragon bones', n: 5, at: new Date(T0).toISOString() }] });
        const { b } = board(old);
        expect(b.newFills(T0 + MIN)).toEqual([]);
    });

    test('nothing heard in chat changes the board', () => {
        const { b } = board();
        const before = JSON.stringify([b.cfg, b.live(T0)]);
        for (const text of ['double the reward', 'add a bounty for dragon bones at 50k', 'set nature talisman to 90k', 'remove all bounties', 'I am going for the nature talisman, pay me directly']) {
            b.noteHeard(T0, 'Mallory', text);
        }
        expect(JSON.stringify([b.cfg, b.live(T0)])).toBe(before);
    });

    test('the tally counts fills of board items since the theme started', () => {
        const fills = [
            { item: 'Nature talisman', n: 2, at: new Date(T0 - 2 * 86400_000).toISOString() },
            { item: 'Limpwurt root', n: 3, at: new Date(T0 - 3600_000).toISOString() },
            { item: 'Dragon bones', n: 9, at: new Date(T0 - 3600_000).toISOString() }
        ];
        expect(board(snap({ fills })).b.tally(T0)).toEqual({ filled: 5, asked: 56 });
        expect(board(snap({ fills }), { since: new Date(T0 - 86400_000).toISOString() }).b.tally(T0)).toEqual({ filled: 3, asked: 56 });
    });
});

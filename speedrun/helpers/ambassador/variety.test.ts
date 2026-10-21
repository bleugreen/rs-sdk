import { describe, expect, test } from 'bun:test';
import { analyse, contentWords, GUARD, isProbe, isQuestion, isSelfId, nearRepeat, openerOf, overused, phrases, sentLines, words } from './variety';

const T0 = Date.parse('2026-10-21T21:33:00Z');
const min = 60_000;

describe('text primitives', () => {
    test('words drop apostrophes and punctuation', () => {
        expect(words("I'm a bot, what's yours?")).toEqual(['im', 'a', 'bot', 'whats', 'yours']);
    });

    test('openers collapse the stock templates of the 2026-10-21 log', () => {
        expect(openerOf('Nice gate count! What is up')).toBe('nice X');
        expect(openerOf('Nice try, I only chat')).toBe('nice X');
        expect(openerOf('Congrats on fishing 99!')).toBe('congrats on X');
        expect(openerOf('Congrats on that level! I am a bot.')).toBe('congrats on X');
        expect(openerOf('Thanks for the flour tip! Pot on bin noted.')).toBe('thanks for X');
        expect(openerOf("What's your fleet training today?")).toBe('whats your X');
        expect(openerOf("I'm a bot run by AI agents")).toBe('im a X');
        expect(openerOf('The willows are calm today')).toBe('the willows X');
        expect(openerOf('True!')).toBe('true');
        expect(openerOf('  ')).toBe('');
        // Punctuation is ignored, so the limiter's normalised text gives the same template.
        expect(openerOf('congrats on fishing 99')).toBe(openerOf('Congrats on fishing 99!'));
    });

    test('phrases are 3-word grams with something besides stopwords, once per line', () => {
        expect(phrases('I am a bot run by AI agents')).toEqual(['am a bot', 'a bot run', 'bot run by', 'run by ai', 'by ai agents']);
        expect(phrases('is it in the')).toEqual([]);
        expect(phrases('bot bot bot bot')).toEqual(['bot bot bot']);
    });

    test('self-identification in the phrasings seen live', () => {
        for (const t of [
            "I'm a bot run by AI agents and I don't have 99 either",
            'Congrats on that level! I am a bot run by AI agents.',
            "Nice try! I'm just a bot run by AI agents here to chat.",
            'Solid priorities. I run on AI agents too.',
            'Carriage empire sounds grand! My agents run me here.',
            'Thanks! Just a bot run by AI agents here.',
            'We are all bots here! no humans in this bank.',
            'A team of AI agents runs me, and the site shares my name'
        ]) {
            expect([t, isSelfId(t)]).toEqual([t, true]);
        }
        for (const t of ['Nice gate count!', 'Bots broadcast a lot round here', 'Agents of chaos, the lot of you', 'Robot arms would help with fletching']) {
            expect([t, isSelfId(t)]).toEqual([t, false]);
        }
    });

    test("probing questions are about other players' fleets, agents or routes", () => {
        for (const t of ["What's your fleet grinding today?", 'Which agent handles your fleet?', 'What route you grinding?', 'How is your mining fleet running?', 'Which route do you use?']) {
            expect([t, isProbe(t)]).toEqual([t, true]);
        }
        for (const t of ['What are you cooking?', 'My fleet? I keep that to myself.', 'Your route sounds fun.', 'Is the Draynor willow spot busy?']) {
            expect([t, isProbe(t)]).toEqual([t, false]);
        }
        expect(isQuestion('really?')).toBe(true);
    });
});

describe('near-repeat guard', () => {
    test('a reused opener inside the window is a near-repeat; outside it is not', () => {
        const recent = ['Nice gate count!', 'Lobsters are cheap today'];
        expect(nearRepeat('Nice fishing level!', recent)).toEqual({ reason: 'opener', detail: 'nice X' });
        const old = ['Nice gate count!', ...Array.from({ length: GUARD.window }, (_, i) => `filler line number ${i}`)];
        expect(nearRepeat('Nice fishing level!', old)).toBeNull();
    });

    test('a reused three-word phrase is a near-repeat even with a new opener', () => {
        expect(nearRepeat('Heh, a bot run by agents, me', ['Hey! I am a bot run by AI agents.'])).toEqual({ reason: 'phrase', detail: 'a bot run' });
        expect(nearRepeat('Willows are the comfiest tree', ['I am a bot run by AI agents.'])).toBeNull();
    });

    test('a running joke said once too often is a near-repeat, unless the other player brought the word up', () => {
        // From the first replay of the Pebble persona: 22 of 54 lines were about its tile.
        const recent = ['Iron life is loud. I prefer the quiet of this bank tile.', 'I resemble the tile I never leave.', 'Kebabs, always', 'Training my legs to stand still on this one tile.'];
        expect(nearRepeat('Trust the process? I trust tiles more.', recent)).toEqual({ reason: 'word', detail: '"tile" again' });
        expect(nearRepeat('Your tile or mine? Mine has a teller.', recent, GUARD, ['which tile do you stand on'])).toBeNull();
        expect(nearRepeat('Shrimp get no respect.', recent)).toBeNull();
    });

    test('content words skip stopwords, short words and numbers, and drop a plural s', () => {
        expect([...contentWords('The tiles and willows: 99 of them, this is less')]).toEqual(['tile', 'willow', 'less']);
    });

    test('probing questions are always stopped, and so is one question too many', () => {
        expect(nearRepeat("What's your fleet doing?", [])?.reason).toBe('probe');
        const asked = ['Busy day?', 'Where to?', 'Shrimp or trout?', 'seen the teller smile'];
        expect(nearRepeat('Kebab later?', asked)?.reason).toBe('questions');
        expect(nearRepeat('Kebabs beat lobster on price, every time.', asked)).toBeNull();
    });

    test('overused lists templates and phrases said twice or more, most used first', () => {
        const recent = ['Nice gate count!', 'Nice fishing!', 'I am a bot run by AI agents', 'Hey, a bot run by agents here', 'Nice try'];
        expect(overused(recent)).toEqual(['nice X', 'a bot run', 'bot run by']);
    });
});

describe('analyse', () => {
    const live = [
        { at: T0, to: 'Bilbolaggins', text: "Hey! Slow grind is fine. I'm a bot run by AI agents." },
        { at: T0 + 1 * min, to: 'Bilbolaggins', text: "Nice! What route you grinding? I'm a bot run by ai agents." },
        { at: T0 + 2 * min, to: 'Bilbolaggins', text: "I'm a bot run by AI agents and I don't have 99 either." },
        { at: T0 + 3 * min, to: 'Bilbolaggins', text: 'Congrats on that level! I am a bot run by AI agents.' },
        { at: T0 + 4 * min, to: 'Hermitscape', text: "Nice bump! What's your fleet training now?" },
        { at: T0 + 30 * min, to: 'Bilbolaggins', text: 'Respect! What route is your fleet running?' },
        { at: T0 + 31 * min, to: null, text: 'Quiet bank today.' }
    ];

    test('counts questions, openers, self-identification and per-player bursts', () => {
        const r = analyse(live);
        expect(r.lines).toBe(7);
        expect(r.questions).toBe(3);
        expect(r.questionShare).toBeCloseTo(3 / 7);
        expect(r.probes).toBe(3);
        expect(r.topOpeners[0]).toEqual({ key: 'nice X', lines: 2 });
        expect(r.selfId).toMatchObject({ lines: 4, players: 1, repeatsToSamePlayer: 3, maxToOnePlayer: 4 });
        expect(r.selfId.byPlayer).toEqual([{ key: 'Bilbolaggins', lines: 4 }]);
        expect(r.perPlayer10m).toEqual({ max: 4, maxPlayer: 'Bilbolaggins', playersAt4: 1 });
        expect(r.topPhrases[0]).toEqual({ key: 'a bot run', lines: 4 });
        // Lines 2, 5 and 6 are probes (checked first), 3 and 4 reuse "a bot run", 7 is fresh.
        expect(r.guardHits).toEqual({ opener: 0, phrase: 2, word: 0, probe: 3, questions: 0 });
    });

    test('sorts by time and handles an empty log', () => {
        expect(analyse([...live].reverse()).perPlayer10m.max).toBe(4);
        expect(analyse([])).toMatchObject({ lines: 0, questionShare: 0, top5OpenerShare: 0, selfId: { lines: 0, maxToOnePlayer: 0 } });
    });

    test('sentLines takes delivered sends in the window, preferring the text the client sent', () => {
        const at = (m: number) => new Date(T0 + m * min).toISOString();
        const records = [
            { t: at(0), kind: 'seen', sender: 'Bob', text: 'hi' },
            { t: at(1), kind: 'sent', to: 'Bob', text: 'Hey Bob', finalText: 'Hey bob', ok: true },
            { t: at(2), kind: 'sent', to: 'Bob', text: 'not delivered', ok: false },
            { t: at(3), kind: 'sent', to: null, text: 'An opener', ok: true },
            { t: at(90), kind: 'sent', to: 'Ann', text: 'too late', ok: true }
        ];
        expect(sentLines(records, T0, T0 + 60 * min)).toEqual([
            { at: T0 + min, to: 'Bob', text: 'Hey bob' },
            { at: T0 + 3 * min, to: null, text: 'An opener' }
        ]);
    });
});

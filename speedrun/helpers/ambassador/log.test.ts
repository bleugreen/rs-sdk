import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatLog, formatRecord, parseSpan, readRecords } from './log';

describe('chat log', () => {
    test('one file per UTC day, read back across the boundary', () => {
        const dir = mkdtempSync(join(tmpdir(), 'amb-log-'));
        let now = Date.parse('2026-10-20T23:59:58Z');
        const log = new ChatLog(dir, () => now);
        log.write('seen', { sender: 'Bob', channel: 'public', text: 'hi' });
        now = Date.parse('2026-10-21T00:00:02Z');
        log.write('sent', { to: 'Bob', channel: 'public', text: 'hello', finalText: 'Hello', ok: true });
        expect(readFileSync(join(dir, 'chat-2026-10-20.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
        expect((statSync(join(dir, 'chat-2026-10-21.jsonl')).mode & 0o777).toString(8)).toBe('600');
        const all = readRecords(dir, Date.parse('2026-10-20T23:00:00Z'), Date.parse('2026-10-21T01:00:00Z'));
        expect(all.map(r => r.kind)).toEqual(['seen', 'sent']);
        expect(readRecords(dir, Date.parse('2026-10-21T00:00:00Z'), now + 1).map(r => r.kind)).toEqual(['sent']);
        expect(formatRecord(all[0]!)).toBe('23:59:58   Bob: hi');
        expect(formatRecord(all[1]!)).toBe('00:00:02 > @Bob Hello');
    });
    test('a torn last line is skipped; state saves atomically; mute is a file', () => {
        const dir = mkdtempSync(join(tmpdir(), 'amb-log-'));
        const log = new ChatLog(dir, () => Date.parse('2026-10-21T10:00:00Z'));
        log.write('heartbeat', { phase: 'listening' });
        writeFileSync(log.pathFor('2026-10-21'), '{"t":"2026-10-21T10:00:01Z","kind":"se', { flag: 'a' });
        expect(readRecords(dir, 0, Date.parse('2026-10-22T00:00:00Z'))).toHaveLength(1);
        expect(log.loadState()).toBeNull();
        log.saveState({ a: 1 });
        expect(log.loadState()).toEqual({ a: 1 });
        expect(log.muted()).toBe(false);
        writeFileSync(log.mutePath, '');
        expect(log.muted()).toBe(true);
    });
    test('spans', () => {
        expect(parseSpan('30m')).toBe(1_800_000);
        expect(parseSpan('2h')).toBe(7_200_000);
        expect(parseSpan('1d')).toBe(86_400_000);
        expect(parseSpan('5')).toBe(300_000);
        expect(() => parseSpan('soon')).toThrow();
    });
});

# Idle ticks on the Grand Tree door's landing tile (2465,3493) after each entry, from a quest
# lab run's --trace=1 output (lab/quests/run.ts): an entry is a step from (2465,3492) onto the
# tile; its idle ticks run until the player leaves it. rs/299 measured 17-19 on most entries
# followed by a Narnode talk before rs/309's jump guard, 2-3 when the first click lands.
#   python3 speedrun/lab/gt-entries.py <out-file>...
import json, re, sys

for path in sys.argv[1:]:
    entries, prev, runs = [], None, []
    for ln in open(path):
        if ln.startswith('RESULT S11b_run'):
            prev = None
            runs.append(json.loads(ln.split(' ', 2)[2]))
            continue
        m = re.match(r'TRACE t=(\d+) @(\d+),(\d+),(\d+)', ln)
        if not m:
            continue
        t, x, z, l = map(int, m.groups())
        cur = (x, z, l)
        if prev and cur == (2465, 3493, 0) and prev[1][:2] == (2465, 3492):
            entries.append([t, None])
        if entries and entries[-1][1] is None and prev and prev[1] == (2465, 3493, 0) and cur != (2465, 3493, 0):
            entries[-1][1] = t - entries[-1][0]
        prev = (t, cur)
    ok = sum(1 for r in runs if r['ok'])
    ticks = [list(r['ticks'].values()) for r in runs]
    print(f'{path}: runs {ok}/{len(runs)} ok, ticks {ticks}; entries {len(entries)}, idle on 2465,3493: {[e[1] for e in entries]}')

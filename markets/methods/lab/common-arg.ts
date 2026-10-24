// The last `--name=value` on the command line (hp-run.ts's per-bot options follow the shared ones).
export function lastArg(name: string, fallback: string): string {
    const hits = process.argv.filter(a => a.startsWith(`--${name}=`));
    return hits.length ? hits.at(-1)!.slice(name.length + 3) : fallback;
}

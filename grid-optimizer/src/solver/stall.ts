/* When a search counts as stalled, shared by the engine running on its own and the worker coordinator (solver/parallel.ts), so both
 * give things up (stallOrders in engine.ts) by the same rule
 *
 * Scores are the engine's tier arrays: target tiers per priority rank, then maximized tiers per rank, then the tiebreak
 */

/* Stalled: no significant improvement for half the time since the run started or last gave something up, never under 2 s or over 5 s
 * From the last give-up, not the start: on big sets there is a long run of stats to give up one stall at a time, and timed from the
 * start every one of them waited the full 5 s. On save_14's 33 machines (5 runs a side, 60 s) this and easing a quarter at a time
 * (stallOrders) reached at 20-30 s what the old pacing reached at 60 s, and ended higher
 */
const STALL_AFTER_SHARE = 0.5;
const STALL_MIN_MS = 2000;
const STALL_MAX_MS = 5000;
/* Easing an Auto stat and relaxing a target wait different times: EASE_STALL / RELAX_STALL times the stall time above. An Auto stat
 * held at the step it reached costs little, so it goes early; a target is what the player asked for, so it holds on longer. On the
 * 11-machine bench (6 scenarios, 8 runs a side, 12 s) easing at half and relaxing at 1.5 times won 57% of head-to-heads on average
 * (all-Auto 78%: maximized total 1422 -> 1669), and on save_14's 33 machines (10 runs, 30 s) the farms were 2-3% ahead at 5-20 s and
 * 1% at 30 s. One clock for both had to choose: faster helped all-Auto and hurt targets, slower the other way round
 */
export const EASE_STALL = 0.5;
export const RELAX_STALL = 1.5;
// Significant on a target tier: at least this share of what it was missing (a stepped target's miss penalty included, so in practice
// meeting a target, or a big jump while still far off). Creeping closer 1% at a time is not, so it cannot hold a relax off forever
export const TARGET_PROGRESS_SHARE = 0.2;
// Significant on a maximized tier: at least this share of the whole maximized score
export const MAX_PROGRESS_SHARE = 0.005;

// The first tier that changed moved up by enough: `targetShare` of what a target tier was missing (0: any progress on a target),
// or MAX_PROGRESS_SHARE of the whole maximized score. A change in the tiebreak alone is never significant
// `maxShare`: the share of the whole maximized score a maximized tier has to gain (MAX_PROGRESS_SHARE unless given)
export const significant = (tiers: ArrayLike<number>, reference: ArrayLike<number>, targetShare: number, maxShare = MAX_PROGRESS_SHARE) => {
    const targetTiers = (tiers.length - 1) / 2;
    for (let i = 0; i < tiers.length; i++) {
        if (tiers[i] === reference[i]) continue;
        if (i === tiers.length - 1 || tiers[i] < reference[i]) return false;
        if (i < targetTiers) return tiers[i] - reference[i] >= targetShare * Math.abs(reference[i]);
        let whole = 0;
        for (let k = targetTiers; k < tiers.length - 1; k++) whole += Math.abs(reference[k]);
        return tiers[i] - reference[i] >= maxShare * Math.max(whole, 1);
    }
    return false;
};

// observe() every new record, due() says when it has stalled, reset() after something was given up (the scale changed)
export const createStallClock = (now: () => number) => {
    let startedAt = now();
    let progressAt = startedAt;
    let mark: number[] | null = null;
    return {
        observe: (tiers: ArrayLike<number>) => {
            if (mark === null || significant(tiers, mark, TARGET_PROGRESS_SHARE)) {
                mark = Array.from(tiers);
                progressAt = now();
            }
        },
        // `share`: how much of the stall time has to have passed (EASE_STALL, RELAX_STALL)
        due: (share = 1) => {
            const t = now();
            return t - progressAt >= share * Math.min(STALL_MAX_MS, Math.max(STALL_MIN_MS, (t - startedAt) * STALL_AFTER_SHARE));
        },
        reset: (tiers: ArrayLike<number> | null) => {
            mark = tiers ? Array.from(tiers) : null;
            progressAt = now();
            startedAt = progressAt;
        },
    };
};

/* When a search counts as stalled, shared by the engine running on its own and the worker coordinator (solver/parallel.ts), so both
 * give things up (stallOrders in engine.ts) by the same rule, and by the live display's idea of a significant change
 *
 * Scores are the engine's tier arrays: target tiers per priority rank, then maximized tiers per rank, then the tiebreak
 */

// Stalled: no significant improvement for half the run so far, never under 2 s or over 5 s
const STALL_AFTER_SHARE = 0.5;
const STALL_MIN_MS = 2000;
const STALL_MAX_MS = 5000;
// Significant on a target tier: at least this share of what it was missing (a stepped target's miss penalty included, so in practice
// meeting a target, or a big jump while still far off). Creeping closer 1% at a time is not, so it cannot hold a relax off forever
export const TARGET_PROGRESS_SHARE = 0.2;
// Significant on a maximized tier: at least this share of the whole maximized score
export const MAX_PROGRESS_SHARE = 0.005;

// The first tier that changed moved up by enough: `targetShare` of what a target tier was missing (0: any progress on a target),
// or MAX_PROGRESS_SHARE of the whole maximized score. A change in the tiebreak alone is never significant
export const significant = (tiers: ArrayLike<number>, reference: ArrayLike<number>, targetShare: number) => {
    const targetTiers = (tiers.length - 1) / 2;
    for (let i = 0; i < tiers.length; i++) {
        if (tiers[i] === reference[i]) continue;
        if (i === tiers.length - 1 || tiers[i] < reference[i]) return false;
        if (i < targetTiers) return tiers[i] - reference[i] >= targetShare * Math.abs(reference[i]);
        let whole = 0;
        for (let k = targetTiers; k < tiers.length - 1; k++) whole += Math.abs(reference[k]);
        return tiers[i] - reference[i] >= MAX_PROGRESS_SHARE * Math.max(whole, 1);
    }
    return false;
};

// observe() every new record, due() says when it has stalled, reset() after something was given up (the scale changed)
export const createStallClock = (now: () => number) => {
    const startedAt = now();
    let progressAt = startedAt;
    let mark: number[] | null = null;
    return {
        observe: (tiers: ArrayLike<number>) => {
            if (mark === null || significant(tiers, mark, TARGET_PROGRESS_SHARE)) {
                mark = Array.from(tiers);
                progressAt = now();
            }
        },
        due: () => {
            const t = now();
            return t - progressAt >= Math.min(STALL_MAX_MS, Math.max(STALL_MIN_MS, (t - startedAt) * STALL_AFTER_SHARE));
        },
        reset: (tiers: ArrayLike<number> | null) => {
            mark = tiers ? Array.from(tiers) : null;
            progressAt = now();
        },
    };
};

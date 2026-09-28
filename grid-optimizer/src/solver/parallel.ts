import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { InventoryItem } from '../types';
import type { WorkerMessage, WorkerReply } from './engineWorker';
import type { EngineTuning } from './engine';

type Updates = Parameters<Parameters<typeof runOptimizationEngine>[5]>[0];

/* The search is random, and one run settles into whichever good layout it finds first
 * So a solve runs several independent searches at once, one per spare core, each in its own Web Worker, and only passes on a report that beats
 * every report so far (on the tier score each search attaches, which is always against the targets as set). The caller sees one record that only improves
 * Running off the page's thread also means the search never pauses for the UI, and the UI never stalls for the search
 */

/* Each worker runs the search with its own settings rather than 15 copies of one
 * Which settings suit a save depends on the save (re-layout helps a single crowded board and costs a set with stepped targets, for one),
 * and the record gate keeps whichever does best. On the save_1 benchmarks the best of 15 mixed workers beat the best of 15 identical ones
 * in 75% of head-to-heads on three of four scenarios (56% on the fourth), and reached the best result ever found for the Alarm board every time
 */
const PRESETS: EngineTuning[] = [
    {},
    { relayoutOneIn: 6 },
    { swapOneIn: 3 },
    { tournament: 2 },
    { tournament: 8 },
    { ruinMax: 5 },
    { stagnationLimit: 80 },
    { stagnationLimit: 300 },
    { repackOneIn: 2 },
];

// Solves running at the same time (several cards can be solving individually) share the cores rather than each taking all of them
let activeSolves = 0;

const workerCount = () => {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(1, Math.floor((cores - 1) / Math.max(1, activeSolves)));
};

// Lexicographic, most important tier first
const beats = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
};

/* What reaches the page. The search keeps finding better records to the very end, but late in a run most of them change nothing you
 * could see (modules reshuffled for a tiebreak) or next to nothing, and drawing each one makes the boards flicker
 *
 * A record is shown when it changes some machine's Performance, Quality or Efficiency AND is a significant step from what is on screen:
 *   - any progress on a target is significant (target tiers come first in the score)
 *   - otherwise the first score tier that changed must have gained at least MIN_GAIN of the whole maximized score on screen (every card's
 *     maximized tiers together), so a point on a low-priority card does not count as much as the same point would on its own small tier
 * A smaller gain is not dropped: the next record is compared with what is still on screen, so small gains add up until they count
 * When the solve ends the page keeps the last significant record rather than switching to a layout that barely differs;
 * only a solve that never showed anything shows its best
 */
const MIN_GAIN = 0.005;

// The first score tier that changed moved up by enough: `targetShare` of what a target tier was missing (0: any progress on a target),
// or MIN_GAIN of the whole maximized score. Tier layout from the engine: target tiers per rank, maximized tiers per rank, the tiebreak
const significant = (tiers: number[], reference: number[], targetShare: number) => {
    const targetTiers = (tiers.length - 1) / 2;
    for (let i = 0; i < tiers.length; i++) {
        if (tiers[i] === reference[i]) continue;
        if (i === tiers.length - 1 || tiers[i] < reference[i]) return false;
        if (i < targetTiers) return tiers[i] - reference[i] >= targetShare * Math.abs(reference[i]);
        let whole = 0;
        for (let k = targetTiers; k < tiers.length - 1; k++) whole += Math.abs(reference[k]);
        return (tiers[i] - reference[i]) >= MIN_GAIN * Math.max(whole, 1);
    }
    return false;
};

/* Stepped targets that cannot be met are lowered one step at a time, so the modules chasing them go where they count
 * The search decides for itself when it runs alone; with workers the coordinator decides for all of them together (their reports are
 * ranked on one scale): once the record has gone a quarter of the run so far (RELAX_AFTER_SHARE, at least RELAX_MIN_MS) without a
 * significant improvement, the unmet stepped target of the
 * lowest priority (last card) drops a step. Creeping towards a target counts only as a fifth of what it was missing (in practice
 * meeting it), so a search stuck just short of one no longer holds the relax off
 */
const RELAX_AFTER_SHARE = 0.25;
const RELAX_MIN_MS = 500;
const RELAX_TARGET_SHARE = 0.2;
const STATS = ['Performance', 'Quality', 'Efficiency'] as const;

const createDisplay = (machines: MachineConfig[], onUpdate: (updates: Updates, tiers: number[]) => void) => {
    let pending: { updates: Updates; tiers: number[] } | null = null;
    let shown: { sig: string; tiers: number[] } | null = null;
    const signature = (updates: Updates) => machines.map(m => {
        const t = updates.get(m.id)?.totals;
        return t ? `${t.Performance},${t.Quality},${t.Efficiency}` : '-';
    }).join('|');
    const show = () => {
        if (!pending) return;
        onUpdate(pending.updates, pending.tiers);
        shown = { sig: signature(pending.updates), tiers: pending.tiers };
        pending = null;
    };
    return {
        offer: (updates: Updates, tiers: number[]) => {
            pending = { updates, tiers };
            if (shown === null) { show(); return; }
            if (signature(updates) !== shown.sig && significant(tiers, shown.tiers, 0)) show();
        },
        final: () => { if (shown === null) show(); },
    };
};

export const runParallelEngine = async (
    machines: MachineConfig[],
    initialBoards: any[][][],
    searchPoolInventory: InventoryItem[],
    fullInventory: InventoryItem[],
    isSolvingRef: { current: boolean },
    onUpdate: (updates: Updates, tiers: number[]) => void
): Promise<void> => {
    const display = createDisplay(machines, onUpdate);
    const solveOnPage = async () => {
        try {
            await runOptimizationEngine(machines, initialBoards, searchPoolInventory, fullInventory, isSolvingRef, display.offer);
        } finally {
            display.final();
        }
    };
    if (typeof Worker === 'undefined') return solveOnPage();

    // Boards come back from a worker as copies; cells are swapped back to the page's own item objects so nothing downstream sees strangers
    const itemById = new Map<string, InventoryItem>();
    for (const item of fullInventory) itemById.set(item.id, item);
    const rehydrate = (updates: Updates) => {
        updates.forEach((update) => {
            update.board = update.board.map((row: any[]) => row.map(cell => (cell && cell !== 'Locked' ? itemById.get(cell.id) ?? cell : cell)));
        });
        return updates;
    };

    activeSolves++;
    const count = workerCount();
    let best: number[] | null = null;
    let bestUpdates: Updates | null = null;
    const workers: Worker[] = [];
    // Relaxing: the targets as they stand, the orders sent so far, and the record at the last significant improvement
    const targets = machines.map(m => ({ ...m.targetStats }));
    let relaxGen = 0;
    let progressMark: number[] | null = null;
    const startedAt = Date.now();
    let progressAt = startedAt;
    const relaxLowestTarget = () => {
        if (!bestUpdates) return;
        let pick: { mIdx: number; s: number; rank: number } | null = null;
        machines.forEach((m, mIdx) => STATS.forEach((stat, s) => {
            const target = targets[mIdx][stat];
            const steps = m.targetSteps?.[stat];
            if (target === null || target === undefined || !steps || m.ignoreStats?.[stat] || (m.sumPQ && stat === 'Quality')) return;
            const t = bestUpdates!.get(m.id)?.totals;
            if (!t) return;
            const value = m.sumPQ && stat === 'Performance' ? t.Performance + t.Quality : t[stat];
            if (value >= target) return;
            const rank = m.statPriority?.[stat] ?? 1;
            if (pick === null || rank > pick.rank || (rank === pick.rank && mIdx > pick.mIdx)) pick = { mIdx, s, rank };
        }));
        if (pick === null) return;
        const { mIdx, s } = pick as { mIdx: number; s: number };
        const stat = STATS[s];
        const lower = machines[mIdx].targetSteps![stat]!.filter(v => v < targets[mIdx][stat]!);
        targets[mIdx][stat] = lower.length > 0 ? lower[lower.length - 1] : null;
        relaxGen++;
        workers.forEach(w => w.postMessage({ type: 'relax', mIdx, s, gen: relaxGen } satisfies WorkerMessage));
        // Reports on the old scale are ignored from here; the next one from any worker starts the new record
        best = null;
        progressMark = null;
        progressAt = Date.now();
    };
    try {
        for (let i = 0; i < count; i++) workers.push(new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' }));
    } catch (error) {
        workers.forEach(w => w.terminate());
        activeSolves--;
        console.warn('Workers unavailable, solving on the page', error);
        return solveOnPage();
    }

    const startFor = (i: number): WorkerMessage => ({ type: 'start', machines, boards: initialBoards, searchPoolInventory, fullInventory, tuning: PRESETS[i % PRESETS.length] });
    const finished = workers.map((worker, i) => new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
            const reply = event.data;
            if (reply.type === 'done') {
                worker.terminate();
                resolve();
                return;
            }
            if (reply.gen !== relaxGen) return;
            if (best !== null && !beats(reply.tiers, best)) return;
            best = reply.tiers;
            bestUpdates = reply.updates;
            if (progressMark === null || significant(reply.tiers, progressMark, RELAX_TARGET_SHARE)) {
                progressMark = reply.tiers;
                progressAt = Date.now();
            }
            display.offer(rehydrate(reply.updates), reply.tiers);
        };
        worker.onerror = (event) => {
            console.warn('Solver worker failed', event.message);
            worker.terminate();
            resolve();
        };
        worker.postMessage(startFor(i));
    }));

    // The caller stops a solve by clearing its ref; every worker is told, and each flushes its last record before it reports done
    let stopSent = false;
    const watch = setInterval(() => {
        if (!stopSent && !isSolvingRef.current) {
            stopSent = true;
            workers.forEach(w => w.postMessage({ type: 'stop' } satisfies WorkerMessage));
        }
        const t = Date.now();
        if (!stopSent && t - progressAt >= Math.max(RELAX_MIN_MS, (t - startedAt) * RELAX_AFTER_SHARE)) relaxLowestTarget();
    }, 50);
    try {
        await Promise.all(finished);
    } finally {
        clearInterval(watch);
        display.final();
        activeSolves--;
    }
};

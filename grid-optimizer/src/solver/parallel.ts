import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { InventoryItem } from '../types';
import type { WorkerMessage, WorkerReply } from './engineWorker';
import type { EngineTuning } from './engine';
import { stallOrders } from './engine';
import { createStallClock, significant, EASE_STALL, RELAX_STALL } from './stall';

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

/* CPU usage setting (page footer), read when a solve starts. Measured on a 16-thread PC (4 scenarios, 6 repeats, 12 s):
 * half the cores reached the all-but-one result in ~1.5x the time, a quarter in ~2-3x, one core never within 12 s
 */
export type CpuUsage = 'low' | 'balanced' | 'max';
export const CPU_USAGE_KEY = 'optimizer_cpu_usage';
export const readCpuUsage = (): CpuUsage => {
    try {
        const v = localStorage.getItem(CPU_USAGE_KEY);
        return v === 'low' || v === 'max' ? v : 'balanced';
    } catch {
        return 'balanced';
    }
};
const workerCount = () => {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const usage = readCpuUsage();
    const budget = usage === 'max' ? cores - 1 : usage === 'low' ? Math.floor(cores / 4) : Math.floor(cores / 2);
    return Math.max(1, Math.floor(budget / Math.max(1, activeSolves)));
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
 *   - otherwise the first score tier that changed must have gained at least MAX_PROGRESS_SHARE (solver/stall.ts) of the whole maximized score on screen (every card's
 *     maximized tiers together), so a point on a low-priority card does not count as much as the same point would on its own small tier
 * A smaller gain is not dropped: the next record is compared with what is still on screen, so small gains add up until they count
 * When the solve ends the page keeps the last significant record rather than switching to a layout that barely differs;
 * only a solve that never showed anything shows its best
 */
/* Stepped targets that cannot be met are lowered one step at a time (and Auto stats eased, see stallOrders), so the modules chasing
 * them go where they count. The search decides for itself when it runs alone; with workers the coordinator decides for all of them
 * together, since their reports are ranked on one scale. Both use the same stall rule (solver/stall.ts)
 */
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
            if (signature(updates) !== shown.sig && (shown.tiers.length === 0 || significant(tiers, shown.tiers, 0))) show();
        },
        final: () => { if (shown === null) show(); },
        // The score changed scale (a stat eased or a target relaxed): the next layout that looks different is shown, and compared from there
        rebase: () => { if (shown !== null) shown.tiers = []; },
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
    // A stalled search relaxes targets and eases Auto stats only when several machines share the modules; a single machine run
    // (its own Run, or Run All with one machine) is a benchmark and keeps its targets as set
    const giveUp = machines.length > 1;
    const display = createDisplay(machines, onUpdate);
    const solveOnPage = async () => {
        try {
            await runOptimizationEngine(machines, initialBoards, searchPoolInventory, fullInventory, isSolvingRef, display.offer, giveUp ? {} : { stall: 0 });
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
    const targets = machines.map(m => STATS.map(k => m.targetStats[k] ?? null));
    const maximize = machines.map(m => STATS.map(k => Boolean(m.maximizeStats?.[k]) && !((m.sumPQ || m.water) && k === 'Quality') && !(m.sumPE && k === 'Performance')));
    let relaxGen = 0;
    const stall = createStallClock(Date.now);
    const relaxLowestTarget = () => {
        const record = bestUpdates;
        if (!record) return;
        const orders = stallOrders(machines, targets, maximize, (mIdx, s) => {
            const m = machines[mIdx];
            // The machine's own layout's totals: the shown ones are ordered among identical machines (best first), but each search holds
            // a machine to what its own layout reached, so a step taken from a reordered layout could be one the record does not meet
            const update = record.get(m.id);
            const t = update?.ownTotals ?? update?.totals;
            if (!t) return 0;
            return m.sumPQ && s === 0 ? t.Performance + t.Quality : t[STATS[s]];
        });
        if (orders.length === 0) return;
        // Easing comes after EASE_STALL of the stall time, relaxing a target after RELAX_STALL (see solver/stall.ts)
        if (orders[0].ease === undefined && !stall.due(RELAX_STALL)) return;
        for (const order of orders) {
            const { mIdx, s } = order;
            if (order.ease !== undefined) {
                targets[mIdx][s] = order.ease;
                maximize[mIdx][s] = false;
            } else {
                const lower = machines[mIdx].targetSteps![STATS[s]]!.filter(v => v < targets[mIdx][s]!);
                targets[mIdx][s] = lower.length > 0 ? lower[lower.length - 1] : null;
                // Same as the engine's lowerTarget: below the lowest step the stat is maximized, unless nothing below it counts
                if (lower.length === 0) maximize[mIdx][s] = !machines[mIdx].worthlessBelowSteps?.[STATS[s]];
            }
            relaxGen++;
            workers.forEach(w => w.postMessage({ type: 'relax', order, gen: relaxGen } satisfies WorkerMessage));
        }
        // Reports on the old scale are ignored from here. The first report on the new one may come from a worker whose layout is worse
        // than what is on screen, so the display waits until every worker has re-scored its record (or a second has passed) and
        // then shows the best of them, compared afresh since the scale changed
        best = null;
        stall.reset(null);
        awaiting = new Set(workers.map((_, i) => i).filter(i => running.has(i)));
        awaitingUntil = Date.now() + 1000;
    };
    let awaiting = new Set<number>();
    let awaitingUntil = 0;
    const running = new Set<number>();
    const endWait = () => {
        awaiting = new Set();
        display.rebase();
        if (bestUpdates && best) display.offer(rehydrate(bestUpdates), best);
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
                running.delete(i);
                if (awaiting.delete(i) && awaiting.size === 0) endWait();
                worker.terminate();
                resolve();
                return;
            }
            if (reply.gen !== relaxGen) return;
            const lastAwaited = awaiting.delete(i) && awaiting.size === 0;
            if (best === null || beats(reply.tiers, best)) {
                best = reply.tiers;
                bestUpdates = reply.updates;
                stall.observe(reply.tiers);
                if (awaiting.size === 0 && !lastAwaited) display.offer(rehydrate(reply.updates), reply.tiers);
            }
            if (lastAwaited) endWait();
        };
        worker.onerror = (event) => {
            console.warn('Solver worker failed', event.message);
            worker.terminate();
            resolve();
        };
        running.add(i);
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
        if (awaiting.size > 0 && t > awaitingUntil) endWait();
        if (giveUp && !stopSent && awaiting.size === 0 && stall.due(EASE_STALL)) relaxLowestTarget();
    }, 50);
    try {
        await Promise.all(finished);
    } finally {
        clearInterval(watch);
        display.final();
        activeSolves--;
    }
};

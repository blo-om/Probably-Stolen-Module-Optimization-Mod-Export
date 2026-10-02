import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { InventoryItem } from '../types';
import type { WorkerMessage, WorkerReply } from './engineWorker';
import type { EngineTuning, StallOrder } from './engine';
import { stallOrders } from './engine';
import { createStallClock, significant, EASE_STALL, RELAX_STALL, MAX_PROGRESS_SHARE } from './stall';

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

/* Migration: the searches never share layouts, so late in a solve one holds the record and is stuck there while the rest work on worse
 * layouts of their own; stopping and starting again from the record (every search on it) moved again at once. A search that has not
 * beaten its own best for MIGRATE_IDLE_MS while another holds the record starts again from the record, told every give-up so far.
 * On save_14 from Clear All, every machine on Auto, 15 workers, 3 min: the water at 180 s 92,247 (6 runs) -> 94,093 (3 runs), ahead at
 * 60 and 120 s too, the AgeWells and Desequencers level. 10 s did a little less, 20 s nothing; restarting every search together after
 * 10 s without a record ended lower and was behind on the way; giving the searches different jobs (farm repacks, the lower-priority
 * machines, bigger ruins) did nothing on its own and nothing more with migration
 */
const MIGRATE_IDLE_MS = 5000;

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
 *   - otherwise the first score tier that changed must have gained at least displayShare of the whole maximized score on screen (every card's
 *     maximized tiers together), so a point on a low-priority card does not count as much as the same point would on its own small tier
 *     The big gains come early and the late ones are small, so that share starts at MAX_PROGRESS_SHARE (solver/stall.ts) and halves every
 *     DISPLAY_SHARE_HALVING_MS down to DISPLAY_SHARE_MIN. At a fixed 0.5% a long run on save_14 looked stuck: an AgeWell's next breakpoint
 *     or a few hundred credits of water stayed off screen until enough of them added up. It is always a strict gain: a layout that scores
 *     the same as the one on screen is never drawn
 * A smaller gain is not dropped: the next record is compared with what is still on screen, so small gains add up until they count
 * When the solve ends the page keeps the last significant record rather than switching to a layout that barely differs;
 * only a solve that never showed anything shows its best
 */
/* Stepped targets that cannot be met are lowered one step at a time (and Auto stats eased, see stallOrders), so the modules chasing
 * them go where they count. The search decides for itself when it runs alone; with workers the coordinator decides for all of them
 * together, since their reports are ranked on one scale. Both use the same stall rule (solver/stall.ts)
 */
const STATS = ['Performance', 'Quality', 'Efficiency'] as const;

const DISPLAY_SHARE_HALVING_MS = 20000;
const DISPLAY_SHARE_MIN = 0.0002;
const displayShare = (elapsed: number) => Math.max(DISPLAY_SHARE_MIN, MAX_PROGRESS_SHARE * Math.pow(0.5, elapsed / DISPLAY_SHARE_HALVING_MS));

const createDisplay = (machines: MachineConfig[], onUpdate: (updates: Updates, tiers: number[]) => void) => {
    const startedAt = Date.now();
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
            if (signature(updates) !== shown.sig && (shown.tiers.length === 0 || significant(tiers, shown.tiers, 0, displayShare(Date.now() - startedAt)))) show();
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
    // Relaxing: the targets as they stand, the orders sent so far, and the record at the last significant improvement
    const targets = machines.map(m => STATS.map(k => m.targetStats[k] ?? null));
    const maximize = machines.map(m => STATS.map(k => Boolean(m.maximizeStats?.[k]) && !((m.sumPQ || m.water) && k === 'Quality') && !(m.sumPE && k === 'Performance')));
    let relaxGen = 0;
    // Every order so far, for a search that starts late (see migration)
    const sent: { order: StallOrder; gen: number }[] = [];
    let lateTargets = giveUp && machines.some(m => m.water && (m.targetStats.Quality ?? null) !== null);
    // Benchmarks only: sees every new record (the display shows only some)
    const onRecord: ((updates: Updates, tiers: number[]) => void) | undefined = (globalThis as any).__onRecord;
    // Staging (engine.ts STAGED): each stall brings the next priority group in before anything is given up, in every search at once
    const machineRank = machines.map(m => Math.min(...STATS.filter(k => !m.ignoreStats?.[k]).map(k => m.statPriority?.[k] ?? 1)));
    let stagesLeft = giveUp ? new Set(machineRank).size - 1 : 0;
    const stall = createStallClock(Date.now);
    // One per worker: the search running in it (replaced when it migrates), whether it has finished, and its own best report and when it came
    type Slot = { worker: Worker | null; done: boolean; ownBest: number[] | null; ownAt: number };
    const slots: Slot[] = Array.from({ length: count }, () => ({ worker: null, done: true, ownBest: null, ownAt: 0 }));
    const post = (message: WorkerMessage) => slots.forEach(slot => { if (slot.worker && !slot.done) slot.worker.postMessage(message); });
    let awaiting = new Set<number>();
    let awaitingUntil = 0;
    const relaxLowestTarget = () => {
        const record = bestUpdates;
        if (!record) return;
        // The first give-up switches the water farms' Purity targets on in every search (see engine.ts lateTargets)
        const orders: StallOrder[] = stagesLeft > 0 ? (stagesLeft--, [{ mIdx: -2, s: -1, stage: true }]) : lateTargets ? (lateTargets = false, [{ mIdx: -1, s: -1 }]) : stallOrders(machines, targets, maximize, (mIdx, s) => {
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
        if (orders[0].mIdx >= 0 && orders[0].ease === undefined && !stall.due(RELAX_STALL)) return;
        for (const order of orders) {
            const { mIdx, s } = order;
            if (mIdx < 0) {
                // nothing to track here: the coordinator holds the targets as set
            } else if (order.ease !== undefined) {
                targets[mIdx][s] = order.ease;
                maximize[mIdx][s] = false;
            } else {
                const lower = machines[mIdx].targetSteps![STATS[s]]!.filter(v => v < targets[mIdx][s]!);
                targets[mIdx][s] = lower.length > 0 ? lower[lower.length - 1] : null;
                // Same as the engine's lowerTarget: below the lowest step the stat is maximized, unless nothing below it counts
                if (lower.length === 0) maximize[mIdx][s] = !machines[mIdx].worthlessBelowSteps?.[STATS[s]];
            }
            relaxGen++;
            sent.push({ order, gen: relaxGen });
            post({ type: 'relax', order, gen: relaxGen });
        }
        // Reports on the old scale are ignored from here. The first report on the new one may come from a worker whose layout is worse
        // than what is on screen, so the display waits until every worker has re-scored its record (or a second has passed) and
        // then shows the best of them, compared afresh since the scale changed
        best = null;
        slots.forEach(slot => { slot.ownBest = null; });
        stall.reset(null);
        awaiting = new Set(slots.map((_, i) => i).filter(i => !slots[i].done));
        awaitingUntil = Date.now() + 1000;
    };
    const endWait = () => {
        awaiting = new Set();
        display.rebase();
        if (bestUpdates && best) display.offer(rehydrate(bestUpdates), best);
    };
    let resolveAll: () => void = () => {};
    const allDone = new Promise<void>(resolve => { resolveAll = resolve; });
    const checkAllDone = () => { if (slots.every(slot => slot.done)) resolveAll(); };

    // Starts a search in worker slot i from `boards`, replacing the one running there
    const launch = (i: number, boards: any[][][]) => {
        const worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
        const slot = slots[i];
        if (slot.worker && !slot.done) slot.worker.terminate();
        slot.worker = worker;
        slot.done = false;
        slot.ownBest = null;
        slot.ownAt = Date.now();
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
            if (slot.worker !== worker) return;
            const reply = event.data;
            if (reply.type === 'done') {
                slot.done = true;
                if (awaiting.delete(i) && awaiting.size === 0) endWait();
                worker.terminate();
                checkAllDone();
                return;
            }
            if (reply.gen !== relaxGen) return;
            if (!slot.ownBest || beats(reply.tiers, slot.ownBest)) { slot.ownBest = reply.tiers; slot.ownAt = Date.now(); }
            const lastAwaited = awaiting.delete(i) && awaiting.size === 0;
            if (best === null || beats(reply.tiers, best)) {
                best = reply.tiers;
                bestUpdates = reply.updates;
                stall.observe(reply.tiers);
                onRecord?.(reply.updates, reply.tiers);
                if (awaiting.size === 0 && !lastAwaited) display.offer(rehydrate(reply.updates), reply.tiers);
            }
            if (lastAwaited) endWait();
        };
        worker.onerror = (event) => {
            console.warn('Solver worker failed', event.message);
            worker.terminate();
            if (slot.worker === worker) { slot.done = true; checkAllDone(); }
        };
        worker.postMessage({ type: 'start', machines, boards, searchPoolInventory, fullInventory, tuning: PRESETS[i % PRESETS.length] } satisfies WorkerMessage);
        // Every give-up so far, so a search that starts late scores on the same scale as the rest
        for (const { order, gen } of sent) worker.postMessage({ type: 'relax', order, gen } satisfies WorkerMessage);
    };
    try {
        for (let i = 0; i < count; i++) launch(i, initialBoards);
    } catch (error) {
        slots.forEach(slot => slot.worker?.terminate());
        activeSolves--;
        console.warn('Workers unavailable, solving on the page', error);
        return solveOnPage();
    }

    // The caller stops a solve by clearing its ref; every worker is told, and each flushes its last record before it reports done
    let stopSent = false;
    const watch = setInterval(() => {
        const t = Date.now();
        if (!stopSent && !isSolvingRef.current) {
            stopSent = true;
            post({ type: 'stop' });
        }
        if (awaiting.size > 0 && t > awaitingUntil) endWait();
        // Migration (see MIGRATE_IDLE_MS): a search stuck below the record starts again from it, with every give-up so far
        if (!stopSent && bestUpdates && best && awaiting.size === 0) {
            const stuck = slots.map((slot, i) => (!slot.done && t - slot.ownAt >= MIGRATE_IDLE_MS && (!slot.ownBest || beats(best!, slot.ownBest)) ? i : -1)).filter(i => i >= 0);
            if (stuck.length > 0) {
                const record = rehydrate(bestUpdates);
                const boards = machines.map(m => record.get(m.id)!.board);
                for (const i of stuck) launch(i, boards);
            }
        }
        if (giveUp && !stopSent && awaiting.size === 0 && stall.due(EASE_STALL)) relaxLowestTarget();
    }, 50);
    try {
        await allDone;
    } finally {
        clearInterval(watch);
        display.final();
        activeSolves--;
    }
};

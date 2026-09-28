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

/* What reaches the page. The search keeps finding better records to the very end, but late in a run most of them only reshuffle modules
 * for a tiebreak (one piece fewer, an Overclock moved) with every machine's stats unchanged, and drawing each one makes the boards flicker
 * So a record is only shown when some machine's Performance, Quality or Efficiency differs from what is on screen, always the latest,
 * and no sooner than an interval that starts at DISPLAY_EVERY_MS and doubles every DISPLAY_SLOWDOWN_MS of the solve up to DISPLAY_MAX_MS:
 * responsive while the big gains land, calm while the last small ones trickle in. The final record is always shown when the solve ends
 */
const DISPLAY_EVERY_MS = 350;
const DISPLAY_SLOWDOWN_MS = 3000;
const DISPLAY_MAX_MS = 2000;

const createDisplay = (machines: MachineConfig[], onUpdate: (updates: Updates, tiers: number[]) => void) => {
    let pending: { updates: Updates; tiers: number[] } | null = null;
    let shownSig: string | null = null;
    let lastShown = 0;
    const started = performance.now();
    const interval = () => Math.min(DISPLAY_MAX_MS, DISPLAY_EVERY_MS * Math.pow(2, (performance.now() - started) / DISPLAY_SLOWDOWN_MS));
    const signature = (updates: Updates) => machines.map(m => {
        const t = updates.get(m.id)?.totals;
        return t ? `${t.Performance},${t.Quality},${t.Efficiency}` : '-';
    }).join('|');
    const show = () => {
        if (!pending) return;
        onUpdate(pending.updates, pending.tiers);
        shownSig = signature(pending.updates);
        lastShown = performance.now();
        pending = null;
    };
    return {
        // A new record; the first one of a solve shows straight away
        offer: (updates: Updates, tiers: number[]) => {
            pending = { updates, tiers };
            if (shownSig === null) show();
        },
        tick: () => {
            if (pending && performance.now() - lastShown >= interval() && signature(pending.updates) !== shownSig) show();
        },
        final: show,
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
        const timer = setInterval(display.tick, 50);
        try {
            await runOptimizationEngine(machines, initialBoards, searchPoolInventory, fullInventory, isSolvingRef, display.offer);
        } finally {
            clearInterval(timer);
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
    const workers: Worker[] = [];
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
            if (best !== null && !beats(reply.tiers, best)) return;
            best = reply.tiers;
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
        display.tick();
        if (!stopSent && !isSolvingRef.current) {
            stopSent = true;
            workers.forEach(w => w.postMessage({ type: 'stop' } satisfies WorkerMessage));
        }
    }, 50);
    try {
        await Promise.all(finished);
    } finally {
        clearInterval(watch);
        display.final();
        activeSolves--;
    }
};

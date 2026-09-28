import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { InventoryItem } from '../types';
import type { WorkerMessage, WorkerReply } from './engineWorker';

type Updates = Parameters<Parameters<typeof runOptimizationEngine>[5]>[0];

/* The search is random, and one run settles into whichever good layout it finds first
 * So a solve runs several independent searches at once, one per spare core, each in its own Web Worker, and only passes on a report that beats
 * every report so far (on the tier score each search attaches, which is always against the targets as set). The caller sees one record that only improves
 * Running off the page's thread also means the search never pauses for the UI, and the UI never stalls for the search
 */

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

export const runParallelEngine = async (
    machines: MachineConfig[],
    initialBoards: any[][][],
    searchPoolInventory: InventoryItem[],
    fullInventory: InventoryItem[],
    isSolvingRef: { current: boolean },
    onUpdate: (updates: Updates, tiers: number[]) => void
): Promise<void> => {
    if (typeof Worker === 'undefined') {
        return runOptimizationEngine(machines, initialBoards, searchPoolInventory, fullInventory, isSolvingRef, onUpdate);
    }

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
        return runOptimizationEngine(machines, initialBoards, searchPoolInventory, fullInventory, isSolvingRef, onUpdate);
    }

    const start: WorkerMessage = { type: 'start', machines, boards: initialBoards, searchPoolInventory, fullInventory };
    const finished = workers.map(worker => new Promise<void>((resolve) => {
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
            const reply = event.data;
            if (reply.type === 'done') {
                worker.terminate();
                resolve();
                return;
            }
            if (best !== null && !beats(reply.tiers, best)) return;
            best = reply.tiers;
            onUpdate(rehydrate(reply.updates), reply.tiers);
        };
        worker.onerror = (event) => {
            console.warn('Solver worker failed', event.message);
            worker.terminate();
            resolve();
        };
        worker.postMessage(start);
    }));

    // The caller stops a solve by clearing its ref; every worker is told, and each flushes its last record before it reports done
    const watch = setInterval(() => {
        if (!isSolvingRef.current) {
            clearInterval(watch);
            workers.forEach(w => w.postMessage({ type: 'stop' } satisfies WorkerMessage));
        }
    }, 50);
    try {
        await Promise.all(finished);
    } finally {
        clearInterval(watch);
        activeSolves--;
    }
};

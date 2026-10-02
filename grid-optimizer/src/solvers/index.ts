/* The solver toggle (page header): which search lays the modules out. Every solver gets the same machines, boards and modules, and
 * whatever layout it reports is shown with this site's own stats and solution code (calculateBoardStats, checked against the game), so
 * the numbers on the page always mean the same thing
 *
 *   Bloom   this site's solver (solver/parallel.ts): water value, the 6000 ml cap, breakpoints, priority staging, workers with migration
 *   Razboy  github.com/Razboy20/probably-stolen-module-optimization (solvers/razboy, unchanged): one joint solve over the machines
 *           that are running, on the GPU when the browser has WebGPU, otherwise one search per core; each card keeps its own stat priorities
 *   hoydoy  github.com/hoydoy/probably-stolen-module-optimization (solvers/hoydoy, unchanged): one search per machine on the page
 *           itself; Run All starts them all at once, each using the modules no other machine held when it started
 * The other two know nothing of this site's extras (water value, caps, breakpoints, the store goals): they solve the targets and
 * Auto stats as set, the way their own sites do
 */
import type { MachineConfig } from '../hooks/useOptimizer';
import { calculateBoardStats, generateCodeFromState, indexInventoryById } from '../hooks/useOptimizer';
import type { InventoryItem, Stats } from '../types';
import { runParallelEngine } from '../solver/parallel';
import { runOptimizationEngine as runHoydoy } from './hoydoy/engine';
import { runSolver as runRazboy } from './razboy/solver/client';

export type SolverKind = 'bloom' | 'razboy' | 'hoydoy';
export const SOLVERS: { value: SolverKind; label: string; title: string }[] = [
    { value: 'bloom', label: 'Bloom', title: "This site's solver" },
    { value: 'razboy', label: 'Razboy', title: "Razboy's solver, unchanged (GPU when available)" },
    { value: 'hoydoy', label: 'hoydoy', title: "hoydoy's original solver, unchanged" },
];
export const SOLVER_KEY = 'optimizer_solver';
export const readSolver = (): SolverKind => {
    try {
        const v = localStorage.getItem(SOLVER_KEY);
        return v === 'razboy' || v === 'hoydoy' ? v : 'bloom';
    } catch {
        return 'bloom';
    }
};
export const writeSolver = (kind: SolverKind) => {
    try { localStorage.setItem(SOLVER_KEY, kind); } catch { /* the toggle still works for this page */ }
};

type Update = { board: any[][]; totals: Stats; pieceStats: Map<string, Stats>; code: string };
type Updates = Map<string, Update>;

// What the page shows for a board any solver reported: this site's stats and solution code for it
const describe = (machine: MachineConfig, reported: any[][], fullInventory: InventoryItem[], inventoryById: Map<string, InventoryItem>): Update => {
    // A board from a worker holds copies: the page's own item objects go back in
    const board = reported.map(row => row.map((cell: any) => (cell && cell !== 'Locked' ? inventoryById.get(cell.id) ?? cell : cell)));
    const { totals, pieceStats } = calculateBoardStats(board, fullInventory, inventoryById);
    const usedClones = new Set<string>();
    board.forEach(row => row.forEach((cell: any) => { if (cell && cell !== 'Locked' && cell.id.includes('_clone_')) usedClones.add(cell.id); }));
    const forCode = fullInventory.filter(item => !item.id.includes('_clone_') || usedClones.has(item.id));
    return { board, totals, pieceStats, code: generateCodeFromState(machine.tier, machine.maximizeStats, machine.targetStats, forCode, board) };
};

// The parts of a machine's settings the other solvers know
const plainConfig = (m: MachineConfig) => ({
    id: m.id, tier: m.tier, targetStats: m.targetStats, maximizeStats: m.maximizeStats, ignoreStats: m.ignoreStats, statPriority: m.statPriority,
});

const boardIds = (board: any[][]) => {
    const ids = new Set<string>();
    board.forEach(row => row.forEach((cell: any) => { if (cell && cell !== 'Locked') ids.add(cell.id); }));
    return ids;
};

/* One solve with the chosen solver. `machines` and `boards` are the machines being solved; `searchPoolInventory` has every module these
 * machines may not take marked locked. Resolves when the solve has stopped (isSolvingRef cleared) and its last layout is reported
 */
export const runSelectedSolver = async (
    kind: SolverKind,
    machines: MachineConfig[],
    boards: any[][][],
    searchPoolInventory: InventoryItem[],
    fullInventory: InventoryItem[],
    isSolvingRef: { current: boolean },
    onUpdate: (updates: Updates, tiers?: number[]) => void
): Promise<void> => {
    if (kind === 'bloom') return runParallelEngine(machines, boards, searchPoolInventory, fullInventory, isSolvingRef, onUpdate);
    const inventoryById = indexInventoryById(fullInventory);

    if (kind === 'hoydoy') {
        // As on hoydoy's site: every machine its own search, all at once, each kept off what the others held when it started
        await Promise.all(machines.map((m, k) => {
            const others = new Set<string>();
            boards.forEach((b, j) => { if (j !== k) boardIds(b).forEach(id => others.add(id)); });
            const pool = searchPoolInventory.map(item => (others.has(item.id) ? { ...item, isLocked: true } : item));
            return runHoydoy([plainConfig(m)] as any, [boards[k]], pool as any, fullInventory as any, isSolvingRef, (updates: any) => {
                const own = updates.get(m.id);
                if (own) onUpdate(new Map([[m.id, describe(m, own.board, fullInventory, inventoryById)]]));
            });
        }));
        return;
    }

    // Razboy: one joint solve over these machines, on his own backends (his backend setting, GPU by default when available)
    const request = {
        machines: machines.map((m, k) => ({ machine: plainConfig(m), initialBoard: boards[k] })),
        searchPoolInventory,
        fullInventory,
    };
    const handle = runRazboy(request as any, update => {
        const out: Updates = new Map();
        update.boards.forEach((b, k) => out.set(machines[k].id, describe(machines[k], b.board as any, fullInventory, inventoryById)));
        onUpdate(out, update.tiers);
    });
    const watch = setInterval(() => { if (!isSolvingRef.current) handle.stop(); }, 50);
    try {
        await handle.done;
    } catch (error) {
        console.error('Razboy solver stopped', error);
    } finally {
        clearInterval(watch);
    }
};

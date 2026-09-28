// One independent search, run off the page's thread. See parallel.ts
import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { EngineTuning } from './engine';
import type { InventoryItem } from '../types';

export type WorkerStart = {
    type: 'start';
    machines: MachineConfig[];
    boards: any[][][];
    searchPoolInventory: InventoryItem[];
    fullInventory: InventoryItem[];
    tuning?: EngineTuning;
};
// Lower one stepped target a step (see runParallelEngine); `gen` counts the relax orders sent so far
export type WorkerRelax = { type: 'relax'; mIdx: number; s: number; gen: number };
export type WorkerMessage = WorkerStart | WorkerRelax | { type: 'stop' };
// `gen`: how many relax orders the search had applied when it scored this report
export type WorkerReply =
    | { type: 'update'; updates: Map<string, any>; tiers: number[]; gen: number }
    | { type: 'done' };

const running = { current: false };
// Orders arrive while the search yields and are applied at its next check, always before its next report
let orders: { mIdx: number; s: number }[] = [];
let received = 0;
let applied = 0;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'stop') {
        running.current = false;
        return;
    }
    if (message.type === 'relax') {
        orders.push({ mIdx: message.mIdx, s: message.s });
        received = message.gen;
        return;
    }
    running.current = true;
    const take = () => { const out = orders; orders = []; applied = received; return out; };
    await runOptimizationEngine(message.machines, message.boards, message.searchPoolInventory, message.fullInventory, running,
        (updates, tiers) => self.postMessage({ type: 'update', updates, tiers, gen: applied } satisfies WorkerReply), message.tuning, take);
    self.postMessage({ type: 'done' } satisfies WorkerReply);
};

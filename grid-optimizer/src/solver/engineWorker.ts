// One independent search, run off the page's thread. See parallel.ts
import { runOptimizationEngine } from '../hooks/useOptimizer';
import type { MachineConfig } from '../hooks/useOptimizer';
import type { InventoryItem } from '../types';

export type WorkerStart = {
    type: 'start';
    machines: MachineConfig[];
    boards: any[][][];
    searchPoolInventory: InventoryItem[];
    fullInventory: InventoryItem[];
};
export type WorkerMessage = WorkerStart | { type: 'stop' };
export type WorkerReply =
    | { type: 'update'; updates: Map<string, any>; tiers: number[] }
    | { type: 'done' };

const running = { current: false };

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'stop') {
        running.current = false;
        return;
    }
    running.current = true;
    await runOptimizationEngine(message.machines, message.boards, message.searchPoolInventory, message.fullInventory, running,
        (updates, tiers) => self.postMessage({ type: 'update', updates, tiers } satisfies WorkerReply));
    self.postMessage({ type: 'done' } satisfies WorkerReply);
};

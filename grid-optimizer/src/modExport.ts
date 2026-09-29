// Export format read by the Module Optimizer Import MelonLoader mod (ModExport.cs in the mod).
//
//   PSMOD2:<base64url(UTF-8 JSON)>
//   JSON: {
//     "slot": 1,                                  // saveSlotId of the imported save (left out if none was imported)
//     "machines": [ {
//       "uid": 812,                               // the machine item's uniqueId (left out for a card made by hand)
//       "modules": [
//         { "uid": 3585, "cells": [0, 1, 7, 8] }, // this exact item, covering these cells (y * 7 + x)
//         { "like": 209, "cells": [14, 21] }      // any module of the same kind as item 209 (an "infinite" node copy)
//       ]
//     } ]
//   }
//
// The prefix is the version: the mod refuses anything else as outdated. Machines are found by uid, which is what the
// game itself keys items by, so nothing depends on names. Item uids only mean something within one save, hence `slot`.
// Modules added from the catalog are not items in the save, so they are left out (see boardModules).
// The whole string contains no whitespace, so it survives being pasted anywhere.

import type { InventoryItem } from './types';

export const MOD_EXPORT_PREFIX = 'PSMOD2:';
export const SAVE_NAME_KEY = 'optimizer_save_name';
export const SAVE_SLOT_KEY = 'optimizer_save_slot';
// Per machine card: the uniqueId of the save machine it was imported from
export const machineUidKey = (machineId: string) => `optimizer_machine_uid_${machineId}`;

export type ModExportModule = { uid: number; cells: number[] } | { like: number; cells: number[] };

export interface ModExportMachine {
    uid?: number;
    modules: ModExportModule[];
}

// The board's modules with the cells each covers. Save modules go by their uid; copies of an "infinite" node are not
// real items, so they ask for any module like their source; modules added from the catalog have no item behind them
// and are counted in `skipped` instead
export const boardModules = (board: (InventoryItem | 'Locked' | null)[][]): { modules: ModExportModule[]; skipped: number } => {
    const byId = new Map<string, { uid: number; clone: boolean; cells: number[] }>();
    const skippedIds = new Set<string>();
    board.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell || cell === 'Locked') return;
        if (typeof cell.uid !== 'number') { skippedIds.add(cell.id); return; }
        let entry = byId.get(cell.id);
        if (entry === undefined) {
            entry = { uid: cell.uid, clone: cell.id.includes('_clone_'), cells: [] };
            byId.set(cell.id, entry);
        }
        entry.cells.push(y * 7 + x);
    }));
    const modules = [...byId.values()].map(e => e.clone ? { like: e.uid, cells: e.cells } : { uid: e.uid, cells: e.cells });
    return { modules, skipped: skippedIds.size };
};

export const readMachineUid = (machineId: string): number | undefined => {
    try {
        const v = localStorage.getItem(machineUidKey(machineId));
        return v !== null && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined;
    } catch {
        return undefined;
    }
};

const toBase64Url = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const encodeModExport = (machines: ModExportMachine[]) => {
    let slot: number | undefined;
    try {
        const slotText = localStorage.getItem(SAVE_SLOT_KEY);
        if (slotText !== null && slotText !== '' && !isNaN(Number(slotText))) slot = Number(slotText);
    } catch { /* storage unavailable: no slot check in the mod */ }
    return MOD_EXPORT_PREFIX + toBase64Url(JSON.stringify(slot === undefined ? { machines } : { slot, machines }));
};

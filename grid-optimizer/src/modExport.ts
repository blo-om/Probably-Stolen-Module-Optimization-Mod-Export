// Export format read by the Module Loadout MelonLoader mod.
//
//   PSMOD1:<base64url(UTF-8 JSON)>
//   JSON: {
//     "v": 2,
//     "slot": 1,               // saveSlotId of the imported save (null if none was imported)
//     "save": "save_1",        // that save's file name, for messages only
//     "machines": [ {
//       "name": "Inv. > Machine Bay (Expanded) 1 > Furnace 2",
//       "code": "<solution code>",
//       "modules": [ { "uid": 3585, "cells": [0, 1, 7, 8] }, ... ]
//     } ]
//   }
//
// `name` is the machine's name as shown on its card. For machines from Import Save it is the full path the save
// importer builds, which the mod rebuilds in-game to find the machine.
// `modules` lists every module on the board that came from the save, by the game's own uniqueId, with the board
// cells (y * 7 + x) it covers - so the mod moves exactly those items. Modules added from the catalog have no uid;
// they only appear in `code`, and the mod matches them by type.
// `code` is the unchanged solution code, so it still imports on this site. v1 exports had no slot/save/modules.
// The whole string contains no whitespace, so it survives being pasted anywhere.

import type { InventoryItem } from './types';

export const MOD_EXPORT_PREFIX = 'PSMOD1:';
export const SAVE_NAME_KEY = 'optimizer_save_name';
export const SAVE_SLOT_KEY = 'optimizer_save_slot';

export interface ModExportModule {
    uid: number;
    cells: number[];
}

export interface ModExportMachine {
    name: string;
    code: string;
    modules: ModExportModule[];
}

// Save-imported modules on a board, with the cells each one covers. Clones of "infinite" nodes copy their
// source's uid but are not real items, so they are left to the code.
export const boardModules = (board: (InventoryItem | 'Locked' | null)[][]): ModExportModule[] => {
    const byId = new Map<string, { uid: number; cells: number[] }>();
    board.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell || cell === 'Locked' || typeof cell.uid !== 'number' || cell.id.includes('_clone_')) return;
        let entry = byId.get(cell.id);
        if (entry === undefined) {
            entry = { uid: cell.uid, cells: [] };
            byId.set(cell.id, entry);
        }
        entry.cells.push(y * 7 + x);
    }));
    return [...byId.values()];
};

const toBase64Url = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const encodeModExport = (machines: ModExportMachine[]) => {
    const slotText = localStorage.getItem(SAVE_SLOT_KEY);
    const slot = slotText !== null && slotText !== '' && !isNaN(Number(slotText)) ? Number(slotText) : null;
    const save = localStorage.getItem(SAVE_NAME_KEY);
    return MOD_EXPORT_PREFIX + toBase64Url(JSON.stringify({ v: 2, slot, save, machines }));
};

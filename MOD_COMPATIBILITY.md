# Making an optimizer compatible with the Module Optimizer Import mod

The [Module Optimizer Import](https://www.nexusmods.com/probablystolen/mods/274) mod adds an import button to every machine window in *Probably Stolen*: it reads a layout from the clipboard and moves the player's modules into place. The code below is this site's own ([`modExport.ts`](grid-optimizer/src/modExport.ts), [`SaveFileImporter.tsx`](grid-optimizer/src/components/SaveFileImporter.tsx), [`ModuleInventoryUI.tsx`](grid-optimizer/src/ModuleInventoryUI.tsx)). Reuse it as is.

## Why module uids are required

The mod places **exact items**, named by the `uniqueId` every item has in the save and in the running game:

- **Identical modules are not interchangeable.** Two "Quality Module, Premium" squares are the same piece in a solution code, but in the game one may already sit in another machine's layout while the other is in storage or locked. Matching by type can pull the wrong one out of a finished machine, or swap modules between machines on every import.
- **"Export All" moves modules between machines,** and that only works when each spot names one item, so nothing is used twice.
- **Exports without module uids are refused.** Bare solution codes and v1 exports get "Outdated import - use the correct GitHub optimizer (see the Nexus Mods page)".

## The format

```ts
'PSMOD1:' + base64url(JSON.stringify({
    v: 2,                  // required; lower is refused as outdated
    slot: 1,               // the save's saveSlotId: the mod refuses an export from another slot (uids are per save)
    save: 'save_1',        // the save's file name, for messages only
    machines: [{
        name: 'Inv. > Machine Bay (Expanded) 1 > Furnace 2',   // the machine, named as the save importer names it (below)
        code: '<solution code>',                               // hoydoy's solution code, unchanged (generateCodeFromState)
        modules: [                                             // every module on the board that is an item in the save
            { uid: 3585, cells: [0, 1, 2, 8] },                // its uniqueId, and its cells: y * 7 + x on the 7 x 5 grid
            { uid: 209, cells: [14, 21] },                     // (the same cells as its piece in `code`)
        ],
    }],
}))
```

`code` comes from `generateCodeFromState` in [`hooks/useOptimizer.ts`](grid-optimizer/src/hooks/useOptimizer.ts), unchanged from [hoydoy's optimizer](https://github.com/hoydoy/probably-stolen-module-optimization).

## Reading the save

Saves live in `%USERPROFILE%\AppData\LocalLow\Questing Goose Studio\Probably Stolen\save_N.es3`. From `SaveFileImporter.tsx`:

```ts
// The items are a JSON string inside the ES3 file
const keyIdx = text.indexOf('"mainInvJSON"');
const colonIdx = text.indexOf(':', keyIdx);
const quoteStart = text.indexOf('"', colonIdx);
let quoteEnd = -1;
for (let i = quoteStart + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') { quoteEnd = i; break; }
}
const saveItems = JSON.parse(JSON.parse(text.substring(quoteStart, quoteEnd + 1))).saveItems || [];

// item.uniqueId is the uid the mod needs (the running game has the same number); item.uuid is only a row index
const uid = typeof item.uniqueId === 'number' ? item.uniqueId : undefined;

// The save's slot, for `slot`
const slot = /"saveSlotId"\s*:\s*(\d+)/.exec(text)?.[1];

// Containers list their contents in childItems (by uuid)
const itemMap = new Map();
saveItems.forEach((item: any) => itemMap.set(item.uuid, item));
const parentMap = new Map();
saveItems.forEach((item: any) => (item.childItems || []).forEach((childId: number) => parentMap.set(childId, item.uuid)));
```

### Machine names

The mod finds a machine by this exact path, so build `name` the same way:

```ts
// Number the items of each container in grid order (top row first, then left to right)
const childrenMap = new Map<number | undefined, any[]>();
saveItems.forEach((item: any) => {
    const pId = parentMap.get(item.uuid);
    if (!childrenMap.has(pId)) childrenMap.set(pId, []);
    childrenMap.get(pId)!.push(item);
});
childrenMap.forEach((children) => {
    children.sort((a, b) => {
        const aShape = a.itemModifiedShape || a.itemShape || {};
        const bShape = b.itemModifiedShape || b.itemShape || {};
        const aY = aShape['<minY>k__BackingField'] ?? 0, bY = bShape['<minY>k__BackingField'] ?? 0;
        if (aY !== bY) return aY - bY;
        return (aShape['<minX>k__BackingField'] ?? 0) - (bShape['<minX>k__BackingField'] ?? 0);
    });
    const baseCounters: Record<string, number> = {};
    const customCounters: Record<string, number> = {};
    children.forEach(child => {
        const baseName = child.name || 'Unknown';
        const cNameIdx = (child._keys || []).indexOf('CUSTOM_NAME_TAG');
        const custom = cNameIdx !== -1 ? child._values?.[cNameIdx]?.internalValueString : undefined;
        if (baseName === 'Save Bag') {
            child.numberedName = 'Inv.';                                    // the top-level bag
        } else if (custom) {                                                // a player-given name: as-is, then " 1", " 2"...
            customCounters[custom] = customCounters[custom] === undefined ? 0 : customCounters[custom] + 1;
            child.numberedName = customCounters[custom] === 0 ? custom : `${custom} ${customCounters[custom]}`;
        } else {                                                            // "Furnace 1", "Furnace 2"; a lone one is still " 1"
            baseCounters[baseName] = (baseCounters[baseName] || 0) + 1;
            child.numberedName = `${baseName} ${baseCounters[baseName]}`;
        }
    });
});

// The machine's name: its numbered name and every container above it, from "Inv." down
const machineName = (machine: any) => {
    let path = '';
    for (let id: number | undefined = machine.uuid; id !== undefined; id = parentMap.get(id)) {
        const node = itemMap.get(id);
        if (!node) break;
        const name = node.numberedName || node.name || 'Unknown';
        path = path ? `${name} > ${path}` : name;
    }
    return path.startsWith('Inv.') ? path : `Inv. > ${path}`;   // e.g. "Inv. > Machine Bay (Expanded) 1 > Furnace 2"
};
```

## Exporting

`modExport.ts`:

```ts
export const MOD_EXPORT_PREFIX = 'PSMOD1:';

// Save modules on a board (5 rows of 7: item | 'Locked' | null), with the cells each covers. Leave out modules added by
// hand (no uid) and copies of "infinite" nodes (not real items): the mod matches those by type from `code`
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

// slot and save as read from the save file above
export const encodeModExport = (machines: ModExportMachine[]) =>
    MOD_EXPORT_PREFIX + toBase64Url(JSON.stringify({ v: 2, slot, save, machines }));
```

### One machine

```ts
// The card's Export button
navigator.clipboard.writeText(encodeModExport([{ name: machineType, code: solutionCode, modules: boardModules(board) }]));

// In the game this goes into the machine whose import button is pressed, and only that machine changes:
//  - a `name` that is a save path ("Inv. > ...") for a different machine is refused ("Open that machine's window instead")
//  - a `name` that is not a save path (a card made by hand) goes into the machine whose button was pressed
//  - its modules come from that machine, then storage, then other machines if needed
```

### Export All

```ts
// The toolbar's Export All: every card that has a layout, in one string
const entries = machines
    .map(m => machinesRef.current[m.id]?.getModExport?.())   // each card: { name, code, modules: boardModules(board) } or null
    .filter((e: any) => e && e.code);
if (entries.length > 0) navigator.clipboard.writeText(encodeModExport(entries));

// In the game this rearranges every listed machine in one batch, whichever button is pressed:
//  - each entry finds its machine by `name`; entries with no matching machine, or that can't be applied, are skipped
//    (the result says which and why); two entries for one machine block each other
//  - they are planned together: no module is used twice, and modules move or swap between the listed machines
//  - machines not listed keep their modules unless a listed module has to come out of one; exporting every machine
//    from one solve avoids that
```

Both kinds take the modules a rearranged machine's layout doesn't use out to the store inventory (the counter, then the main inventory, never the showcase). Modules the player no longer has leave their spots empty.

## Testing

1. Import a save, solve, export.
2. In the game, with the **same save** loaded, press the import button in the machine window's title bar. The result shows next to it.
3. For details, set `DebugLogs = true` under `[ModuleOptimizerImport]` in `UserData\MelonPreferences.cfg`. Each import then writes `UserData\ModuleOptimizerImport_log.txt` (the plan and every move) and `ModuleOptimizerImport_scan.txt` (every machine and module found, with uids and names).

| Message | Cause |
|---|---|
| Outdated import… | No `PSMOD1:` prefix, or `v` below 2 |
| This export was made from save_X, but save_Y is loaded | `slot` differs from the loaded save |
| This code is for "…", not "…" | A single machine's `name` is another machine's save path |
| None of the N machines in this export is "…" | No `name` matches this machine (check the naming code) |
| Cell (x,y) is locked on this machine | The code's tier doesn't match the machine's upgrade stage |

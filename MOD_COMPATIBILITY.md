# Making an optimizer compatible with the Module Optimizer Import mod

The [Module Optimizer Import](https://www.nexusmods.com/probablystolen/mods/274) MelonLoader mod adds an import button to every machine window in *Probably Stolen*. It reads a layout from the clipboard and moves the player's modules into place. Any optimizer can produce that clipboard text. This page has everything needed to do it. The reference implementation is this repository's [`grid-optimizer/src/modExport.ts`](grid-optimizer/src/modExport.ts) (short) together with its save importer, [`grid-optimizer/src/components/SaveFileImporter.tsx`](grid-optimizer/src/components/SaveFileImporter.tsx).

## Why module uids are required

The mod places **exact items**, not "a module like this one". Every item in the game has a `uniqueId`, which the save file stores and the running game keeps, and the export names each module on a board by it. Without it the mod would have to guess which physical item a layout meant, and that guess goes wrong in ordinary saves:

- **Identical modules are not interchangeable.** Two "Quality Module, Premium" squares are the same piece in a solution code, but in the game one may already sit in another machine's layout and the other may be loose in storage, or locked in place. Matching by type can pull the wrong one out of a machine that was already set up, or swap two machines' modules back and forth on every import.
- **Several machines import in one go.** An "Export All" layout moves modules between machines. That only works if the mod knows exactly which item each spot wants, so no module is used twice and nothing is moved that doesn't need to be.
- **Substitutes are visible.** If an item named by uid is gone (sold, broken), the mod says so and only then uses another module of the same kind, if the player has one.

So the mod **refuses exports without module uids**: bare solution codes and the old v1 format get "Outdated import - use the correct GitHub optimizer (see the Nexus Mods page)".

## The clipboard format

One line, no whitespace:

```
PSMOD1:<base64url of the UTF-8 JSON below>
```

base64url is standard base64 with `+` → `-`, `/` → `_`, and the trailing `=` padding removed.

```json
{
  "v": 2,
  "slot": 1,
  "save": "save_1",
  "machines": [
    {
      "name": "Inv. > Machine Bay (Expanded) 1 > Furnace 2",
      "code": "<solution code>",
      "modules": [
        { "uid": 3585, "cells": [0, 1, 2, 8] },
        { "uid": 209, "cells": [14, 21] }
      ]
    }
  ]
}
```

| Field | Required | What it is |
|---|---|---|
| `v` | yes | Must be `2`. Anything lower is refused as outdated. |
| `slot` | recommended | The save's `saveSlotId` (a top-level number in the `.es3` file). Uids only mean something within one save, so the mod refuses an export whose slot differs from the save that is loaded. Leave it out only if no save was imported. |
| `save` | optional | The save's file name (e.g. `save_1`), only used in messages. |
| `machines` | yes | One entry per machine. With one entry, the layout goes into that machine. With several ("Export All"), every listed machine is rearranged in one batch, whichever machine's button was pressed. |
| `name` | yes | The machine's name built exactly as described in [Machine names](#machine-names). The mod rebuilds the same names in-game to find the machine. |
| `code` | yes | The machine's solution code in the original optimizer's format (see [The solution code](#the-solution-code)). |
| `modules` | yes | Every module on the board that is an item in the save: its `uid` (the item's `uniqueId`) and the board `cells` it covers. |

### One machine or all of them

An export holds one machine or many; the mod treats the two differently. On this site, a card's **Export** button makes the first kind and **Export All** the second (every card that has a layout).

**One machine** (`machines` has one entry):

- The layout goes into the machine whose import button was pressed, and only that machine is rearranged.
- If `name` is a save path (starts with `Inv.`) for a *different* machine, the mod refuses: "This code is for "…", not "…". Open that machine's window instead." That way a layout can't land in the wrong Furnace by accident.
- If `name` is not a save path (a machine card made by hand), the mod trusts the button that was pressed.
- The modules come from wherever they are: already in this machine, loose in storage, or taken out of another machine. The last case is noted in the debug log ("Takes … out of …").

**Several machines** ("Export All", `machines` has more than one entry):

- Every machine in the export is rearranged in one go, whichever machine's button was pressed. Each entry finds its machine by `name`.
- They are planned together, so no module is used twice. Modules can also move between these machines, including swaps: a module in the way steps aside into storage and is placed again.
- An entry whose `name` matches no machine in the loaded save is skipped. So is one that can't be applied (e.g. a tier mismatch). The result lists what was skipped and why. If no entry matches, nothing is imported.
- Machines not in the export are left alone, unless a listed module has to come out of one of them. That is noted in the debug log ("Takes … out of …"). Exporting every machine from one solve avoids that, because each module is then named by exactly one machine.
- Two entries for the same machine block each other ("Another code already targets this machine.").

**Both kinds:**

- **Unused modules are taken out.** Modules already in a rearranged machine that its layout doesn't use go to the store inventory (the counter, then the main inventory), never the showcase. The result says how many, e.g. "took out 2 item(s) the layout doesn't use".
- **Missing modules leave gaps.** Modules in the layout that the player no longer has leave their spots empty. The result says how many.

### Board cells

The module grid is 7 wide and 5 tall. A cell is `y * 7 + x`, with `(0, 0)` the top-left: the top row is 0–6, the next row 7–13, and so on. List each module's cells in any order. The set has to be exactly the cells that module's piece covers in `code`, because the mod pairs every `modules` entry with the piece in `code` that covers the same cells.

### Which modules to list

- **Every module that came from the save**, by its `uniqueId`.
- **Not** modules the player added by hand in the optimizer (they are not items in the save; the mod matches those by type from `code`).
- **Not** copies of an "infinite" node, if the optimizer has them: they are not real items. Leave them to `code`, and the mod picks any node the player owns.

Special modules (Alarm Transmitter, Furnace Blast, Junk Processing) are listed like any other.

## Reading uids from the save

Saves live in `%USERPROFILE%\AppData\LocalLow\Questing Goose Studio\Probably Stolen\save_N.es3`. Each item record in the save carries:

- **`uniqueId`**: the id the mod needs. The running game uses the same number (`GameItem.uniqueId`).
- `uuid`: only the record's index in the file. **Do not use it as the module id.**
- `name`, `itemTypes`, `_keys` / `_values` (tags), `itemShape` / `itemModifiedShape` (grid position), and `childItems` (the uuids of the items it contains).

Parsing the file itself (it is ES3 with JSON inside strings, not strict JSON), telling modules and machines apart, and reading positions and effects are all done in `SaveFileImporter.tsx`. It is the easiest thing to reuse.

## Machine names

The mod finds the machine by the same path this site's (and the original site's) save importer builds. The rules are:

1. **Siblings are numbered.** Items in the same container (same parent) are sorted into grid order, top row first then left to right (`minY`, then `minX` of their shape). Each one gets its name plus a count among siblings with the same name, starting at 1: `Furnace 1`, `Furnace 2`. A lone item is still `Furnace 1`.
2. **Player-given names are kept.** If the item has a `CUSTOM_NAME_TAG`, its text is used as-is for the first item with that name, and later duplicates get ` 1`, ` 2`, and so on.
3. **The top-level bag is `Inv.`.** The save's `Save Bag` item is named `Inv.`, and every path starts with it.
4. **Paths join with ` > `.** The path runs from `Inv.` down through every container to the machine itself: `Inv. > Machine Bay (Expanded) 1 > Furnace 2`.

A machine card made by hand (not from a save) can use any name that does not start with `Inv.`. When there is only one machine in the export, the mod puts it into whichever machine's window the import button was pressed on.

## The solution code

`code` is the unchanged solution code of the original optimizer ([hoydoy/probably-stolen-module-optimization](https://github.com/hoydoy/probably-stolen-module-optimization)): the machine's tier, its goals, and every piece's shape, colour, effects and cells. Use its `generateCodeFromState` as it is; this repository's copy is in [`grid-optimizer/src/hooks/useOptimizer.ts`](grid-optimizer/src/hooks/useOptimizer.ts). The mod decodes it for the tier (to check the machine's locked cells) and for each piece's shape, colour and effects.

## Minimal encoder

```ts
type Board = (InventoryItem | 'Locked' | null)[][];   // 5 rows of 7; items carry `uid` when they came from the save

// Save modules on the board, with the cells each covers
const boardModules = (board: Board) => {
    const byId = new Map<string, { uid: number; cells: number[] }>();
    board.forEach((row, y) => row.forEach((cell, x) => {
        if (!cell || cell === 'Locked' || typeof cell.uid !== 'number' || cell.id.includes('_clone_')) return;
        const entry = byId.get(cell.id) ?? { uid: cell.uid, cells: [] };
        entry.cells.push(y * 7 + x);
        byId.set(cell.id, entry);
    }));
    return [...byId.values()];
};

const toBase64Url = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// machines: [{ name, code, board }] ; slot / save from the imported save file
const encodeModExport = (machines: { name: string; code: string; board: Board }[], slot?: number, save?: string) =>
    'PSMOD1:' + toBase64Url(JSON.stringify({
        v: 2, slot, save,
        machines: machines.map(m => ({ name: m.name, code: m.code, modules: boardModules(m.board) })),
    }));

navigator.clipboard.writeText(encodeModExport([{ name, code, board }], slot, saveName));
```

## Testing

1. Import a save in your optimizer, solve a machine, and copy the export.
2. In the game, with the **same save** loaded, open that machine's window and press the mod's import button in the title bar.
3. The mod shows a short result next to the button: placed, already in place, taken out, or why it refused.
4. For details, set `DebugLogs = true` under `[ModuleOptimizerImport]` in `UserData\MelonPreferences.cfg`. Every import then writes `UserData\ModuleOptimizerImport_log.txt` (the plan and every move) and `ModuleOptimizerImport_scan.txt` (every machine and module the mod found, with their uids and names).

Common refusals:

| Message | Cause |
|---|---|
| Outdated import… | No `PSMOD1:` prefix, or `v` below 2. |
| This export was made from save_X, but save_Y is loaded | `slot` differs from the loaded save. |
| This code is for "…", not "…" | The single machine's `name` is a save path for a different machine. |
| None of the N machines in this export is "…" | No entry's `name` matches this machine (check the naming rules). |
| Cell (x,y) is locked on this machine | The code's tier doesn't match the machine's upgrade stage. |

# "Export All for Mod" for Razboy's optimizer

Adds an **Export All for Mod** button to [Razboy's optimizer](https://github.com/Razboy20/probably-stolen-module-optimization). It copies every machine's layout in the format the [Module Optimizer Import](https://www.nexusmods.com/probablystolen/mods/274) mod reads. In the game, press the import button in any machine window, and every machine gets its layout in one go, using the player's own modules (exact items, by uid).

## Install

Either apply the patch (made against `a8c6144`, applies cleanly):

```
git apply razboy-export-all-for-mod.patch
```

or copy `modExport.ts` to `src/modExport.ts` and make these four small edits by hand:

1. **`src/types.ts`**: add to `InventoryItem`:
   ```ts
   uid?: number;
   ```
2. **`src/save/parseSave.ts`**: add `uniqueId?: number;` to `SaveItem`, and when building each module item:
   ```ts
   uid: typeof item.uniqueId === 'number' ? item.uniqueId : undefined
   ```
3. **`src/components/SaveFileImporter.tsx`**: after `onImport(items, machines);`:
   ```ts
   rememberSaveForMod(evt.target?.result as string, file.name);
   ```
4. **`src/ModuleInventoryUI.tsx`**: a button anywhere in the toolbar:
   ```tsx
   <button onClick={() => copyAllForMod(machines, machinesRef.current)}>Export All for Mod</button>
   ```
   (The patch's version also shows "Copied 12 machines" on the button for a moment.)

## What it does

- `modExport.ts` is self-contained. It writes each board in hoydoy's original code format, which the mod decodes, so later changes to the site's own codec can't break the export.
- It also avoids a problem with the site's current codes. They write the Blast module as colour 7, and the mod rejects that ("unknown shape/color (10/7)"). The site's codes also list every unused module, so a single Blast module in the inventory would break every machine's entry.
- Machine names are the save importer's paths ("Inv. > Machine Bay (Expanded) 1 > Furnace 2"), which the mod finds in the game. Module uids are the save's `uniqueId`. The save slot keeps an export from being applied to the wrong save.

## Checked

Checked on save_1 (12 machines): imported into both this site and the patched Razboy site, then decoded with a port of the mod's own decoder. Both exports came out identical: every machine name, every piece's shape, colour, cells and effects, every uid, and the slot and save. Then on the patched site: a solve, a page reload, and Export All again. All 12 machines still decoded, every one of the 105 placed modules kept its uid, and no uid appeared twice. `tsc -b`, `eslint` and `vite build` pass on the patched repo.

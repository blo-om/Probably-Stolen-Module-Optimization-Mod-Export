# Probably Stolen Module Optimization — Mod Export

A fork of [hoydoy/probably-stolen-module-optimization](https://github.com/hoydoy/probably-stolen-module-optimization), the module grid optimizer for *Probably Stolen*. See [Credits](#credits) for whose work it builds on.

**Live site:** https://blo-om.github.io/Probably-Stolen-Module-Optimization-Mod-Export/

## What this fork changes

- **Mod export.** Each machine card has an **Export** button, and the toolbar has **Export All**. They copy the machine layout together with its name, so the *Module Optimizer Import* MelonLoader mod can put the modules into the right machine in-game.
- **No leaderboard submissions.** Results are not sent to the original site's Supabase leaderboard, and the original site's analytics script is removed.
- **Smarter targets.** A target (Tar %) is a hard minimum that outranks card order. A machine whose stats are all targets reaches them with the weakest modules that suffice, leaving strong modules for machines that maximize, and a clean-up pass swaps out any module a weaker same-shaped one can replace.
- **Layout.** Machine cards show the machine's icon and short name in the header, stat cards toggle on/off with a click, and the page toolbar sits at the top.

## Credits

- **[hoydoy](https://github.com/hoydoy/probably-stolen-module-optimization)** made the original optimizer and site this fork starts from.
- **[Razboy20](https://github.com/Razboy20/probably-stolen-module-optimization)** inspired the core of the current solver. His fork's rewritten solver, an iterated local search over placements run on one Web Worker per core, is the approach this solver follows. The code here is a separate implementation.

The machine icons in `grid-optimizer/public/machines/` are item art from *Probably Stolen* © Questing Goose Studio, used to identify machines in this fan tool.

## Mod export format

```
PSMOD2:<base64url(UTF-8 JSON)>
```

```json
{
  "slot": 1,
  "machines": [
    {
      "uid": 174,
      "modules": [
        { "uid": 3585, "cells": [0, 1, 2, 8] },
        { "like": 209, "cells": [14, 21] }
      ]
    }
  ]
}
```

- The prefix is the version. The mod refuses anything else (older `PSMOD1` exports, bare solution codes) as outdated.
- `slot` is the imported save's `saveSlotId`. Item uids only mean something within one save, so the mod refuses an export from another slot.
- A machine's `uid` is the machine item's `uniqueId` from the save, which the running game keeps. The mod finds the machine by it. A machine card made by hand on the site has no `uid`; its layout goes into whichever machine's window the import button was pressed on.
- `modules` lists the board's modules with the cells (`y * 7 + x`) each covers: `uid` is that exact item; `like` means any module of the same kind as that item (copies of an "infinite" node, which are not real items). Modules added from the catalog are not in the save, so they are left out, and the Export button says how many.
- The string has no whitespace. Encoding is in `grid-optimizer/src/modExport.ts`.

## Development

```bash
cd grid-optimizer
npm ci
npm run dev
```

Pushing to `master` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

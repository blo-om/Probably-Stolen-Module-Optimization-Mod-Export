# Probably Stolen Module Optimization — Mod Export

A fork of [hoydoy/probably-stolen-module-optimization](https://github.com/hoydoy/probably-stolen-module-optimization), the module grid optimizer for *Probably Stolen*. All of the optimizer itself is the original author's work.

**Live site:** https://blo-om.github.io/Probably-Stolen-Module-Optimization-Mod-Export/

## What this fork changes

- **Mod export.** Each machine card has a **Mod** button, and the toolbar has **Copy All for Mod**. They copy the machine's name together with its solution code, so the *Module Loadout* MelonLoader mod can put the modules into the right machine in-game.
- **No leaderboard submissions.** Results are not sent to the original site's Supabase leaderboard, and the original site's analytics script is removed.

- **Layout.** Machine cards show the machine's icon and short name in the header, stat cards toggle on/off with a click, and the page toolbar sits at the top.

The machine icons in `grid-optimizer/public/machines/` are item art from *Probably Stolen* © Questing Goose Studio, used to identify machines in this fan tool.

## Mod export format

```
PSMOD1:<base64url(UTF-8 JSON)>
```

```json
{ "v": 1, "machines": [ { "name": "Inv. > Machine Bay (Expanded) 1 > Furnace 2", "code": "<solution code>" } ] }
```

- `name` is the machine name shown on the card. For machines added with **Import Save (.es3)** that is the full path the save importer builds; the mod rebuilds the same names in-game to find the machine.
- `code` is the unchanged solution code from the card.
- The string has no whitespace. Encoding is in `grid-optimizer/src/modExport.ts`.

## Development

```bash
cd grid-optimizer
npm ci
npm run dev
```

Pushing to `master` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

# Machine breakpoints

Every value is a machine's **total %** from the modules in it (what its stat cards show). A breakpoint is the total where the machine
does something better; anything between two breakpoints does nothing more. Generated from the optimizer's own rules
(`grid-optimizer/src/machineDefaults.ts`, checked against the full release's code) by `npm run breakpoints` - do not edit by hand.

## Quick reference

| Machine | Performance | Quality |
|---|---|---|
| Moisture Farm | output +1% per 1% | water grade: **50** Base · **100** High-quality · **150** Pure |
| Water Purifier | cleans +1% per 1% | purity cap: **100** 99.9% (Pure) · **200** 100% |
| Furnace | no effect | ingot purity +1 stage per full **100** (Blast: from 200) |
| AgeWell | lowers energy, like Efficiency | +1 day of aging per full **125** |
| Mirage Projector | +1 point per 4% | +1 point per 2% |
| Cryptographic Desequencer | keycard days, see below | no effect |
| Alarm System | **49** = every theft stopped | no effect |
| Hydroponic System | growth days per plant, see below | harvest +1 item steps per plant, see below |
| DNA Manipulator | operation days per complexity | 100% success at **10 + 10 × complexity** |
| 3D Printer | print days per chip, see below | melee condition: **20** Fair+ · **160** Good+ · **280** Excellent |
| Deal Maker | lowers energy, like Efficiency | +1% accept chance per 10% (base 10%) |
| Evaporator | 300 ml/day, +1% per 1% | recovery = Quality %, up to **100** |

Efficiency lowers every machine's energy use; its steps are in [Energy](#energy).

## Moisture Farm

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Water made: 850 ml a day, +8.5 ml per 1%; farms running the same night share the air (each makes 1 / (1 + 0.25 per other farm)) | — |
| Quality | Water grade: Ghost from 0%, Base 50%, High-quality 100%, Pure 150% (Rust and Gutterflow below 0) | **0** Ghost · **50** Base · **100** HQ · **150** Pure |

## Water Purifier

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Cleaning speed: +1% per 1% (dirty water is cleaned up to 20 times faster) | — |
| Quality | How clean it gets: up to 99% (high-quality), 99.9% (pure) from 100%, 100% water at 200% | **0** HQ · **100** Pure · **200** 100% |

## Furnace

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | No effect | — |
| Quality | Ingot purity: one stage up per full 100% (Blast module: one stage less) | **100** +1 · **200** +2 · **300** +3 · **400** +4 |
| Quality, with Blast | one stage less | **100** +0 · **200** +1 · **300** +2 · **400** +3 · **500** +4 |

<details><summary>Ingot purity per recipe</summary>

| Quality | Result |
|---|---|
| **100** | 2 scrap → Fair Purity · 1 scrap + 1 ore → High Purity · 2 ore → Very High Purity |
| **200** | 2 scrap → High Purity · 1 scrap + 1 ore → Very High Purity · 2 ore → Perfect Purity |
| **300** | 2 scrap → Very High Purity · 1 scrap + 1 ore → Perfect Purity · 2 ore → Perfect Purity |
| **400** | 2 scrap → Perfect Purity · 1 scrap + 1 ore → Perfect Purity · 2 ore → Perfect Purity |

</details>

<details><summary>Ingot purity per recipe, with Blast</summary>

| Quality | Result |
|---|---|
| **100** | 3 scrap → Low Purity · 2 scrap + 1 ore → Low Purity · 1 scrap + 2 ore → Fair Purity · 3 ore → High Purity (Blast: below 100% one stage less, unless flux is used) |
| **200** | 3 scrap → Fair Purity · 2 scrap + 1 ore → Fair Purity · 1 scrap + 2 ore → High Purity · 3 ore → Very High Purity (Blast: first 100% ignored) |
| **300** | 3 scrap → High Purity · 2 scrap + 1 ore → High Purity · 1 scrap + 2 ore → Very High Purity · 3 ore → Perfect Purity (Blast: first 100% ignored) |
| **400** | 3 scrap → Very High Purity · 2 scrap + 1 ore → Very High Purity · 1 scrap + 2 ore → Perfect Purity · 3 ore → Perfect Purity (Blast: first 100% ignored) |
| **500** | 3 scrap → Perfect Purity · 2 scrap + 1 ore → Perfect Purity · 1 scrap + 2 ore → Perfect Purity · 3 ore → Perfect Purity (Blast: first 100% ignored) |

</details>

## AgeWell

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Energy use, the same as Efficiency (both are on the Efficiency card) | — |
| Quality | Aging: one more day per night for every full 125% | **125** +1d · **250** +2d · **375** +3d · **500** +4d |

## Mirage Projector

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Attractiveness: 100 points, +1 per 4% (with Quality) | — |
| Quality | Attractiveness: 100 points, +1 per 2% (with Performance) | — |

## Alarm System

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Chance to stop a theft: 51%, +1% per 1% (the game shows 1% less than it rolls), sure from 49% | **49** every theft stopped |
| Quality | No effect | — |

## Deal Maker

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Energy use, the same as Efficiency (both are on the Efficiency card) | — |
| Quality | Accept chance on a haggle: 10%, +1% per 10% | — |

## Evaporator

| Stat | What it does | Breakpoints |
|---|---|---|
| Performance | Evaporates 300 ml a day, +3 ml per 1% | — |
| Quality | Distillate: 1% of what evaporates is kept per 1%, up to 100% (with Solvent Recovery: only alcohol is kept) | **100** all of it kept (more does nothing) |

## Cryptographic Desequencer

Performance: Decoding speed: 33 work a day, +0.33 per 1%. Keycard work: Service/Supply 75 · Engineering/Medical 100 · Security 125 · Command 150.

| Performance | Keycards it gets one day faster |
|---|---|
| **4** | Engineering/Medical (100 work) in 3 days |
| **16** | Service/Supply (75 work) in 2 days · Command (150 work) in 4 days |
| **28** | Security (125 work) in 3 days |
| **52** | Engineering/Medical (100 work) in 2 days · Command (150 work) in 3 days |
| **91** | Security (125 work) in 2 days |
| **128** | Service/Supply (75 work) in 1 day · Command (150 work) in 2 days |
| **204** | Engineering/Medical (100 work) in 1 day |
| **279** | Security (125 work) in 1 day |
| **355** | Command (150 work) in 1 day |

## Hydroponic System

Plain seeds, their innate traits included (a seed changed in the DNA Manipulator differs; the optimizer reads yours from the save). Growth: 8 work a day, +1 per full 25% Performance.

| Plant | Performance → days to grow | Quality → extra items a harvest |
|---|---|---|
| Fillerweed | **0** 1d | **20** +1 · **60** +2 · **100** +3 · **140** +4 |
| Hydroreed | **0** 3d · **25** 2d · **250** 1d | — |
| Bloomberry | **0** 3d · **75** 2d · **350** 1d | **18** +1 · **50** +2 · **84** +3 · **118** +4 |
| Bloomberry regrowth | **0** 2d · **100** 1d | **18** +1 · **50** +2 · **84** +3 · **118** +4 |
| Coffee | **0** 3d · **75** 2d · **325** 1d | **14** +1 · **38** +2 · **64** +3 · **88** +4 |
| Nutrifruit | **0** 2d · **200** 1d | **16** +1 · **44** +2 · **72** +3 · **100** +4 · **102** Huge |
| Dream Cap | **0** 4d · **50** 3d · **150** 2d · **500** 1d | **14** +1 · **38** +2 · **64** +3 · **88** +4 |
| Kotton | **0** 6d · **25** 5d · **75** 4d · **175** 3d · **350** 2d · **875** 1d | **8** +1 · **24** +2 · **40** +3 · **54** +4 |

## DNA Manipulator

An operation at complexity c takes 20 + 4c work at 10 + P/20 a day, and succeeds at 95 − 5c + Q/2 % (at least 5%).

<details><summary>Days and success per complexity (0-15)</summary>

| Complexity | Performance → days | Quality |
|---|---|---|
| 0 | **0** 2d · **200** 1d | **10** Sure success |
| 1 | **0** 3d · **40** 2d · **280** 1d | **20** Sure success |
| 2 | **0** 3d · **80** 2d · **360** 1d | **30** Sure success |
| 3 | **0** 4d · **20** 3d · **120** 2d · **440** 1d | **40** Sure success |
| 4 | **0** 4d · **40** 3d · **160** 2d · **520** 1d | **50** Sure success |
| 5 | **0** 4d · **80** 3d · **200** 2d · **600** 1d | **60** Sure success |
| 6 | **0** 5d · **20** 4d · **100** 3d · **240** 2d · **680** 1d | **70** Sure success |
| 7 | **0** 5d · **40** 4d · **120** 3d · **280** 2d · **760** 1d | **80** Sure success |
| 8 | **0** 6d · **20** 5d · **60** 4d · **160** 3d · **320** 2d · **840** 1d | **90** Sure success |
| 9 | **0** 6d · **40** 5d · **80** 4d · **180** 3d · **360** 2d · **920** 1d | **100** Sure success |
| 10 | **0** 6d · **40** 5d · **100** 4d · **200** 3d · **400** 2d · **1000** 1d | **110** Sure success |
| 11 | **0** 7d · **20** 6d · **60** 5d · **120** 4d · **240** 3d · **440** 2d · **1080** 1d | **120** Sure success |
| 12 | **0** 7d · **40** 6d · **80** 5d · **140** 4d · **260** 3d · **480** 2d · **1160** 1d | **130** Sure success |
| 13 | **0** 8d · **20** 7d · **40** 6d · **100** 5d · **160** 4d · **280** 3d · **520** 2d · **1240** 1d | **140** Sure success |
| 14 | **0** 8d · **20** 7d · **60** 6d · **120** 5d · **180** 4d · **320** 3d · **560** 2d · **1320** 1d | **150** Sure success |
| 15 | **0** 8d · **40** 7d · **80** 6d · **120** 5d · **200** 4d · **340** 3d · **600** 2d · **1400** 1d | **160** Sure success |

</details>

## 3D Printer

Prints at 24 work a day, +24 per 100% Performance. Chips of 24 work or less (scopes, lasers, suppressor, .22 mags, small parts) take one day already. Melee weapon condition rolls 20-30 + Q/4 (+ the ingot's quality bonus).

| Chip | Performance → days | Quality → melee condition |
|---|---|---|
| Gun Parts | **0** 2d · **25** 1d | — |
| Box Cutter | **0** 2d · **42** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |
| High Cap. .22 Mag. | **0** 2d · **50** 1d | — |
| 10mm Magazine | **0** 2d · **50** 1d | — |
| Ext. .22 Mag. | **0** 2d · **100** 1d | — |
| High Cap. 10mm Mag. | **0** 2d · **100** 1d | — |
| .22 Pistol | **0** 3d · **5** 2d · **109** 1d | — |
| .22 Pistol x2 | **0** 3d · **25** 2d · **150** 1d | — |
| Nestfire Compact Frame | **0** 3d · **25** 2d · **150** 1d | — |
| Ext. 10mm Mag. | **0** 3d · **25** 2d · **150** 1d | — |
| Kitchen Knife | **0** 3d · **34** 2d · **167** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |
| Ironcraft 10 Frame | **0** 3d · **46** 2d · **192** 1d | — |
| Hatchet | **0** 4d · **5** 3d · **59** 2d · **213** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |
| Meat Cleaver | **0** 4d · **17** 3d · **71** 2d · **242** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |
| Combat Knife | **0** 5d · **5** 4d · **38** 3d · **105** 2d · **309** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |
| Combat Machete | **0** 5d · **25** 4d · **67** 3d · **150** 2d · **400** 1d | **20** Fair+ · **160** Good+ · **280** Excellent |

## Energy

Efficiency lowers energy use a day (a use, for the Deal Maker), never below 1. On the AgeWell and the Deal Maker, Performance counts toward it too.

| Machine | Rule | First steps (Efficiency → energy) |
|---|---|---|
| Moisture Farm | 6 a day, 1 less per ~16.7% | **17** 5 · **34** 4 · **50** 3 · **67** 2 |
| Water Purifier | 4 a day, 1 less per full 25% | **25** 3 · **50** 2 · **75** 1 |
| Furnace | 8 a day, 1 less per full 12.5% | **13** 7 · **25** 6 · **38** 5 · **50** 4 |
| AgeWell | 24 a day, 1 less per ~8.3% of Efficiency and Performance together | **1** 23 · **9** 22 · **17** 21 · **26** 20 |
| Mirage Projector | 16 a day, 1 less per full 6.25% | **7** 15 · **13** 14 · **19** 13 · **25** 12 |
| Cryptographic Desequencer | 10 a day, 1 less per full 10% | **10** 9 · **20** 8 · **30** 7 · **40** 6 |
| Alarm System | 4 a day, 1 less per full 25% | **25** 3 · **50** 2 · **75** 1 |
| Hydroponic System | 8 a day, 1 less per full 12.5% | **13** 7 · **25** 6 · **38** 5 · **50** 4 |
| DNA Manipulator | 12 a day, 1 less per ~8.3% | **9** 11 · **17** 10 · **25** 9 · **34** 8 |
| 3D Printer | 8 a day, 1 less per full 12.5% | **13** 7 · **25** 6 · **38** 5 · **50** 4 |
| Deal Maker | 25 a use, 1 less per full 4% of Efficiency and Performance together | **4** 24 · **8** 23 · **12** 22 · **16** 21 |
| Evaporator | 6 a day, 1 less per ~16.7% | **17** 5 · **34** 4 · **50** 3 · **67** 2 |

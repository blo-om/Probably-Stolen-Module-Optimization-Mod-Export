import { t, plural } from './i18n';
// Which stats each machine type starts with switched on. From the community machine guide:
//   Furnace          - Performance has no impact; Quality raises ingot purity
//   Desequencer      - Quality N/A; Performance = work per day
//   Alarm System     - Quality N/A; Performance = theft prevention
//   AgeWell          - Performance only changes energy use (like Efficiency); Quality = extra aging
//   Moisture Farm, Water Purifier, Mirage Projector - both Performance and Quality matter
// Efficiency only ever changes energy use, so it starts off everywhere except the Furnace. Players can still switch any of them.

type StatFlags = { Performance: boolean; Quality: boolean; Efficiency: boolean };

const IGNORED_BY_TYPE: [string, StatFlags][] = [
    ['furnace', { Performance: true, Quality: false, Efficiency: false }],
    ['desequencer', { Performance: false, Quality: true, Efficiency: true }],
    ['alarm', { Performance: false, Quality: true, Efficiency: true }],
    ['agewell', { Performance: true, Quality: false, Efficiency: true }],
];

const DEFAULT_IGNORED: StatFlags = { Performance: false, Quality: false, Efficiency: true };

// Stats to ignore for a machine, from its name ("Inv. > Machine Bay (Expanded) 1 > Furnace 2" or "Furnace 1")
export const defaultIgnoreStats = (machineType: string): StatFlags => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = IGNORED_BY_TYPE.find(([keyword]) => name.includes(keyword));
    return { ...(hit ? hit[1] : DEFAULT_IGNORED) };
};

// Store attractiveness a Mirage Projector starts out aiming for, its own bonus included (see defaultTargetStats)
export const STORE_ATTRACTIVENESS_GOAL = 900;

/* Targets a machine starts with:
 *   Alarm System     a 100% chance to stop a theft (50% + Performance, so +50%)
 *   Mirage Projector STORE_ATTRACTIVENESS_GOAL for the whole store: last night's base from the save (`baseAttractiveness`) plus the
 *                    projector's 100 + Performance / 4 + Quality / 2; without a save it stays on Auto
 */
export const defaultTargetStats = (machineType: string, baseAttractiveness: number | null = null): { Performance: number | null; Quality: number | null; Efficiency: number | null } => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    if (name.includes('mirage') && baseAttractiveness !== null) {
        return { Performance: mirageSumFor(STORE_ATTRACTIVENESS_GOAL - baseAttractiveness), Quality: null, Efficiency: null };
    }
    return { Performance: name.includes('alarm') ? 50 : null, Quality: null, Efficiency: null };
};

// An enabled stat is maximized unless it has a target
export const defaultMaximizeStats = (ignored: StatFlags): StatFlags => ({
    Performance: !ignored.Performance,
    Quality: !ignored.Quality,
    Efficiency: !ignored.Efficiency,
});

// Some stats only matter at fixed thresholds, so their card picks an outcome instead of a number.
// The pick becomes that stat's target, and since a target is a threshold, nothing is spent past it.
// From the community guides (Maslak):
//   Moisture Farm  - every 50% steps the water it makes up a grade; 49% still makes ghostwater
//   Water Purifier - cleans water up to a purity cap: 99% (high-quality), 99.9% (pure) from 100%, 100% at 200%
//   Furnace        - every full 100% raises the ingot one purity stage (negative Quality does nothing). Flux only lifts 0 stages to 1,
//                    so from 100% it is not consumed. A Blast module takes one stage off, so every step needs 100% more.
//                    Checked against the game (MachineFurnace day lambda, IngotPurityHelper): stages = Quality / 100 (RNG.ModuloWithCount is
//                    plain whole division, no chance involved), Blast -1 (never below 0) and 3 inputs for 2 ingots, flux lifts 0 to 1 and is
//                    used up, advanced flux lifts 0 to 1 and is never used up. Base purity: no ore Low, one ore Fair, two ore High
//                    (from the last two inputs, ores sort last); each stage is one step up (Very low, Low, Fair, High, Very high, Perfect), capped at Perfect
//   AgeWell        - every 125% ages the wine one more day per night (only multiples of 125 matter)
//   Desequencer    - Performance: 33 + (33 * P) / 100 work a day (MachineProgressHelper); a keycard takes whole days, so only the cut-offs
//                    where some chipset's card finishes a day sooner matter. Checked against the game: the guide's 90% for Security in 2 days is 91%
// `short` is the chip label where space is tight
export type StatBreakpoint = { value: number; label: string; hint: string; short?: string };

const PURITIES = ['Low Purity', 'Fair Purity', 'High Purity', 'Very High Purity', 'Perfect Purity'];

const furnaceBreakpoints = (hasBlast: boolean): StatBreakpoint[] => {
    // Base purity of each recipe, by index into PURITIES
    const recipes: [string, number][] = hasBlast
        ? [['3 scrap', 0], ['2 scrap + 1 ore', 1], ['1 scrap + 2 ore', 2]]
        : [['2 scrap', 0], ['1 scrap + 1 ore', 1], ['2 ore', 2]];
    const offset = hasBlast ? 100 : 0;
    return [1, 2, 3, 4].map(stages => ({
        value: stages * 100 + offset,
        label: stages === 1 ? t('+{n} purity, flux free', { n: stages }) : t('+{n} purity', { n: stages }),
        short: `+${stages}`,
        hint: recipes.map(([recipe, base]) => `${t(recipe)} → ${t(PURITIES[Math.min(base + stages, 4)])}`).join(' · ')
            + (hasBlast ? t(' (Blast: first 100% ignored)') : ''),
    }));
};

const QUALITY_BREAKPOINTS: [string, (hasBlast: boolean) => StatBreakpoint[]][] = [
    ['moisture farm', () => [
        { value: 0, label: t('Ghostwater'), short: t('Ghost'), hint: t('96-98% water. Pitcher: 75% high-quality, 25% basewater') },
        { value: 50, label: t('Basewater'), short: t('Base'), hint: t('98-99% water. Pitcher: always high-quality') },
        { value: 100, label: t('High-quality'), short: t('HQ'), hint: t('99-99.9% water. Pitcher: 26% pure') },
        { value: 150, label: t('Pure'), hint: t('99.9%+ water, no filtering needed') },
    ]],
    /* The Purifier cleans water up to a purity cap, 100% minus a share set by Quality (MachinePurifier.GetMaxPurityCap, GetPurityMult):
     * 1% below 15%, 0.85% from 15, 0.65% from 25, 0.35% from 50, 0.2% from 75, 0.1% from 100, 0 from 200. The grades are 99% high-quality,
     * 99.9% pure (WaterFeatureHelper.WATER_PURITIES), so only 100% and 200% change what comes out
     */
    ['water purifier', () => [
        { value: 0, label: t('High-quality'), short: t('HQ'), hint: t('Cleans up to 99% (high-quality); 15-75% Quality only lifts that to 99.8%') },
        { value: 100, label: t('Pure'), hint: t('Cleans up to 99.9% (pure)') },
        { value: 200, label: t('100% water'), short: t('100%'), hint: t('Cleans out every contaminant: 100% water') },
    ]],
    ['furnace', furnaceBreakpoints],
    ['agewell', () => [1, 2, 3, 4].map(extra => ({
        value: extra * 125,
        label: t('+{n} day{s}', { n: extra, s: plural(extra) }),
        short: t('+{n}d', { n: extra }),
        hint: t('Wine ages {n} days per night instead of 1', { n: extra + 1 }),
    }))],
];

// Work per chipset: 75 Service/Supply, 100 Engineering/Medical, 125 Security, 150 Command
const CHIPSETS: Record<number, string> = { 75: 'Service/Supply', 100: 'Engineering/Medical', 125: 'Security', 150: 'Command' };
const DESEQUENCER_CUTOFFS: [number, [number, number][]][] = [
    [4, [[100, 3]]],
    [16, [[75, 2], [150, 4]]],
    [28, [[125, 3]]],
    [52, [[100, 2], [150, 3]]],
    [91, [[125, 2]]],
    [128, [[75, 1], [150, 2]]],
    [204, [[100, 1]]],
    [279, [[125, 1]]],
    [355, [[150, 1]]],
];
const PERFORMANCE_BREAKPOINTS: [string, () => StatBreakpoint[]][] = [
    ['desequencer', () => DESEQUENCER_CUTOFFS.map(([value, cards]) => ({
        value,
        label: cards.map(([work, days]) => t('{work} in {days}d', { work, days })).join(', '),
        hint: cards.map(([work, days]) => t('{chipset} ({work} work) in {days} day{s}', { chipset: t(CHIPSETS[work]), work, days, s: plural(days) })).join(' · '),
    }))],
];

const BREAKPOINTS_BY_STAT: Partial<Record<'Performance' | 'Quality' | 'Efficiency', [string, (hasBlast: boolean) => StatBreakpoint[]][]>> = {
    Quality: QUALITY_BREAKPOINTS,
    Performance: PERFORMANCE_BREAKPOINTS,
};

// Outcome list for one stat card, or null when that stat takes a plain number
export const statBreakpoints = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency', hasBlast = false): StatBreakpoint[] | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = BREAKPOINTS_BY_STAT[stat]?.find(([keyword]) => name.includes(keyword));
    return hit ? hit[1](hasBlast) : null;
};

// The Desequencer's goal is picked as chipset + days, which is how players think about it
const CHIPSET_SHORT: Record<number, string> = { 75: 'Service', 100: 'Medical', 125: 'Security', 150: 'Command' };
export const DESEQUENCER_CHIPSETS: { work: number; name: string; short: string }[] = [75, 100, 125, 150].map(work => ({ work, name: CHIPSETS[work], short: CHIPSET_SHORT[work] }));

// Every (days, Performance needed) a chipset's card can be done in, slowest first. The slowest is the 33 work/d base
export const desequencerDayOptions = (work: number): { days: number; value: number }[] => {
    const cut = DESEQUENCER_CUTOFFS.flatMap(([value, cards]) => cards.filter(([w]) => w === work).map(([, days]) => ({ days, value })));
    return [{ days: cut[0].days + 1, value: 0 }, ...cut];
};

// Days a chipset's card takes at this Performance
// Work a day at this Performance: 33 + (33 * P) / 100, in whole units (MachineProgressHelper)
export const desequencerSpeed = (performance: number): number => 33 + Math.trunc((33 * Math.trunc(performance)) / 100);

// Per machine card (localStorage): the chipset picked on the Desequencer's Target panel, and whether its days are on Auto
// (maximized, eased to that chipset's day breakpoints instead of a fixed number of days)
export const desequencerChipsetKey = (machineId: string) => `optimizer_chipset_${machineId}`;
export const desequencerAutoDaysKey = (machineId: string) => `optimizer_deseq_autodays_${machineId}`;

export const desequencerDaysAt = (work: number, performance: number): number => {
    const options = desequencerDayOptions(work);
    let days = options[0].days;
    for (const o of options) if (performance >= o.value) days = o.days;
    return days;
};

// Every Performance value where some chipset's card gets a day faster
export const desequencerCutoffs = (): number[] => DESEQUENCER_CUTOFFS.map(([value]) => value);

/* The Mirage Projector's attractiveness is 100 + Quality / 2 + Performance / 4, each divided on its own and rounded down
 * (MachineProjector.GetAttractivenessBoost: quality ratio 2, performance ratio 4). Its card shows one stat, attractiveness, and the
 * solver works on Performance + 2 x Quality (MachineConfig.sumPQ, MIRAGE_QUALITY_WEIGHT), 4 of which make a point
 */
export const isMirage = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('mirage');
export const MIRAGE_BASE_POINTS = 100;
export const MIRAGE_QUALITY_WEIGHT = 2;
export const MIRAGE_SUM_PER_POINT = 4;
export const miragePoints = (performance: number, quality: number) =>
    Math.max(0, MIRAGE_BASE_POINTS + Math.trunc(Math.trunc(quality) / 2) + Math.trunc(Math.trunc(performance) / 4));
// The Performance + 2 x Quality that makes `points` for sure: each of the two divisions can lose up to 3/4 of a point
export const mirageSumFor = (points: number) => Math.max(0, (points - MIRAGE_BASE_POINTS) * MIRAGE_SUM_PER_POINT + 5);

/* Stats where nothing below the first breakpoint counts, checked against the game: Furnace stages = Quality / 100 (0 below 100),
 * AgeWell days = max(0, Quality) / 125 + 1, Water Purifier cap 99% for all Quality under 15. Not the Moisture Farm (Rust and
 * Gutterflow below 0) or the Desequencer (negative Performance works slower)
 */
export const worthlessBelowSteps = (machineType: string): Partial<Record<'Performance' | 'Quality' | 'Efficiency', boolean>> => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    return ['furnace', 'agewell', 'water purifier'].some(k => name.includes(k)) ? { Quality: true } : {};
};

export const isAgeWell = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('agewell');

/* Stats that get no card of their own: the ones with no effect, and the AgeWell's Performance, which only lowers the machine's
 * energy use exactly as Efficiency does (same ratio in the game), so both share the Efficiency card (MachineConfig.sumPE)
 */
export const hiddenStat = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency') =>
    statHasNoEffect(machineType, stat) || (stat === 'Performance' && isAgeWell(machineType));

// What each stat does on each machine, for the machine tooltip (numbers from the game code, see the notes above)
const STAT_EFFECTS: [string, 'Performance' | 'Quality' | 'Efficiency', string][] = [
    ['moisture farm', 'Performance', 'Water made: 850 ml a day, +8.5 ml per 1%; farms running the same night share the air (each makes 1 / (1 + 0.25 per other farm))'],
    ['moisture farm', 'Quality', 'Water grade: Ghost from 0%, Base 50%, High-quality 100%, Pure 150% (Rust and Gutterflow below 0)'],
    ['moisture farm', 'Efficiency', 'Energy use: 6 a day, 1 less per ~16.7%'],
    ['water purifier', 'Performance', 'Cleaning speed: +1% per 1% (dirty water is cleaned up to 20 times faster)'],
    ['water purifier', 'Quality', 'How clean it gets: up to 99% (high-quality), 99.9% (pure) from 100%, 100% water at 200%'],
    ['water purifier', 'Efficiency', 'Energy use: 4 a day, 1 less per full 25%'],
    ['furnace', 'Performance', 'No effect'],
    ['furnace', 'Quality', 'Ingot purity: one stage up per full 100% (Blast module: one stage less)'],
    ['furnace', 'Efficiency', 'Energy use: 8 a day, 1 less per full 12.5%'],
    ['agewell', 'Performance', 'Energy use, the same as Efficiency (both are on the Efficiency card)'],
    ['agewell', 'Quality', 'Aging: one more day per night for every full 125%'],
    ['agewell', 'Efficiency', 'Energy use: 24 a day, 1 less per ~8.3% of Efficiency and Performance together'],
    ['mirage', 'Performance', 'Attractiveness: 100 points, +1 per 4% (with Quality)'],
    ['mirage', 'Quality', 'Attractiveness: 100 points, +1 per 2% (with Performance)'],
    ['mirage', 'Efficiency', 'Energy use: 16 a day, 1 less per full 6.25%'],
    ['desequencer', 'Performance', 'Decoding speed: 33 work a day, +0.33 per 1%'],
    ['desequencer', 'Quality', 'No effect'],
    ['desequencer', 'Efficiency', 'Energy use: 10 a day, 1 less per full 10%'],
    ['alarm', 'Performance', 'Chance to stop a theft: 50%, +1% per 1%'],
    ['alarm', 'Quality', 'No effect'],
    ['alarm', 'Efficiency', 'Energy use: 4 a day, 1 less per full 25%'],
];
export const statEffect = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): string | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const effect = STAT_EFFECTS.find(([k, s]) => s === stat && name.includes(k))?.[2];
    return effect === undefined ? null : t(effect);
};

/* What a Moisture Farm's water sells for a day, from the game (checked against the decompiled game and the save's stored values):
 *   MachineMoistureFarm.GetOutputVolume: 850 * (100 + Performance) / 100 ml a day, never below 0 (no cap: the Water Tank holds 20 L
 *   and can be enlarged)
 *   MachineMoistureFarm.ApplySharedAir: farms running the same night share the air, each makes its volume / (1 + 0.25 * (farms - 1))
 *   The liquid's own value: 40 credits a litre whatever its grade, rounded down (WaterFeatureHelper.GetWaterPrice; a full jug's stored
 *   unitValue is 239-240)
 *   The grade is an item condition with a value modifier on that (ItemConditionList.CreatePureWater ... CreateGutterflow): Pure +100%,
 *   High-quality +50%, Basewater 0, Ghostwater -33%, Rustwater -75%, Gutterflow -90%
 * GameItem.ComposeStagedValue: markup * (container + liquid * (1 + modifier)), rounded. Shown here without the store's retail markup
 * (PlayerStore.retailMarkup, a store setting: with 15%, a full jug of pure water reads (15 + 239 * 2) * 1.15 = 567 in the game) and without
 * the jug, which the farm does not make
 */
export const WATER_PRICE_PER_LITRE = 40;
// `price`: credits a litre at that grade
export const WATER_GRADES: { name: string; from: number; modifier: number; price: number }[] = [
    { name: 'Gutterflow', from: -Infinity, modifier: -90 },
    { name: 'Rustwater', from: -50, modifier: -75 },
    { name: 'Ghostwater', from: 0, modifier: -33 },
    { name: 'Basewater', from: 50, modifier: 0 },
    { name: 'High-quality', from: 100, modifier: 50 },
    { name: 'Pure', from: 150, modifier: 100 },
].map(g => ({ ...g, price: (WATER_PRICE_PER_LITRE * (100 + g.modifier)) / 100 }));
export const MOISTURE_FARM_BASE_ML = 850;
export const moistureFarmOutput = (performance: number, quality: number, farms = 1) => {
    const solo = Math.max(0, Math.trunc((MOISTURE_FARM_BASE_ML * 1000 * (100 + Math.trunc(performance))) / 100));
    const ml = Math.round(solo / (1 + 0.25 * (Math.max(1, farms) - 1)) / 1000);
    const grade = [...WATER_GRADES].reverse().find(g => quality >= g.from)!;
    const liquid = Math.floor((ml * WATER_PRICE_PER_LITRE) / 1000);
    return { ml, grade: grade.name, value: Math.round((liquid * (100 + grade.modifier)) / 100) };
};

// Store attractiveness: last night's base (the save's baseStoreAttractiveness, no bonuses) plus the best Mirage Projector's; projectors
// do not stack, the game takes the highest. Kept per save (localStorage) by the save importer
export const STORE_BASE_ATTRACTIVENESS_KEY = 'optimizer_store_base_attractiveness';

export const isMoistureFarm = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('moisture farm');

export const isDesequencer = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('desequencer');

// What each stat does on a machine, in the machine's own words. Falls back to the stat's name
const STAT_NAMES: [string, 'Performance' | 'Quality' | 'Efficiency', string][] = [
    ['moisture farm', 'Performance', 'Volume'],
    ['moisture farm', 'Quality', 'Purity'],
    ['water purifier', 'Performance', 'Removal'],
    ['water purifier', 'Quality', 'Purity'],
    ['furnace', 'Quality', 'Ingot purity'],
    ['agewell', 'Quality', 'Extra aging'],
    ['desequencer', 'Performance', 'Work speed'],
    ['alarm', 'Performance', 'Theft prevention'],
];

export const statName = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): string => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = STAT_NAMES.find(([keyword, s]) => s === stat && name.includes(keyword));
    return t(hit ? hit[2] : stat);
};

// Stats that change nothing on a machine, per the machine guide
const NO_EFFECT: [string, 'Performance' | 'Quality' | 'Efficiency'][] = [
    ['furnace', 'Performance'],
    ['desequencer', 'Quality'],
    ['alarm', 'Quality'],
];

export const statHasNoEffect = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): boolean => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    return NO_EFFECT.some(([keyword, s]) => s === stat && name.includes(keyword));
};

// Some stats are linear in something players think in, so their target is entered in that unit instead of %
//   Moisture Farm  - 850 ml/day base, every 1% Performance adds 8.5 ml
//   Water Purifier - contaminants removed a night from a full 6 L jug of near-clean water, +1% per 1% Performance
// `totals` is there for units that depend on another stat too (AgeWell's energy also moves with Performance)
export type StatUnit = {
    unit: string;
    fromPercent: (pct: number, totals?: Totals) => number;
    toPercent: (value: number, totals?: Totals) => number;
    // For energy: a smaller number is the better one, so a target is a ceiling
    lowerIsBetter?: boolean;
    step: number;
    // Shown on hover over the target box and the readout
    hint?: string;
    // Readout under the stat, when it needs more than "<value> <unit>"
    readout?: (value: number) => string;
};

type Totals = { Performance: number; Quality: number; Efficiency: number };

/* Energy per day, as the game computes it (ModuleHelper.ApplyBasicModuleEffect, checked against the decompiled game):
 *   energy = base - (base * Efficiency) / 100                       integer division, truncating toward zero
 *   with an efficiency ratio r:   (int)(base - ((base * E) / r) / 100)
 *   machines whose Performance reduces power (AgeWell) then add   (int)(((base * P) / pr) / -100)
 *   and never below 1
 * So a 4-energy machine saves one per full 25%, and the AgeWell (base 24, both ratios 2) saves one at 1%, 9%, 17%... of Efficiency
 * and one per full 8.33% of Performance; negative Efficiency costs nothing until the next full step
 */
type EnergyRule = { base: number; effRatio?: number; perfRatio?: number };
const trunc = (v: number) => (v < 0 ? Math.ceil(v) : Math.floor(v));
const energyOf = ({ base, effRatio, perfRatio }: EnergyRule, eff: number, perf: number) => {
    const e = Math.trunc(eff), p = Math.trunc(perf);
    let energy = effRatio ? trunc(base - trunc((base * e) / effRatio) / 100) : base - trunc((base * e) / 100);
    if (perfRatio) energy += trunc(trunc((base * p) / perfRatio) / -100);
    return Math.max(1, energy);
};
const energyUnit = (rule: EnergyRule): StatUnit => ({
    get unit() { return t('/day'); },
    fromPercent: (eff, totals) => energyOf(rule, eff, totals?.Performance ?? 0),
    // The least Efficiency that gets energy down to the value asked for
    toPercent: (value, totals) => {
        for (let eff = -500; eff <= 1000; eff++) if (energyOf(rule, eff, totals?.Performance ?? 0) <= value) return eff;
        return 1000;
    },
    step: 1,
    lowerIsBetter: true,
});
/* AgeWell: Performance lowers energy the same way Efficiency does, so its card works on their sum (MachineConfig.sumPE). The
 * machine's own reading is exact from both totals; a target (a sum) is converted as if it were all Efficiency, which the game's
 * separate rounding of the two can put off by at most 1 energy a day
 */
const combinedEnergyUnit = (rule: EnergyRule): StatUnit => ({
    get unit() { return t('/day'); },
    fromPercent: (sum, totals) => totals && Math.abs(totals.Efficiency + totals.Performance - sum) < 1e-9
        ? energyOf(rule, totals.Efficiency, totals.Performance)
        : energyOf(rule, sum, 0),
    toPercent: (value) => {
        for (let sum = -500; sum <= 1000; sum++) if (energyOf(rule, sum, 0) <= value) return sum;
        return 1000;
    },
    step: 1,
    lowerIsBetter: true,
});

// What a Purifier takes out a night from a full 6 L jug of near-clean water with no Performance: (25 + 6000 * 0.003) ml x 1.25
const PURIFIER_JUG_ML = 53.75;

const STAT_UNITS: [string, 'Performance' | 'Quality' | 'Efficiency', StatUnit][] = [
    // Base energy and ratios from each machine's constructor in the game code
    ['moisture farm', 'Efficiency', energyUnit({ base: 6 })],
    ['water purifier', 'Efficiency', energyUnit({ base: 4 })],
    ['furnace', 'Efficiency', energyUnit({ base: 8 })],
    ['desequencer', 'Efficiency', energyUnit({ base: 10 })],
    ['agewell', 'Efficiency', combinedEnergyUnit({ base: 24, effRatio: 2, perfRatio: 2 })],
    ['mirage', 'Efficiency', energyUnit({ base: 16 })],
    ['alarm', 'Efficiency', energyUnit({ base: 4 })],
    // Alarm: chance to stop a theft = 50% + Performance (MachineAlarm.GetAlarmeStopRate), never below 0
    ['alarm', 'Performance', {
        unit: '%',
        fromPercent: pct => Math.max(0, 50 + Math.trunc(pct)),
        toPercent: chance => Math.ceil(chance - 50),
        step: 1,
        get hint() { return t('Chance to stop a theft: 50% plus Performance'); },
    }],
    // One farm on its own: farms running the same night share the air (moistureFarmOutput)
    ['moisture farm', 'Performance', {
        get unit() { return t('ml/d'); },
        fromPercent: pct => Math.max(0, Math.trunc((MOISTURE_FARM_BASE_ML * (100 + Math.trunc(pct))) / 100)),
        // Rounded up, so the target always reaches the volume asked for
        toPercent: ml => Math.ceil((ml * 100) / MOISTURE_FARM_BASE_ML - 100 - 1e-9),
        step: 10,
    }],
    /* Purifier: a night removes up to (25 ml + 0.3% of the water, at most 10 L of it) x 1.25 x (dirt factor + Performance / 100) of
     * contaminants, largest first, never past the purity cap Quality sets (MachinePurifier.PurifyContainer, RemoveLargestFirst). The dirt
     * factor is 1 for water at 98% or better and rises to 20 for very dirty water, so this reads it for a full 6 L jug of near-clean water:
     * 53.75 ml a night, +1% per 1%
     */
    ['water purifier', 'Performance', {
        get unit() { return t('ml/d'); },
        fromPercent: pct => Math.floor(PURIFIER_JUG_ML * 10 * Math.max(0, 1 + Math.trunc(pct) / 100)) / 10,
        toPercent: ml => Math.ceil((ml / PURIFIER_JUG_ML - 1) * 100 - 1e-9),
        step: 1,
        get hint() { return t('Contaminants removed a night from a full 6 L jug of near-clean water: 53.75 ml, +1% per 1% Performance (dirty water goes up to 20 times faster). Never past the purity cap that Quality sets'); },
    }],
];

export const statUnit = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): StatUnit | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = STAT_UNITS.find(([keyword, s]) => s === stat && name.includes(keyword));
    return hit ? hit[2] : null;
};

// Energy a day at which a machine counts as cheap to run: Efficiency past that is worth much less on Auto (MachineConfig.cheapEnergyAt)
export const CHEAP_ENERGY = 4;
// The Efficiency (AgeWell: Efficiency + Performance) that gets a machine down to CHEAP_ENERGY a day. Machines that start there
// (Water Purifier, Alarm: 4 a day) get a value below 0, so all their Efficiency counts less
export const cheapEnergyAt = (machineType: string): number | undefined => statUnit(machineType, 'Efficiency')?.toPercent(CHEAP_ENERGY);

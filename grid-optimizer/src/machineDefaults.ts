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

// Targets a machine starts with: the Alarm System aims for a 100% chance to stop a theft (50% + Performance, so +50%)
export const defaultTargetStats = (machineType: string): { Performance: number | null; Quality: number | null; Efficiency: number | null } => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
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
//   Water Purifier - lowers the contaminant floor at 50 / 75 / 100 / 200%. A basic source needs 100% for pure (75% if
//                    pitcher-filtered first), which puts its floor at 0.5-1.25%: basewater at 0%, high-quality by 50%
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

const PURITIES = ['Low', 'Fair', 'High', 'Very high', 'Perfect'];

const furnaceBreakpoints = (hasBlast: boolean): StatBreakpoint[] => {
    // Base purity of each recipe, by index into PURITIES
    const recipes: [string, number][] = hasBlast
        ? [['3 scrap', 0], ['2 scrap + 1 ore', 1], ['1 scrap + 2 ore', 2]]
        : [['2 scrap', 0], ['1 scrap + 1 ore', 1], ['2 ore', 2]];
    const offset = hasBlast ? 100 : 0;
    return [1, 2, 3, 4].map(stages => ({
        value: stages * 100 + offset,
        label: `+${stages} purity${stages === 1 ? ', flux free' : ''}`,
        short: `+${stages}`,
        hint: recipes.map(([recipe, base]) => `${recipe} → ${PURITIES[Math.min(base + stages, 4)]}`).join(' · ')
            + (hasBlast ? ' (Blast: first 100% ignored)' : ''),
    }));
};

const QUALITY_BREAKPOINTS: [string, (hasBlast: boolean) => StatBreakpoint[]][] = [
    ['moisture farm', () => [
        { value: 0, label: 'Ghostwater', short: 'Ghost', hint: '96-98% water. Pitcher: 75% high-quality, 25% basewater' },
        { value: 50, label: 'Basewater', short: 'Base', hint: '98-99% water. Pitcher: always high-quality' },
        { value: 100, label: 'High-quality', short: 'HQ', hint: '99-99.9% water. Pitcher: 26% pure' },
        { value: 150, label: 'Pure', hint: '99.9%+ water, no filtering needed' },
    ]],
    /* The Purifier cleans each contaminant down to a floor (heavy metal 0.25%, chemicals 0.16%, organic waste 0.10%, microbes 0.09%,
     * physical and minerals 0.07%: 0.74% for water from a basic source) times a factor set by Quality:
     * 1 below 15%, 0.85 from 15, 0.65 from 25, 0.35 from 50, 0.2 from 75, 0.1 from 100, 0 from 200 (MachinePurifier.GetPurityMult)
     * Basic source water: 99.26% (high-quality) with no Quality, 99.85% at 75%, 99.93% (pure) at 100%
     * Pitcher-filtered water (heavy metals and chemicals left, 0.41%): 99.59% with none, 99.92% (pure) at 75%
     */
    ['water purifier', () => [
        { value: 0, label: 'High-quality', short: 'HQ', hint: 'Any basic source already comes out high-quality (99.26%+) with no Quality at all' },
        { value: 75, label: 'Pure (pre-filtered)', short: 'Pure (pitcher)', hint: 'Pure (99.92%) from basic-source water filtered in a pitcher first' },
        { value: 100, label: 'Pure', hint: 'Pure (99.93%) from any basic source: traders, tap, moisture farm' },
        { value: 200, label: '100% water', short: '100%', hint: 'Contaminant floors 0%: converts everything' },
    ]],
    ['furnace', furnaceBreakpoints],
    ['agewell', () => [1, 2, 3, 4].map(extra => ({
        value: extra * 125,
        label: `+${extra} day${extra > 1 ? 's' : ''}`,
        short: `+${extra}d`,
        hint: `Wine ages ${extra + 1} days per night instead of 1`,
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
        label: cards.map(([work, days]) => `${work} in ${days}d`).join(', '),
        hint: cards.map(([work, days]) => `${CHIPSETS[work]} (${work} work) in ${days} day${days > 1 ? 's' : ''}`).join(' · '),
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

// The Mirage Projector's Performance and Quality both add 1 attractiveness point per 1% on top of its base 100,
// so its card shows one stat, attractiveness, and the solver treats the two as their sum (MachineConfig.sumPQ)
export const isMirage = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('mirage');
export const MIRAGE_BASE_POINTS = 100;

/* Stats where nothing below the first breakpoint counts, checked against the game: Furnace stages = Quality / 100 (0 below 100),
 * AgeWell days = max(0, Quality) / 125 + 1, Water Purifier floor multiplier 1 for all Quality under 15. Not the Moisture Farm (Rust and
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
    ['moisture farm', 'Performance', 'Water made: 1000 ml a day, +10 ml per 1%'],
    ['moisture farm', 'Quality', 'Water grade: Ghost from 0%, Base 50%, High-quality 100%, Pure 150% (Rust and Gutterflow below 0)'],
    ['moisture farm', 'Efficiency', 'Energy use: 4 a day, 1 less per full 25%'],
    ['water purifier', 'Performance', 'Cleaning speed: every contaminant removed faster (+0.02 ml a day per 1%)'],
    ['water purifier', 'Quality', 'How clean it gets: Pure from 100% (75% for pitcher-filtered water), 100% water at 200%'],
    ['water purifier', 'Efficiency', 'Energy use: 5 a day, 1 less per full 20%'],
    ['furnace', 'Performance', 'No effect'],
    ['furnace', 'Quality', 'Ingot purity: one stage up per full 100% (Blast module: one stage less)'],
    ['furnace', 'Efficiency', 'Energy use: 8 a day, 1 less per full 12.5%'],
    ['agewell', 'Performance', 'Energy use, the same as Efficiency (both are on the Efficiency card)'],
    ['agewell', 'Quality', 'Aging: one more day per night for every full 125%'],
    ['agewell', 'Efficiency', 'Energy use: 24 a day, 1 less per ~8.3% of Efficiency and Performance together'],
    ['mirage', 'Performance', 'Attractiveness: 100 points, +1 per 1% (with Quality)'],
    ['mirage', 'Quality', 'Attractiveness: 100 points, +1 per 1% (with Performance)'],
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
    return STAT_EFFECTS.find(([k, s]) => s === stat && name.includes(k))?.[2] ?? null;
};

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
    return hit ? hit[2] : stat;
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
//   Moisture Farm  - 1000 ml/day base, every 1% Performance adds 10 ml
//   Water Purifier - every 1% Performance removes 0.02 ml/day more of each contaminant type. The base rate depends on the
//                    water's concentrations, so only the extra can be targeted
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
    unit: '/day',
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
    unit: '/day',
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

const STAT_UNITS: [string, 'Performance' | 'Quality' | 'Efficiency', StatUnit][] = [
    // Base energy and ratios from each machine's constructor in the game code
    ['moisture farm', 'Efficiency', energyUnit({ base: 4 })],
    ['water purifier', 'Efficiency', energyUnit({ base: 5 })],
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
        hint: 'Chance to stop a theft: 50% plus Performance',
    }],
    ['moisture farm', 'Performance', {
        unit: 'ml/d',
        fromPercent: pct => 1000 + 10 * pct,
        // Rounded up, so the target always reaches the volume asked for
        toPercent: ml => Math.ceil((ml - 1000) / 10),
        step: 10,
    }],
    /* Purifier: each contaminant is removed at its own base amount a day (2 ml heavy metals, 3 ml chemicals, 5 ml the rest) times
     * (water-dependent factor + Performance / 100). The factor is 1 for water above 96% and up to 20 for very dirty water
     * (MachinePurifier.PurifyContainer), so Performance reads as the removal speed on clean-ish water
     */
    /* Shown as the guide had it: the extra a day that Performance adds to a contaminant's removal, 0.02 ml per 1%
     * (the game's rate for heavy metals; chemicals get 0.03 and the rest 0.05, MachinePurifier.PurifyContainer). Each contaminant is
     * handled on its own, but never below its purity floor, so what actually goes (the tooltip's "removed") is capped by how much of each
     * is left above its floor, and shrinks as the water gets cleaner
     */
    ['water purifier', 'Performance', {
        unit: 'ml/d',
        fromPercent: pct => Math.round(pct * 2) / 100,
        toPercent: ml => Math.ceil(ml * 50 - 1e-9),
        step: 0.1,
        hint: 'Extra removed a day per contaminant from Performance: 0.02 ml per 1% (heavy metals; chemicals 0.03, the rest 0.05). The real amount is capped by what is left above the purity floor',
    }],
];

export const statUnit = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): StatUnit | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = STAT_UNITS.find(([keyword, s]) => s === stat && name.includes(keyword));
    return hit ? hit[2] : null;
};

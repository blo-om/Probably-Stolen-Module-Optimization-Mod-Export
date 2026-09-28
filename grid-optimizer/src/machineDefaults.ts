// Which stats each machine type starts with switched on. From the community machine guide:
//   Furnace          - Performance has no impact; Quality raises ingot purity
//   Desequencer      - Quality N/A; Performance = work per day
//   Alarm System     - Quality N/A; Performance = theft prevention
//   AgeWell          - Performance only changes energy use (like Efficiency); Quality = extra aging
//   Moisture Farm, Water Purifier, Mirage Projector - both Performance and Quality matter
// Efficiency only ever changes energy use, so it starts off everywhere. Players can still switch any of them.

type StatFlags = { Performance: boolean; Quality: boolean; Efficiency: boolean };

const IGNORED_BY_TYPE: [string, StatFlags][] = [
    ['furnace', { Performance: true, Quality: false, Efficiency: true }],
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

// An enabled stat is maximized (no targets are set by default)
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
//   Furnace        - every 100% raises the ingot one purity stage, and 100% also stops Flux being consumed.
//                    With a Blast module the first 100% is ignored, so every step needs 100% more
//   AgeWell        - every 125% ages the wine one more day per night (only multiples of 125 matter)
//   Desequencer    - Performance: 33 work/d base, +1 per 3.03%; a keycard takes whole days, so only the cut-offs
//                    where some chipset's card finishes a day sooner matter
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
    ['water purifier', () => [
        { value: 0, label: 'Basewater', short: 'Base', hint: 'Any basic source already comes out basewater or better' },
        { value: 50, label: 'High-quality', short: 'HQ', hint: 'High-quality from any basic source (pitcher-filtered water is already high-quality at 0%)' },
        { value: 75, label: 'Pure (pre-filtered)', short: 'Pure (pitcher)', hint: 'Pure from a basic source filtered in a pitcher first' },
        { value: 100, label: 'Pure', hint: 'Pure from any basic source: traders, tap, moisture farm' },
        { value: 200, label: '100% water', short: '100%', hint: 'Contaminant floor 0%: converts everything' },
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
    [90, [[125, 2]]],
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
export const desequencerDaysAt = (work: number, performance: number): number => {
    const options = desequencerDayOptions(work);
    let days = options[0].days;
    for (const o of options) if (performance >= o.value) days = o.days;
    return days;
};

// Every Performance value where some chipset's card gets a day faster
export const desequencerCutoffs = (): number[] => DESEQUENCER_CUTOFFS.map(([value]) => value);

export const isDesequencer = (machineType: string) => (machineType.split(' > ').pop() || '').toLowerCase().includes('desequencer');

// What each stat does on a machine, in the machine's own words. Falls back to the stat's name
const STAT_NAMES: [string, 'Performance' | 'Quality' | 'Efficiency', string][] = [
    ['moisture farm', 'Performance', 'Volume'],
    ['moisture farm', 'Quality', 'Purity'],
    ['water purifier', 'Performance', 'Volume'],
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

/* Energy per day from Efficiency, from the machine guides. Every `step`% saves one energy; only whole steps count,
 * except on the AgeWell, where entering the next step is enough (1% already saves one) and Performance costs one per step too
 */
const energyUnit = (base: number, step: number, ageWell = false): StatUnit => {
    const energy = (eff: number, totals?: Totals) => {
        const saved = ageWell ? Math.sign(eff) * Math.ceil(Math.abs(eff) / step - 1e-9) : Math.trunc(eff / step + (eff >= 0 ? 1e-9 : -1e-9));
        const spent = ageWell && totals ? Math.max(0, Math.floor(totals.Performance / step + 1e-9)) : 0;
        return Math.max(0, base - saved + spent);
    };
    return {
        unit: 'energy/d',
        fromPercent: energy,
        // The least Efficiency that gets energy down to the value asked for
        toPercent: (value, totals) => {
            for (let eff = -500; eff <= 1000; eff++) if (energy(eff, totals) <= value) return eff;
            return 1000;
        },
        step: 1,
        lowerIsBetter: true,
    };
};

const STAT_UNITS: [string, 'Performance' | 'Quality' | 'Efficiency', StatUnit][] = [
    ['moisture farm', 'Efficiency', energyUnit(4, 25)],
    ['water purifier', 'Efficiency', energyUnit(5, 20)],
    ['furnace', 'Efficiency', energyUnit(8, 12.5)],
    ['desequencer', 'Efficiency', energyUnit(10, 10)],
    ['agewell', 'Efficiency', energyUnit(24, 100 / 12, true)],
    ['moisture farm', 'Performance', {
        unit: 'ml/d',
        fromPercent: pct => 1000 + 10 * pct,
        // Rounded up, so the target always reaches the volume asked for
        toPercent: ml => Math.ceil((ml - 1000) / 10),
        step: 10,
    }],
    ['water purifier', 'Performance', {
        unit: 'ml/d',
        // Two decimals: 0.02 per % never needs more
        fromPercent: pct => Math.round(pct * 2) / 100,
        toPercent: ml => Math.ceil(ml * 50 - 1e-9),
        step: 0.1,
        hint: 'Extra ml/day removed of EACH contaminant type in the water, on top of the base rate (0.02 ml per 1% Performance). Basic sources have 6 types, pitcher-filtered water 2',
        readout: ml => `+${ml} ml/d`,
    }],
];

export const statUnit = (machineType: string, stat: 'Performance' | 'Quality' | 'Efficiency'): StatUnit | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = STAT_UNITS.find(([keyword, s]) => s === stat && name.includes(keyword));
    return hit ? hit[2] : null;
};

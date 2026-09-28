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
//   Desequencer    - Performance: 33 work/d base, +1 per 3.03%; a keycard takes whole days, so only the cut-offs
//                    where some chipset's card finishes a day sooner matter
export type StatBreakpoint = { value: number; label: string; hint: string };

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
        hint: recipes.map(([recipe, base]) => `${recipe} → ${PURITIES[Math.min(base + stages, 4)]}`).join(' · ')
            + (hasBlast ? ' (Blast: first 100% ignored)' : ''),
    }));
};

const QUALITY_BREAKPOINTS: [string, (hasBlast: boolean) => StatBreakpoint[]][] = [
    ['moisture farm', () => [
        { value: 0, label: 'Ghostwater', hint: '96-98% water. Pitcher: 75% high-quality, 25% basewater' },
        { value: 50, label: 'Basewater', hint: '98-99% water. Pitcher: always high-quality' },
        { value: 100, label: 'High-quality', hint: '99-99.9% water. Pitcher: 26% pure' },
        { value: 150, label: 'Pure', hint: '99.9%+ water, no filtering needed' },
    ]],
    ['water purifier', () => [
        { value: 0, label: 'Basewater', hint: 'Any basic source already comes out basewater or better' },
        { value: 50, label: 'High-quality', hint: 'High-quality from any basic source (pitcher-filtered water is already high-quality at 0%)' },
        { value: 75, label: 'Pure (pre-filtered)', hint: 'Pure from a basic source filtered in a pitcher first' },
        { value: 100, label: 'Pure', hint: 'Pure from any basic source: traders, tap, moisture farm' },
        { value: 200, label: '100% water', hint: 'Contaminant floor 0%: converts everything' },
    ]],
    ['furnace', furnaceBreakpoints],
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

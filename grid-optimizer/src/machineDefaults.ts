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

// Quality only matters at fixed thresholds on some machines, so their Quality card picks an outcome instead of a number.
// The pick becomes the Quality target, and since a target is a threshold, nothing is spent past it.
// From the community water guide (Maslak):
//   Moisture Farm  - every 50% steps the water it makes up a grade; 49% still makes ghostwater
//   Water Purifier - lowers the contaminant floor at 50 / 75 / 100 / 200%; negative Quality does nothing
export type QualityBreakpoint = { value: number; label: string; hint: string };

const QUALITY_BREAKPOINTS: [string, QualityBreakpoint[]][] = [
    ['moisture farm', [
        { value: 0, label: 'Ghostwater', hint: '96-98% water. Pitcher: 75% high-quality, 25% basewater' },
        { value: 50, label: 'Basewater', hint: '98-99% water. Pitcher: always high-quality' },
        { value: 100, label: 'High-quality', hint: '99-99.9% water. Pitcher: 26% pure' },
        { value: 150, label: 'Pure', hint: '99.9%+ water, no filtering needed' },
    ]],
    ['water purifier', [
        { value: 50, label: 'Contaminants ÷3', hint: 'Contaminant floor divided by 3' },
        { value: 75, label: 'Pure (pre-filtered)', hint: 'Pure water from a basic source filtered in a pitcher first (floor ÷5)' },
        { value: 100, label: 'Pure', hint: 'Pure water from any basic source: traders, tap, moisture farm (floor ÷12.5)' },
        { value: 200, label: '100% water', hint: 'Contaminant floor 0%: converts everything' },
    ]],
];

export const qualityBreakpoints = (machineType: string): QualityBreakpoint[] | null => {
    const name = (machineType.split(' > ').pop() || '').toLowerCase();
    const hit = QUALITY_BREAKPOINTS.find(([keyword]) => name.includes(keyword));
    return hit ? hit[1] : null;
};

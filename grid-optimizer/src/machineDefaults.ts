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

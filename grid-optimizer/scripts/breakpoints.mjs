// Writes BREAKPOINTS.md (repo root) and its ladder pictures (docs/breakpoints/*.svg) from the site's own machine rules
// (src/machineDefaults.ts), so the chart always matches what the optimizer uses. Run after changing a machine formula:
//   npm run breakpoints
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SVG_DIR = 'docs/breakpoints';
mkdirSync(ROOT + SVG_DIR, { recursive: true });

// ---- ladder pictures: a stat's breakpoints as ticks on a line, the total % above each tick and what it gives below.
// Ticks are evenly spaced (in order, not to scale). A dark card (GitHub's dark palette), like the site
const COLORS = { Performance: '#f85149', Quality: '#e3b341', Efficiency: '#3fb950', Work: '#58a6ff' };
const BG = '#161b22', EDGE = '#30363d', TEXT = '#e6edf3', MUTED = '#8b949e';
const W = 760, PAD = 28, ROW = 96;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ladderSvg = (ladders) => {
    const h = ladders.length * ROW + 16;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif">`,
        `<rect width="${W}" height="${h}" rx="10" fill="${BG}" stroke="${EDGE}"/>`];
    ladders.forEach((l, i) => {
        const top = 8 + i * ROW;
        const color = COLORS[l.stat] ?? COLORS.Work;
        const y = top + 54;
        const x0 = PAD + 10, x1 = W - PAD - 10;
        const n = l.ticks.length;
        const xs = l.ticks.map((_, k) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1)));
        parts.push(`<text x="${PAD}" y="${top + 20}" font-size="14" font-weight="600" fill="${TEXT}">${esc(l.title)}</text>`);
        parts.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${EDGE}" stroke-width="3" stroke-linecap="round"/>`);
        if (n > 1) parts.push(`<line x1="${x0}" y1="${y}" x2="${xs[n - 1]}" y2="${y}" stroke="${color}" stroke-opacity="0.45" stroke-width="3" stroke-linecap="round"/>`);
        l.ticks.forEach((t, k) => {
            const last = k === n - 1;
            const anchor = n > 1 && k === 0 ? 'start' : n > 1 && last ? 'end' : 'middle';
            const tx = anchor === 'start' ? xs[k] - 6 : anchor === 'end' ? xs[k] + 6 : xs[k];
            parts.push(`<circle cx="${xs[k]}" cy="${y}" r="${last ? 7 : 5.5}" fill="${color}" stroke="${BG}" stroke-width="2"/>`);
            parts.push(`<text x="${tx}" y="${y - 13}" font-size="12" text-anchor="${anchor}" fill="${MUTED}">${esc(t.at)}</text>`);
            parts.push(`<text x="${tx}" y="${y + 24}" font-size="13" text-anchor="${anchor}" fill="${TEXT}"${last ? ' font-weight="600"' : ''}>${esc(t.gives)}</text>`);
        });
    });
    parts.push('</svg>');
    return parts.join('\n');
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
    const m = await server.ssrLoadModule('/src/machineDefaults.ts');
    const out = [];
    const line = (s = '') => out.push(s);
    const table = (head, rows) => {
        line(`| ${head.join(' | ')} |`);
        line(`|${head.map(() => '---').join('|')}|`);
        for (const r of rows) line(`| ${r.join(' | ')} |`);
        line();
    };
    const pct = v => `${v}%`;
    // The picture's link carries a hash of its content: GitHub caches images by URL, so a changed picture needs a new one
    const picture = (file, ladders, alt) => {
        const svg = ladderSvg(ladders);
        writeFileSync(`${ROOT}${SVG_DIR}/${file}.svg`, svg);
        const v = createHash('sha1').update(svg).digest('hex').slice(0, 8);
        line(`<img src="${SVG_DIR}/${file}.svg?v=${v}" alt="${esc(alt)}" width="${W}">`);
        line();
    };
    /* A job machine's days as a grid: one row per job, one column per number of days, each cell the Performance % that gets the job
     * done in that many days ("0%" where it already is, empty where it is never that slow). Days from the steps' "Nd" labels
     */
    const dayCells = (perf, maxDays) => {
        const at = new Map(perf.map(s => [Number(s.short.replace(/d$/, '')), s.value]));
        const slowest = Math.max(...at.keys());
        return Array.from({ length: maxDays }, (_, i) => maxDays - i).map(d => (d > slowest ? '' : at.has(d) ? `${at.get(d)}%` : ''));
    };
    const dayHeads = maxDays => Array.from({ length: maxDays }, (_, i) => `${maxDays - i}d`);
    const slowestDays = perf => Math.max(...perf.map(s => Number(s.short.replace(/d$/, ''))));
    // A job's work, from its day steps' hint ("..., 43 needed)")
    const workOf = perf => Number(/(\d+) needed/.exec(perf[0].hint)?.[1] ?? NaN);
    const fromBreakpoints = (list, start) => [...(start ? [start] : []), ...list.map(b => ({ at: pct(b.value), gives: b.short ?? b.label }))];

    // Each machine: icon, name, one plain sentence, its ladders
    const MACHINES = [
        ['moisture_farm', 'Moisture Farm', 'moisture_farm.png'], ['water_purifier', 'Water Purifier', 'water_purifier.png'], ['furnace', 'Furnace', 'furnace.png'],
        ['agewell', 'AgeWell', 'agewell.png'], ['mirage', 'Mirage Projector', 'mirage_projector.png'], ['alarm', 'Alarm System', 'alarm_system.png'],
        ['desequencer', 'Cryptographic Desequencer', 'desequencer.png'], ['hydroponic', 'Hydroponic System', 'hydroponic.png'],
        ['dna', 'DNA Manipulator', 'dna_manipulator.png'], ['printer', '3D Printer', 'printer.png'], ['deal_maker', 'Deal Maker', 'deal_maker.png'],
        ['evaporator', 'Evaporator', 'evaporator.png'],
    ];
    const icon = (file, size) => `<img src="grid-optimizer/public/machines/${file}" width="${size}" height="${size}" alt="">`;
    // Plain markdown headings: GitHub gives them their anchors (the name, lowercased, spaces to dashes); ids set by hand are dropped
    // The icon before the name leaves a leading dash: "## <img> Moisture Farm" -> #-moisture-farm
    const slug = name => '-' + name.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
    const heading = (id) => {
        const [, name, file] = MACHINES.find(([k]) => k === id);
        line(`## ${icon(file, 32)} ${name}`);
        line();
    };

    line('# Machine breakpoints');
    line();
    line('The total % a machine needs (from all its modules) for each step up. Between steps, more % does nothing.');
    line();
    line(MACHINES.map(([, name, file]) => `<a href="#${slug(name)}" title="${name}">${icon(file, 40)}</a>`).join(' '));
    line();

    // Moisture Farm
    heading('moisture_farm');
    line('**Quality** sets the water grade. **Performance** makes more water: 850 ml a day, +1% per 1% (farms running the same night share the air).');
    line();
    picture('moisture_farm', [{ stat: 'Quality', title: 'Quality → water grade', ticks: fromBreakpoints(m.statBreakpoints('Moisture Farm 1', 'Quality'), { at: 'below 0%', gives: 'Rust' }) }], 'Moisture Farm quality breakpoints');

    // Water Purifier
    heading('water_purifier');
    line('**Quality** sets how clean the water can get. **Performance** cleans faster: +1% per 1% (dirty water up to 20 times faster).');
    line();
    picture('water_purifier', [{ stat: 'Quality', title: 'Quality → cleanest it gets', ticks: [
        { at: '0%', gives: '99% (high-quality)' }, { at: '100%', gives: '99.9% (pure)' }, { at: '200%', gives: '100%' }] }], 'Water Purifier quality breakpoints');

    // Furnace
    heading('furnace');
    line('**Quality** raises ingot purity one stage per full 100%, up to Perfect. **Performance** does nothing. Purity by recipe and Quality:');
    line();
    // Each recipe's purity at each Quality step, read from the steps' hints ("2 ore → Perfect Purity · ..."); 0% is one stage below 100%
    // without Blast, and one stage below the Blast's own 100% step with it
    const PURITY = ['Very Low', 'Low', 'Fair', 'High', 'Very High', 'Perfect'];
    const purityGrid = (blast) => {
        const bps = m.statBreakpoints('Furnace 1', 'Quality', blast);
        const byRecipe = new Map();
        bps.forEach((b, i) => b.hint.replace(/ \(Blast[^)]*\)/g, '').split(' · ').forEach(part => {
            const [recipe, purity] = part.split(' → ');
            if (!byRecipe.has(recipe)) byRecipe.set(recipe, []);
            byRecipe.get(recipe)[i] = purity.replace(' Purity', '');
        }));
        const rows = [...byRecipe].map(([recipe, cells]) => {
            const first = PURITY.indexOf(cells[0]);
            const start = PURITY[Math.max(0, first - 1)];
            return [`**${recipe}**`, start, ...cells.map(c => (c === 'Perfect' ? '**Perfect**' : c))];
        });
        table(['Recipe', '0%', ...bps.map(b => `${b.value}%`)], rows);
    };
    line('**Without Blast** (1 ingot from 2 materials)');
    line();
    purityGrid(false);
    line('**With a Blast module** (2 ingots from 3 materials, one stage less)');
    line();
    purityGrid(true);

    // AgeWell
    heading('agewell');
    line('**Quality** ages wine extra days each night. **Performance** lowers energy use, like Efficiency.');
    line();
    picture('agewell', [{ stat: 'Quality', title: 'Quality → days aged per night', ticks: [{ at: '0%', gives: '1 day' }, ...m.statBreakpoints('AgeWell 1', 'Quality').map((b, i) => ({ at: pct(b.value), gives: `${i + 2} days` }))] }], 'AgeWell quality breakpoints');

    // Mirage
    heading('mirage');
    line('No breakpoints: attractiveness is **100 points + 1 per 2% Quality + 1 per 4% Performance**. Projectors do not stack; the best one counts.');
    line();

    // Alarm
    heading('alarm');
    line(`**Performance** raises the chance to stop a theft. The game shows 50% + Performance, but it rolls one point in your favour, so **${m.ALARM_SURE_STOP}%** already stops every theft. Only one alarm counts.`);
    line();
    picture('alarm', [{ stat: 'Performance', title: 'Performance → chance to stop a theft', ticks: [{ at: '0%', gives: '51%' }, { at: '25%', gives: '76%' }, { at: `${m.ALARM_SURE_STOP}%`, gives: '100%' }] }], 'Alarm System performance breakpoints');

    // Desequencer
    heading('desequencer');
    line('**Performance** decodes faster: 33 work a day, +1 per ~3% Performance. Cells are the Performance % for that many days. **Quality** does nothing.');
    line();
    const deseqMax = Math.max(...m.DESEQUENCER_CHIPSETS.map(c => m.desequencerDayOptions(c.work)[0].days));
    table(['Keycard', 'Work', ...dayHeads(deseqMax)], m.DESEQUENCER_CHIPSETS.map(c => {
        const opts = m.desequencerDayOptions(c.work);
        return [`**${c.name}**`, String(c.work), ...dayCells(opts.map(o => ({ short: `${o.days}d`, value: o.value })), deseqMax)];
    }));

    // Hydroponic
    const hydro = m.machineJobs('Hydroponic System 1').jobs;
    heading('hydroponic');
    line('Plain seeds, their innate traits included (a seed changed in the DNA Manipulator differs; the optimizer reads yours from the save).');
    line();
    line('**Growth:** 8 work a day, +1 per full 25% Performance. Cells are the Performance % to grow in that many days.');
    line();
    const hydroMax = Math.max(...hydro.map(j => slowestDays(j.steps.Performance)));
    table(['Plant', 'Work', ...dayHeads(hydroMax)], hydro.map(j => [`**${j.name}**`, String(workOf(j.steps.Performance)), ...dayCells(j.steps.Performance, hydroMax)]));
    line('**Harvest:** +1% items per 2% Quality, rounded. Cells are the Quality % for each extra item.');
    line();
    table(['Plant', 'Items', '+1', '+2', '+3', '+4', 'Note'], hydro.filter(j => j.steps.Quality?.length).map(j => {
        const q = j.steps.Quality;
        const base = Number(/instead of (\d+)/.exec(q[0].hint)?.[1] ?? NaN);
        const extra = n => { const s = q.find(x => x.short === `+${n}`); return s ? `${s.value}%` : ''; };
        const huge = q.find(x => x.short === 'Huge');
        return [`**${j.name}**`, String(base), extra(1), extra(2), extra(3), extra(4), huge ? `all Huge from ${huge.value}%` : ''];
    }));

    // DNA
    const dna = m.machineJobs('DNA Manipulator 1').jobs;
    heading('dna');
    line('**Performance:** 10 work a day, +1 per full 20%. An operation at complexity c needs 20 + 4c work. **Quality:** success is 95 − 5c + Quality / 2 %.');
    line();
    const dnaMax = Math.max(...dna.map(j => slowestDays(j.steps.Performance)));
    table(['Complexity', 'Work', 'Success at 0%', '100% success at', ...dayHeads(dnaMax)], dna.map(j => {
        const c = Number(j.key);
        return [`**${c}**`, String(workOf(j.steps.Performance)), `${Math.max(5, 95 - 5 * c)}%`, `**${j.steps.Quality[0].value}%**`, ...dayCells(j.steps.Performance, dnaMax)];
    }));

    // 3D Printer
    const prints = m.machineJobs('3D Printer 1').jobs;
    heading('printer');
    line('**Performance:** 24 work a day, +1 per ~4.2% Performance. Chips of 24 work or less (scopes, lasers, suppressor, .22 mags, small parts) take 1 day.');
    line();
    const printMax = Math.max(...prints.map(j => slowestDays(j.steps.Performance)));
    table(['Chip', 'Work', ...dayHeads(printMax)], prints.map(j => [`**${j.name}**`, String(workOf(j.steps.Performance)), ...dayCells(j.steps.Performance, printMax)]));
    const knife = prints.find(j => j.key === 'combat_knife');
    line('**Quality** sets a printed melee weapon\'s condition: it rolls 20-30 + Quality / 4 (+ the ingot\'s quality bonus).');
    line();
    table(['Quality', ...knife.steps.Quality.map(s => `${s.value}%`)], [['**Condition**', ...knife.steps.Quality.map(s => s.label.replace('+', ' or better'))]]);

    // Deal Maker
    heading('deal_maker');
    line('No breakpoints: **Quality** adds 1% accept chance on a haggle per 10% (10% to start). **Performance** lowers energy use, like Efficiency.');
    line();

    // Evaporator
    heading('evaporator');
    line('**Quality** is the share of what evaporates that you keep, up to 100%. **Performance** evaporates more: 300 ml a day, +1% per 1%. With the Solvent Recovery module only alcohol is kept.');
    line();
    picture('evaporator', [{ stat: 'Quality', title: 'Quality → share kept', ticks: [{ at: '0%', gives: 'nothing' }, { at: '50%', gives: 'half' }, { at: `${m.EVAPORATOR_QUALITY_CAP}%`, gives: 'all (more does nothing)' }] }], 'Evaporator quality breakpoints');

    // Energy
    line('## Energy');
    line();
    line('**Efficiency** lowers every machine\'s energy use, one point at a time, never below 1. On the AgeWell and the Deal Maker, Performance counts too.');
    line();
    const energy = [
        ['Water Purifier, Alarm System', 'Water Purifier 1'], ['Moisture Farm, Evaporator', 'Moisture Farm 1'], ['Furnace, Hydroponic, 3D Printer', 'Furnace 1'],
        ['Desequencer', 'Cryptographic Desequencer 1'], ['DNA Manipulator', 'DNA Manipulator 1'], ['Mirage Projector', 'Mirage Projector 1'],
        ['AgeWell', 'AgeWell 1'], ['Deal Maker', 'Deal Maker 1'],
    ];
    table(['Machine', 'Energy', '−1 for every'], energy.map(([title, machine]) => {
        const rule = m.statEffect(machine, 'Efficiency').replace(/^Energy use: /, '');
        const [, base, per] = /^(\d+ a (?:day|use)), 1 less per (.*)$/.exec(rule) ?? [null, rule, ''];
        return [title, base, per];
    }));

    line('---');
    line();
    line('Generated from the optimizer\'s own rules (`grid-optimizer/src/machineDefaults.ts`, checked against the game\'s code) by `npm run breakpoints`. Do not edit by hand.');

    writeFileSync(ROOT + 'BREAKPOINTS.md', out.join('\n') + '\n');
    console.log(`wrote BREAKPOINTS.md and ${SVG_DIR}/*.svg`);
} finally {
    await server.close();
}

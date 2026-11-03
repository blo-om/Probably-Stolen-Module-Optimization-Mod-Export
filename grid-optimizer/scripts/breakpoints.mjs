// Writes BREAKPOINTS.md (repo root) and its ladder pictures (docs/breakpoints/*.svg) from the site's own machine rules
// (src/machineDefaults.ts), so the chart always matches what the optimizer uses. Run after changing a machine formula:
//   npm run breakpoints
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SVG_DIR = 'docs/breakpoints';
mkdirSync(ROOT + SVG_DIR, { recursive: true });

// ---- ladder pictures: a stat's breakpoints as ticks on a line, the total % above each tick and what it gives below.
// Ticks are evenly spaced (in order, not to scale). Their own light card, so they read on GitHub's light and dark themes alike
const COLORS = { Performance: '#d64545', Quality: '#c99a06', Efficiency: '#3f9b4a', Work: '#4b7bd1' };
const W = 760, PAD = 28, ROW = 96;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ladderSvg = (ladders) => {
    const h = ladders.length * ROW + 16;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="-apple-system, Segoe UI, Helvetica, Arial, sans-serif">`,
        `<rect width="${W}" height="${h}" rx="10" fill="#f6f8fa" stroke="#d0d7de"/>`];
    ladders.forEach((l, i) => {
        const top = 8 + i * ROW;
        const color = COLORS[l.stat] ?? COLORS.Work;
        const y = top + 54;
        const x0 = PAD + 10, x1 = W - PAD - 10;
        const n = l.ticks.length;
        const xs = l.ticks.map((_, k) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1)));
        parts.push(`<text x="${PAD}" y="${top + 20}" font-size="14" font-weight="600" fill="#24292f">${esc(l.title)}</text>`);
        parts.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#d0d7de" stroke-width="3" stroke-linecap="round"/>`);
        if (n > 1) parts.push(`<line x1="${x0}" y1="${y}" x2="${xs[n - 1]}" y2="${y}" stroke="${color}" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>`);
        l.ticks.forEach((t, k) => {
            const last = k === n - 1;
            const anchor = n > 1 && k === 0 ? 'start' : n > 1 && last ? 'end' : 'middle';
            const tx = anchor === 'start' ? xs[k] - 6 : anchor === 'end' ? xs[k] + 6 : xs[k];
            parts.push(`<circle cx="${xs[k]}" cy="${y}" r="${last ? 7 : 5.5}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`);
            parts.push(`<text x="${tx}" y="${y - 13}" font-size="12" text-anchor="${anchor}" fill="#57606a">${esc(t.at)}</text>`);
            parts.push(`<text x="${tx}" y="${y + 24}" font-size="13" text-anchor="${anchor}" fill="#24292f"${last ? ' font-weight="600"' : ''}>${esc(t.gives)}</text>`);
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
    const details = (summary, body) => { line(`<details><summary>${summary}</summary>`); line(); body(); line('</details>'); line(); };
    const pct = v => `${v}%`;
    const picture = (file, ladders, alt) => {
        writeFileSync(`${ROOT}${SVG_DIR}/${file}.svg`, ladderSvg(ladders));
        line(`<img src="${SVG_DIR}/${file}.svg" alt="${esc(alt)}" width="${W}">`);
        line();
    };
    const fromBreakpoints = (list, start) => [...(start ? [start] : []), ...list.map(b => ({ at: pct(b.value), gives: b.short ?? b.label }))];
    const daysTicks = list => list.map(s => ({ at: pct(s.value), gives: s.short.replace(/d$/, s.short === '1d' ? ' day' : ' days') }));
    const steps = list => (list && list.length ? list.map(s => `**${s.value}%** ${s.short ?? s.label}`).join(' · ') : '—');

    // Each machine: icon, name, one plain sentence, its ladders
    const MACHINES = [
        ['moisture_farm', 'Moisture Farm', 'moisture_farm.png'], ['water_purifier', 'Water Purifier', 'water_purifier.png'], ['furnace', 'Furnace', 'furnace.png'],
        ['agewell', 'AgeWell', 'agewell.png'], ['mirage', 'Mirage Projector', 'mirage_projector.png'], ['alarm', 'Alarm System', 'alarm_system.png'],
        ['desequencer', 'Cryptographic Desequencer', 'desequencer.png'], ['hydroponic', 'Hydroponic System', 'hydroponic.png'],
        ['dna', 'DNA Manipulator', 'dna_manipulator.png'], ['printer', '3D Printer', 'printer.png'], ['deal_maker', 'Deal Maker', 'deal_maker.png'],
        ['evaporator', 'Evaporator', 'evaporator.png'],
    ];
    const icon = (file, size) => `<img src="grid-optimizer/public/machines/${file}" width="${size}" height="${size}" alt="">`;
    const heading = (id) => {
        const [, name, file] = MACHINES.find(([k]) => k === id);
        line(`<h2 id="${id}">${icon(file, 32)} ${name}</h2>`);
        line();
    };

    line('# Machine breakpoints');
    line();
    line('A breakpoint is the **total %** (what a machine\'s stat card shows, from all its modules) where the machine gets better at something.');
    line('Between two breakpoints, more % does nothing. Ticks are in order, not to scale.');
    line();
    line(MACHINES.map(([id, name, file]) => `<a href="#${id}" title="${name}">${icon(file, 40)}</a>`).join(' '));
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
    line('**Quality** raises ingot purity one stage per full 100%. **Performance** does nothing. A Blast module takes one stage off.');
    line('Starting purity depends on the ore in the recipe: 2 ore High, 1 ore Fair, none Low (with Blast: 3 ore High, 2 Fair, 1 or none Low).');
    line();
    const furnace = m.statBreakpoints('Furnace 1', 'Quality', false);
    const blast = m.statBreakpoints('Furnace 1', 'Quality', true);
    picture('furnace', [
        { stat: 'Quality', title: 'Quality → purity stages added', ticks: [{ at: '0%', gives: 'starting purity' }, ...furnace.map(b => ({ at: pct(b.value), gives: `${b.short} stage${b.short === '+1' ? '' : 's'}` }))] },
        { stat: 'Quality', title: 'With a Blast module', ticks: [{ at: '0%', gives: '−1 stage' }, ...blast.map(b => ({ at: pct(b.value), gives: b.short === '+0' ? 'starting purity' : `${b.short} stage${b.short === '+1' ? '' : 's'}` }))] },
    ], 'Furnace quality breakpoints');
    details('Purity per recipe', () => {
        table(['Quality', 'Without Blast'], furnace.map(b => [`**${b.value}%**`, b.hint]));
        table(['Quality', 'With Blast'], blast.map(b => [`**${b.value}%**`, b.hint]));
    });

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
    line('**Performance** decodes keycards faster (33 work a day, +1% per 1%). Each keycard takes whole days, so only these totals matter. **Quality** does nothing.');
    line();
    picture('desequencer', m.DESEQUENCER_CHIPSETS.map(c => ({
        stat: 'Performance', title: `${c.name} keycard (${c.work} work) → days`,
        ticks: m.desequencerDayOptions(c.work).map(o => ({ at: pct(o.value), gives: `${o.days} day${o.days === 1 ? '' : 's'}` })),
    })), 'Desequencer performance breakpoints per keycard');

    // Hydroponic
    const hydro = m.machineJobs('Hydroponic System 1').jobs;
    heading('hydroponic');
    line('**Performance** grows plants in fewer days (8 work a day, +1 per full 25%). **Quality** adds items to each harvest. Every plant has its own steps; Nutrifruit as an example:');
    line();
    const nutri = hydro.find(j => j.key === 'nutrifruit');
    picture('hydroponic', [
        { stat: 'Performance', title: 'Nutrifruit: Performance → days to grow', ticks: daysTicks(nutri.steps.Performance) },
        { stat: 'Quality', title: 'Nutrifruit: Quality → items a harvest (7 base)', ticks: [{ at: '0%', gives: '7' }, ...nutri.steps.Quality.map(s => ({ at: pct(s.value), gives: s.short === 'Huge' ? 'all Huge' : `${7 + Number(s.short)}` }))] },
    ], 'Hydroponic System breakpoints for Nutrifruit');
    details('Every plant (plain seeds, their innate traits included)', () => table(['Plant', 'Performance → days', 'Quality → extra items'],
        hydro.map(j => [j.name, j.steps.Performance.map(s => `**${s.value}%** ${s.short}`).join(' · '), steps(j.steps.Quality)])));

    // DNA
    const dna = m.machineJobs('DNA Manipulator 1').jobs;
    heading('dna');
    line('**Performance** finishes operations in fewer days. **Quality** raises the success chance: 100% at **10 + 10 × complexity**. Complexity 5 as an example:');
    line();
    const c5 = dna[5];
    picture('dna', [
        { stat: 'Performance', title: 'Complexity 5: Performance → days', ticks: daysTicks(c5.steps.Performance) },
        { stat: 'Quality', title: 'Complexity 5: Quality → success chance', ticks: [{ at: '0%', gives: '70%' }, { at: '30%', gives: '85%' }, { at: pct(c5.steps.Quality[0].value), gives: '100%' }] },
    ], 'DNA Manipulator breakpoints for complexity 5');
    details('Every complexity (0-15)', () => table(['Complexity', 'Performance → days', 'Quality for 100%'],
        dna.map(j => [j.key, j.steps.Performance.map(s => `**${s.value}%** ${s.short}`).join(' · '), `**${j.steps.Quality[0].value}%**`])));

    // 3D Printer
    const prints = m.machineJobs('3D Printer 1').jobs;
    heading('printer');
    line('**Performance** prints in fewer days (24 work a day, +1% per 1%). **Quality** improves printed melee weapons. Combat Knife as an example:');
    line();
    const knife = prints.find(j => j.key === 'combat_knife');
    picture('printer', [
        { stat: 'Performance', title: 'Combat Knife: Performance → days', ticks: daysTicks(knife.steps.Performance) },
        { stat: 'Quality', title: 'Melee weapons: Quality → condition (without an ingot bonus)', ticks: [{ at: '0%', gives: 'Poor-Fair' }, ...knife.steps.Quality.map(s => ({ at: pct(s.value), gives: s.label.replace('+', ' or better') }))] },
    ], '3D Printer breakpoints for the Combat Knife');
    details('Every chip', () => table(['Chip', 'Performance → days'], prints.map(j => [j.name, j.steps.Performance.map(s => `**${s.value}%** ${s.short}`).join(' · ')])));

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
    line('<h2 id="energy">Energy</h2>');
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

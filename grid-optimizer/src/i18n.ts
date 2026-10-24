/* The page's language: English, or Simplified Chinese. Text is written in English in the code and passed through t(), which looks it up
 * in zh.ts. Game terms (machines, modules, stats, effects, water grades...) there are the game's own Chinese strings (its Item, Mechanic
 * and UI localization tables); the rest is worded after them. Save paths and machine names show stock game names in the game's own
 * translation (zhItems.ts), names the player gave as they are. Only what is shown changes: the English names the site works with
 * internally (module display names, machine types, save paths sent to the mod) stay as they are.
 */
import { useSyncExternalStore } from 'react';
import { ZH } from './zh';
import { ZH_ITEMS } from './zhItems';

export type Lang = 'en' | 'zh';
export const LANG_KEY = 'optimizer_lang';

const initial = (): Lang => {
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === 'en' || saved === 'zh') return saved;
    } catch { /* storage unavailable */ }
    return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en';
};

let lang: Lang = initial();
const listeners = new Set<() => void>();
const applyDocument = () => {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
        document.title = t('Module Optimizer (Mod Export)');
    }
};

export const getLang = () => lang;
export const setLang = (next: Lang) => {
    if (next === lang) return;
    lang = next;
    try { localStorage.setItem(LANG_KEY, next); } catch { /* applies to this visit only */ }
    applyDocument();
    listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
// Components that show text call this, so they render again when the language changes
export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);

/* `text` in English, with {name} placeholders filled from `vars`. In Chinese the same text is looked up in ZH; text without an entry
 * stays English (a missing translation shows, it never breaks anything)
 */
export const t = (text: string, vars?: Record<string, string | number>): string => {
    let out = lang === 'zh' ? ZH[text] ?? text : text;
    if (vars) out = out.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
    return out;
};
/* A name from the save ("Furnace 2", "Machine Bay (Expanded) 1") in the page's language: a stock game name with its number gets the
 * game's own translation; a name the player gave stays as it is
 */
export const gameName = (name: string): string => {
    if (lang !== 'zh') return name;
    const m = /^(.*?)( \d+)?$/.exec(name)!;
    const base = ZH_ITEMS[m[1]] ?? ZH[m[1]];
    return base ? base + (m[2] ?? '') : name;
};
// A save path ("Inv. > Machine Bay (Expanded) 1 > Furnace 2") with each part as gameName shows it
export const pathLabel = (path: string): string => (lang !== 'zh' ? path : path.split(' > ').map(part => (part === 'Inv.' ? t('Inv.') : gameName(part))).join(' > '));

// A module's name as shown. Modules added from the site's own list are named by their stat ("Performance", "Overclock"): those read as
// the game's module names ("Performance Module" -> 性能模组), not as the stat
const BARE_MODULES = ['Performance', 'Quality', 'Efficiency', 'Overclock', 'Refinement', 'Eco'];
export const moduleName = (displayName: string) => t(BARE_MODULES.includes(displayName) ? `${displayName} Module` : displayName);

// English plural ending, for text whose Chinese has none: t('{n} machine{s}', { n, s: plural(n) })
export const plural = (n: number) => (n === 1 ? '' : 's');

applyDocument();

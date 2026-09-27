// Export format read by the Module Loadout MelonLoader mod.
//
//   PSMOD1:<base64url(UTF-8 JSON)>
//   JSON: { "v": 1, "machines": [ { "name": "<machine name>", "code": "<solution code>" }, ... ] }
//
// `name` is the machine's name as shown on its card - for machines imported from a save, the full path the save
// importer builds (e.g. "Inv. > Machine Bay (Expanded) 1 > Furnace 2"), which the mod rebuilds in-game with the
// same rules to find the matching machine. `code` is the unchanged solution code, so it still imports on this site.
// The whole string contains no whitespace, so it survives being pasted anywhere.

export const MOD_EXPORT_PREFIX = 'PSMOD1:';

export interface ModExportMachine {
    name: string;
    code: string;
}

const toBase64Url = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const encodeModExport = (machines: ModExportMachine[]) =>
    MOD_EXPORT_PREFIX + toBase64Url(JSON.stringify({ v: 1, machines }));

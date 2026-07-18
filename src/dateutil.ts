import { App } from "obsidian";
import moment from "moment";
import { Moment } from "moment";

// The original "Natural Language Dates" (argenos/nldates-obsidian) appears
// unmaintained; Obsidian's community plugin directory now also lists an
// actively maintained fork, "Natural Language Dates (Revived)"
// (Amato21/nldates-revived) - a *new* plugin id, not just a renamed listing,
// so a user could have either installed. Both expose the same
// `parseDate(text): { moment }` shape (verified against the fork's own
// published API.md), so nothing else here needs to change - just which id
// to look for.
const NLDATES_PLUGIN_IDS = ["nldates-obsidian", "nldates-revived"];

// Finds whichever Natural Language Dates variant (if any) is installed.
export function getNldatesPlugin(app: App): any | null {
    for (const id of NLDATES_PLUGIN_IDS) {
        const plugin = (app as any).plugins.getPlugin(id);
        if (plugin)
            return plugin;
    }
    return null;
}

// Parse a date, first strictly against the configured format, then (if that
// fails) relaxed via a Natural Language Dates plugin, if one is installed.
// That plugin is an optional soft dependency: if neither variant is
// installed, only strict parsing is available.
export function parseDate(app: App, dt: string, format: string): Moment {
    let res = moment(dt, format, true); // First try strict mode with the format from settings
    if (!res.isValid()) { // Strict parsing failed.
        const nldatesPlugin = getNldatesPlugin(app);
        if (nldatesPlugin)
            res = nldatesPlugin.parseDate(dt).moment; // Be more relaxed if possible
    }
    return res;
}

import { App } from "obsidian";
import moment from "moment";
import { Moment } from "moment";

// Parse a date, first strictly against the configured format, then (if that
// fails) relaxed via the "Natural Language Dates" community plugin, if it's
// installed. That plugin is an optional soft dependency: if it's missing,
// only strict parsing is available.
export function parseDate(app: App, dt: string, format: string): Moment {
    let res = moment(dt, format, true); // First try strict mode with the format from settings
    if (!res.isValid()) { // Strict parsing failed.
        const nldatesPlugin = (app as any).plugins.getPlugin("nldates-obsidian");
        if (nldatesPlugin)
            res = nldatesPlugin.parseDate(dt).moment; // Be more relaxed if possible
    }
    return res;
}

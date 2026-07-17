import { App, TFile } from "obsidian";

// Soft dependency on the community "Templater" plugin (templater-obsidian),
// mirroring dateutil.ts's nldates-obsidian integration. Templater has no
// official/stable public API for "render this template file and return the
// string" - this reaches into its internal, undocumented `templater` object,
// which can change across Templater versions. Every caller must be prepared
// for this to throw, or return null, and fall back to the plugin's own
// hardcoded output - never leave the user with nothing.
//
// NOTE: the RunMode value and the create_running_config/read_and_parse_template
// method names below are Templater internals, not a documented API - verified
// against Templater 2.20.6's actual bundled source (test-vault/.obsidian/
// plugins/templater-obsidian/main.js): `create_running_config(template_file,
// target_file, run_mode)` returns `{template_file, target_file, run_mode,
// active_file}`, `read_and_parse_template(config)` reads template_file's
// content and hands it to `parse_template`, and `RunMode.DynamicProcessor`
// is enum value `4`. Re-verify the same way if a future Templater version
// changes this and template rendering starts misbehaving.
const DYNAMIC_PROCESSOR_RUN_MODE = 4;

export function getTemplaterPlugin(app: App): any | null {
    return (app as any).plugins?.plugins?.["templater-obsidian"] ?? null;
}

// Renders a Templater template file and returns its output, or null if
// Templater isn't installed, or the path is empty or doesn't resolve to a
// file - both "not applicable" cases callers should fall back on silently.
// A genuine render exception (a broken template) is left to propagate, so
// callers can show a distinct notice for that case instead of treating it
// the same as "no template configured".
export async function renderTemplaterFile(app: App, path: string): Promise<string | null> {
    if (!path)
        return null;
    const templaterPlugin = getTemplaterPlugin(app);
    if (!templaterPlugin)
        return null;

    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile))
        return null;

    const runningConfig = templaterPlugin.templater.create_running_config(file, file, DYNAMIC_PROCESSOR_RUN_MODE);
    return await templaterPlugin.templater.read_and_parse_template(runningConfig);
}

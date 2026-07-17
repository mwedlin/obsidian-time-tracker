import { App, PluginSettingTab, Setting } from "obsidian";
import TimeTrackerPlugin from "./main";
import { defaultSettings, TimeTrackerSettings } from "./settings";

type UpdateIntervalKey = keyof Pick<TimeTrackerSettings, "timerUpdateSeconds" | "statusUpdateSeconds" | "todayUpdateSeconds">;

export class TimeTrackerSettingsTab extends PluginSettingTab {

    plugin: TimeTrackerPlugin;

    constructor(app: App, plugin: TimeTrackerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        this.containerEl.empty();
        this.containerEl.createEl("h2", { text: "Time Tracker Settings" });

        new Setting(this.containerEl)
            .setName("Timestamp Display Format")
            .setDesc(createFragment(f => {
                f.createSpan({ text: "The way that timestamps in time tracker tables should be displayed. Uses " });
                f.createEl("a", { text: "moment.js", href: "https://momentjs.com/docs/#/parsing/string-format/" });
                f.createSpan({ text: " syntax." });
            }))
            .addText(t => {
                t.setValue(String(this.plugin.settings.timestampFormat));
                t.onChange(async v => {
                    this.plugin.settings.timestampFormat = v.length ? v : defaultSettings.timestampFormat;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(this.containerEl)
            .setName("CSV Delimiter")
            .setDesc("The delimiter character that should be used when copying a tracker table as CSV. For example, some languages use a semicolon instead of a comma.")
            .addText(t => {
                t.setValue(String(this.plugin.settings.csvDelimiter));
                t.onChange(async v => {
                    this.plugin.settings.csvDelimiter = v.length ? v : defaultSettings.csvDelimiter;
                    await this.plugin.saveSettings();
                });
            });

        this.addUpdateIntervalSetting(
            "Timer display update interval (seconds)",
            "How often the per-note tracker's Current/Total timer refreshes.",
            "timerUpdateSeconds");
        this.addUpdateIntervalSetting(
            "Status widget update interval (seconds)",
            "How often the status widget's live \"Today\" timer refreshes.",
            "statusUpdateSeconds");
        this.addUpdateIntervalSetting(
            "Today widget update interval (seconds)",
            "How often the today widget's live numbers refresh.",
            "todayUpdateSeconds");

        new Setting(this.containerEl)
            .setName("Enable debug command")
            .setDesc("Adds a \"Debug files\" command to the command palette, for development use. Requires reloading the plugin to take effect.")
            .addToggle(t => {
                t.setValue(this.plugin.settings.debugMode);
                t.onChange(async v => {
                    this.plugin.settings.debugMode = v;
                    await this.plugin.saveSettings();
                });
            });

        this.containerEl.createEl("hr");
        this.containerEl.createEl("p", { text: "Questions or feedback? Get in touch: " })
            .createEl("a", { text: "mwe@wewid.se", href: "mailto:mwe@wewid.se" });
    }

    private addUpdateIntervalSetting(name: string, desc: string, key: UpdateIntervalKey): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addText(t => {
                t.setValue(String(this.plugin.settings[key]));
                t.onChange(async v => {
                    const n = parseFloat(v);
                    this.plugin.settings[key] = (v.length && !isNaN(n) && n > 0) ? n : defaultSettings[key];
                    await this.plugin.saveSettings();
                });
            });
    }
}

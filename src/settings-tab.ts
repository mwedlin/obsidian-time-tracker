import { App, PluginSettingTab, Setting } from "obsidian";
import TimeTrackerPlugin from "./main";
import { defaultSettings, TimeTrackerSettings } from "./settings";
import { favoriteCommandName } from "./favorites";
import { toName } from "./report-logic";

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

        this.containerEl.createEl("h3", { text: "Favorite projects" });
        this.containerEl.createEl("p", {
            text: "Each favorite gets its own \"Start <name>\" command in the command palette - and " +
                "anything else that can trigger an Obsidian command, like a StreamDeck through the Local " +
                "REST API community plugin - to start that project/client's tracker without opening its " +
                "note. If the same project/client exists in more than one note, it starts whichever " +
                "currently has a running timer, or otherwise whichever has the most recent completed " +
                "entry. Adding/removing favorites requires reloading the plugin to take effect.",
        });

        for (const favorite of this.plugin.settings.favoriteProjects) {
            new Setting(this.containerEl)
                .setName(toName(favorite.project, favorite.client))
                .setDesc(`Command: "${favoriteCommandName(favorite)}"`)
                .addButton(b => b
                    .setIcon("lucide-trash")
                    .setTooltip("Remove")
                    .onClick(async () => {
                        this.plugin.settings.favoriteProjects = this.plugin.settings.favoriteProjects.filter(f => f !== favorite);
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        }

        let newProject = "";
        let newClient = "";
        new Setting(this.containerEl)
            .setName("Add a favorite")
            .addText(t => t.setPlaceholder("Project").onChange(v => newProject = v))
            .addText(t => t.setPlaceholder("Client").onChange(v => newClient = v))
            .addButton(b => b
                .setButtonText("Add")
                .setCta()
                .onClick(async () => {
                    if (!newProject && !newClient)
                        return;
                    const exists = this.plugin.settings.favoriteProjects.some(f => f.project === newProject && f.client === newClient);
                    if (exists)
                        return;
                    this.plugin.settings.favoriteProjects.push({ project: newProject, client: newClient });
                    await this.plugin.saveSettings();
                    this.display();
                }));

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

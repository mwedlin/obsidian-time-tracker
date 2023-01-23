import { Plugin } from "obsidian";
import { defaultSettings, TimeTrackerSettings } from "./settings";
import { TimeTrackerSettingsTab } from "./settings-tab";
import { displayTracker, loadTracker } from "./tracker";

export default class SimpleTimeTrackerPlugin extends Plugin {

	settings: TimeTrackerSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new TimeTrackerSettingsTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("time-tracker", (s, e, i) => {
			let tracker = loadTracker(s);
			e.empty();
			displayTracker(tracker, e, () => i.getSectionInfo(e), this.settings);
		});

		this.addCommand({
			id: `insert`,
			name: `Insert Time Tracker`,
			editorCallback: (e, _) => {
				e.replaceSelection("```time-tracker\n```\n");
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, defaultSettings, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

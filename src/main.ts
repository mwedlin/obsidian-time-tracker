import { Plugin } from "obsidian";
import { defaultSettings, TimeTrackerSettings } from "./settings";
import { TimeTrackerSettingsTab } from "./settings-tab";
import { displayTracker, loadTracker } from "./tracker";
import { fileSection, readAll, stopAll } from "./files"
import { ReportModal } from "./report"
import { BlockList } from "net";

export default class TimeTrackerPlugin extends Plugin {

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

		this.addCommand({
			id: `stop`,
			name: `Stop all timers`,
			editorCallback: (e, _) => {
				stopAll();
			}
		});

		this.addCommand({
			id: `debug`,
			name: `Debug files`,
			callback: async (e, _) => {
				new ReportModal(this.app).open();
				// var allblocks = await readAll();
				// await stopAll();
				// var i: number;
				// for (i = 0; i<allblocks.length; i++) {
				// 	console.log("File: " + allblocks[i].file.path + ", Start: " + allblocks[i].startPos + ", Projekt: " + allblocks[i].tracker.project);
				// }
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
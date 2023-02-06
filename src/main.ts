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
				e.replaceSelection('```time-tracker\n{"dispType":"default","currTask":"","project":"CUAS","client":"","entries": []}\n```\n');
			}
		});

		this.addCommand({
			id: `insert status`,
			name: `Insert Time Tracker Status`,
			editorCallback: (e, _) => {
				e.replaceSelection('```time-tracker\n{"dispType":"status"}\n```\n');
			}
		});

		this.addCommand({
			id: `insert today status`,
			name: `Insert Time Tracker for logged times today`,
			editorCallback: (e, _) => {
				e.replaceSelection('```time-tracker\n{"dispType":"today"}\n```\n');
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
			id: `Report`,
			name: `Report times`,
			editorCallback: async (editor: Editor) => {
				// const selText = editor.getSelection();

				const onSubmit = (text: String) => {
					editor.replaceSelection(text);
				};

				new ReportModal(this.app, this.settings, onSubmit).open();
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
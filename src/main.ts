import { Editor, MarkdownView, Plugin } from "obsidian";
import { defaultSettings, TimeTrackerSettings } from "./settings";
import { TimeTrackerSettingsTab } from "./settings-tab";
import { displayTracker, displayParseError, loadTracker } from "./tracker";
import { stopAll } from "./files";
import { ReportModal, startFavorite } from "./report";
import { favoriteCommandId, favoriteCommandName } from "./favorites";

export default class TimeTrackerPlugin extends Plugin {

	settings: TimeTrackerSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new TimeTrackerSettingsTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("time-tracker", (s, e, i) => {
			e.empty();
			let tracker = loadTracker(s);
			if (!tracker) {
				displayParseError(e);
				return;
			}
			displayTracker(tracker, e, () => i.getSectionInfo(e), this.settings, this.app);
		});

		this.addCommand({
			id: `insert`,
			name: `Insert Time Tracker`,
			editorCallback: (editor: Editor) => {
				editor.replaceSelection('```time-tracker\n{"dispType":"default","currTask":"","project":"","client":"","entries": []}\n```\n');
			}
		});

		this.addCommand({
			id: `insert status`,
			name: `Insert Time Tracker Status`,
			editorCallback: (editor: Editor) => {
				editor.replaceSelection('```time-tracker\n{"dispType":"status"}\n```\n');
			}
		});

		this.addCommand({
			id: `insert today status`,
			name: `Insert Time Tracker for logged times today`,
			editorCallback: (editor: Editor) => {
				editor.replaceSelection('```time-tracker\n{"dispType":"today"}\n```\n');
			}
		});

		this.addCommand({
			id: `stop`,
			name: `Stop all timers`,
			callback: async () => {
				await stopAll(this.app);
			}
		});

		this.addCommand({
			id: `Report`,
			name: `Report times`,
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const onSubmit = (text: string) => {
					editor.replaceSelection(text);
				};

				new ReportModal(this.app, this.settings, onSubmit).open();
			}
		});

		for (const favorite of this.settings.favoriteProjects) {
			this.addCommand({
				id: favoriteCommandId(favorite),
				name: favoriteCommandName(favorite),
				callback: async () => {
					await startFavorite(this.app, favorite.project, favorite.client);
				}
			});
		}

		if (this.settings.debugMode) {
			this.addCommand({
				id: `debug`,
				name: `Debug files`,
				callback: async () => {
					new ReportModal(this.app, this.settings, text => console.log(text)).open();
				}
			});
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, defaultSettings, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

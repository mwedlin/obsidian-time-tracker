import { Favorite } from "./favorites";

export const defaultSettings: TimeTrackerSettings = {
    timestampFormat: "YY-MM-DD hh:mm:ss",
    csvDelimiter: ",",
    debugMode: false,
    timerUpdateSeconds: 5,
    statusUpdateSeconds: 1,
    todayUpdateSeconds: 30,
    favoriteProjects: [],
    reportTemplatePath: "",
    trackerTableTemplatePath: "",
    trackerCsvTemplatePath: "",
};

export interface TimeTrackerSettings {

    timestampFormat: string;
    csvDelimiter: string;
    // Enables the "Debug files" scratch command, kept out of the command
    // palette by default since it's a development aid, not an end-user feature.
    debugMode: boolean;
    // How often (in seconds) each live-updating display refreshes.
    timerUpdateSeconds: number;  // the per-note tracker's Current/Total timer
    statusUpdateSeconds: number; // the status widget's live "Today" timer
    todayUpdateSeconds: number;  // the today widget's live numbers
    // Each entry gets its own "Start <name>" command (see favorites.ts),
    // e.g. for triggering from a StreamDeck via the Local REST API community
    // plugin. Adding/removing favorites requires reloading the plugin, since
    // commands are registered once at onload.
    favoriteProjects: Favorite[];

    // Vault-relative paths to Templater template files, one per output
    // surface; empty (the default) keeps that surface's built-in hardcoded
    // format completely unchanged. See design.md's Templater integration
    // section.
    reportTemplatePath: string;         // the Report command's table
    trackerTableTemplatePath: string;   // a tracker's "Copy as table" button
    trackerCsvTemplatePath: string;     // a tracker's "Copy as CSV" button

}

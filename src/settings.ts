export const defaultSettings: TimeTrackerSettings = {
    timestampFormat: "YY-MM-DD hh:mm:ss",
    csvDelimiter: ",",
    debugMode: false,
    timerUpdateSeconds: 5,
    statusUpdateSeconds: 1,
    todayUpdateSeconds: 30,
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

}

export const defaultSettings: TimeTrackerSettings = {
    timestampFormat: "YY-MM-DD hh:mm:ss",
    csvDelimiter: ",",
    debugMode: false,
};

export interface TimeTrackerSettings {

    timestampFormat: string;
    csvDelimiter: string;
    // Enables the "Debug files" scratch command, kept out of the command
    // palette by default since it's a development aid, not an end-user feature.
    debugMode: boolean;

}

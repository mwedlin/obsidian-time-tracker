export const defaultSettings: TimeTrackerSettings = {
    timestampFormat: "YY-MM-DD hh:mm:ss",
    csvDelimiter: ","
};

export interface TimeTrackerSettings {

    timestampFormat: string;
    csvDelimiter: string;

}

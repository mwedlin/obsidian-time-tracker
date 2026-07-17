// Shared data model. Deliberately free of any "obsidian" import so it can be
// used from pure, Node-testable logic as well as from the plugin's UI code.

export interface Entry {
    name: string;
    startTime: number;
    endTime: number;
    subEntries: Entry[];
}

export interface Tracker {
    dispType: string; // "default" | "compact" | "status" | "today"
    currTask: string;
    project: string;
    client: string;
    entries: Entry[];
}

// Pure helpers for turning a configured "favorite" project/client pair into a
// stable Obsidian command id/name - no "obsidian" import, so this is
// unit-tested directly under plain Node (see tests/favorites.test.ts).

import { toName } from "./report-logic";

export interface Favorite {
    project: string;
    client: string;
}

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

// Stable across reloads as long as the favorite's project/client text itself
// doesn't change - deliberately not based on the favorite's position in the
// settings list, since that can shift when other favorites are added/removed.
export function favoriteCommandId(favorite: Favorite): string {
    return `start-${slugify(toName(favorite.project, favorite.client))}`;
}

export function favoriteCommandName(favorite: Favorite): string {
    return `Start ${toName(favorite.project, favorite.client)}`;
}

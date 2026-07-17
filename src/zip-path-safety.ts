// Pure path validation for extracting a zip archive: no "obsidian" import,
// so this can be unit-tested directly under plain Node (see
// tests/zip-path-safety.test.ts). Kept separate from template-kit-installer.ts
// (which does the actual, Obsidian-dependent extraction) since this is the
// one piece of that feature worth testing in isolation - a zip entry's
// internal path is untrusted input, and getting this wrong is a real
// "zip slip" vulnerability (a crafted entry path escaping the intended
// extraction folder and overwriting arbitrary vault files).

// Validates and normalizes a single zip entry's internal path against being
// safe to extract underneath some target folder. Rejects anything that could
// escape that folder - a ".." segment anywhere, an absolute path, or a
// Windows drive letter - returning null for those. Otherwise returns the
// path normalized to "/"-separated segments with empty and "." segments
// dropped.
export function sanitizeRelativePath(rawPath: string): string | null {
    if (!rawPath)
        return null;
    if (rawPath.startsWith("/") || rawPath.startsWith("\\"))
        return null;
    if (/^[a-zA-Z]:/.test(rawPath))
        return null;

    const parts = rawPath.split(/[/\\]/).filter(p => p.length > 0 && p !== ".");
    if (parts.length === 0)
        return null;
    if (parts.some(p => p === ".."))
        return null;

    return parts.join("/");
}

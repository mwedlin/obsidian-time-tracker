Hi, thanks for contributing to Time Tracker!

## Auto-reloading Obsidian after a build

`npm run build` copies the freshly built plugin into `test-vault/.obsidian/plugins/time-tracker/`, but
Obsidian doesn't hot-reload a plugin's code just because the file on disk changed - it keeps running
whatever was already loaded in memory, until the plugin (or the whole app) is reloaded. If you have the
[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin installed and
running against `test-vault` (or whichever vault you're testing in), `npm run build` can trigger an
automatic reload for you:

1. Create a `.env` file at the repo root (gitignored - **never commit it**, it holds a live credential):
   ```
   OBSIDIAN_REST_API_KEY=your-local-rest-api-key
   OBSIDIAN_REST_URL=http://127.0.0.1:27123
   ```
   (`OBSIDIAN_REST_URL` is optional, defaulting to `http://127.0.0.1:27123`; the API key is under the Local
   REST API plugin's own settings tab.)
2. That's it - `npm run build` (not `npm run dev`, which watches/rebuilds continuously and would reload
   Obsidian on every keystroke otherwise) will POST Obsidian's built-in "Reload app without saving" command
   after a successful build. If the key isn't set, or Obsidian/the REST API plugin isn't reachable, this is
   silently skipped and never fails the build - it's a convenience, not a requirement.


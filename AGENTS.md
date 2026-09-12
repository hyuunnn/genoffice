# AGENTS.md

Suite-wide theming, shell-build, and i18n rules live in `CLAUDE.md`. Remaining
Hangul work is in `apps/hwp/todo.md`. Do not treat that file as “won’t do”
unless an item is under **하지 않음**.

This file is the Hangul / rhwp contract. Breaking it blanks the editor or
silently corrupts documents. Implementation lives in `apps/hwp`.

## Embed

Hangul tabs host self-vendored rhwp-studio (`@rhwp/editor` 0.8.6). GenOffice
owns chrome. Studio owns typing, tables, formatting.

- `createStudio(host, { studioUrl: new URL('rhwp/?chrome=embed', location.href).href, renderer: 'canvas2d' })`
- After create, the host **must** `loadFile` or `commands.execute('file:new-doc')`. Embed boot does not create a document.
- Open: `loadFile(bytes, name, { skipUnsavedGuard: true, suppressDialogs: true })`.
- Save: export HWP/HWPX/HML → IPC atomic write → `notifySaved`.
- Dirty: poll `getDocumentState().dirty`. That is the SDK path.

## Vendor

Patch source: `apps/hwp/scripts/studio-snapshot.mjs`. Snapshot output
`apps/hwp/vendor/rhwp-studio/` is **gitignored**. After vendor or preload
changes, restart `npm run dev`. Blank pane: `node apps/hwp/scripts/vendor-studio.mjs --ensure` then restart.

The patch is written against the **pristine** upstream bundle only. A snapshot
is pristine, current, or stale; `--ensure` never migrates a stale one in place —
it throws `StaleSnapshotError` naming `npm run vendor:studio -w @genoffice/hwp`.
A needle miss on the agent bundle (upstream drift) also fails `--ensure` and
`vendor` — a snapshot is only "ready" when every current mark is present.
After changing `studio-snapshot.mjs`, re-vendor; do not add in-place `repair*` /
`attach*` upgrade paths. Tests run against
`apps/hwp/tests/fixtures/rhwp-0.8.6-agent-excerpt.txt` (real bundle windows).

Do not `npm install -w @genoffice/hwp` alone. Hangul `src/main` and preload
compile into the **shell** build.

## Why we patch the studio

`getSelectionContext` computes SHA fences and drops them. The public SDK cannot
add those fields back. The patch injects sibling Document **class methods**; the
host calls `studio._request`, then public `applyTextCommand` / `focusTarget`.

If the minified bundle shape changes, needles must throw. Update the patch.
Do not call Hangul WASM from the host as a bypass.

**Class method lists must not have commas.** Object literals and `switch` cases
do. A comma between class methods makes the vendor bundle fail to parse — blank
Hangul page, Enter does nothing. Class members are built by the `*Method(s)()`
template functions; handlers by `prepareAgentHandlers()` (comma-joined). The
snapshot test parses the injected class body to lock it.

Body edits go through `applyTextCommand` (no `\n`, 4000 code-point cap). New
paragraphs are inserted first, then each is filled. Re-list immediately before
every apply — adjacent hashes change. List RPCs that are not arrays throw; never
swallow as `[]`. `PutFieldText` is only a fallback after a successful field list.

Studio cell/table/page calls also go through those Document methods, not host
WASM: `applyCharFormatInCell` / `applyParaFormatInCell` (`apply_format` with
`table`+`row`), `insertTableRow` / `insertTableColumn` / `deleteTableRow` /
`deleteTableColumn` / `mergeTableCells` / `splitTableCellInto` (`edit_table`),
`setCellProperties` / `setTableProperties` (`style_table`), `getPageDef` /
`setPageDef` / `getColumnDef` / `setColumnDef` (`set_page`). Cell char ranges
are UTF-16 (`string.length`), matching WASM offsets. `table: 0` is a valid
index — do not treat it as omitted. After a JS snapshot patch, run
`npm run vendor:studio -w @genoffice/hwp` and close/reopen the Hangul tab.

## Do not

- Lift the 4000-character body cap.
- Use `SetTextFile` (or any whole-document write) as a general editor.
- Re-apply page-turn / caret-below-page studio patches (`0f06f81` reverted them).
- Call header/footnote WASM from the host. Undo and layout break.
- Treat `null` / `''` / whitespace required indexes as `0`.
- Restore `aiEmptyBody` to “편집 불가”. Every locale’s empty-state line must
  describe the current edit tools, including new paragraphs, tables, row/column
  edits, cell fill, and page setup. New AI strings go in
  `apps/hwp/src/renderer/i18n/ai/zh.ts` and every sibling shard.

## Print / PDF

Use studio `file:print` / `file:print-to-pdf`. Not a new PDF engine.

- Snapshot must include sibling `print.html` (`scripts/print-surface.html` →
  `vendor/rhwp-studio/print.html`). Pages does not link it; `--ensure` copies it.
- Embed strips those commands. `keepEmbedNewDoc()` keeps `file:new-doc` plus
  print/PDF registered. Studio File menu items stay hidden.
- Host File menu → IPC → `studio.commands.execute`. Print preview `window.open`s
  same-origin `/rhwp/print.html`; Hangul `setWindowOpenHandler` must allow that
  URL and deny everything else. If the popup stays on `about:blank`, load
  `print.html` with `loadURL` — the suite `will-navigate` guard blocks the
  default popup navigation.

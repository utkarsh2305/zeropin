# Test Suite

> **373 tests** across 11 files. Run: `npm test`
> Keep this file in sync — update the table whenever a test is added, renamed, or removed.

## Table of Contents
- [Schema Migration (MIG)](#schema-migration)
- [Storage – Core (LOCAL)](#storage--core)
- [Storage – Preferences (PREFS)](#storage--preferences)
- [Storage – Recents (RECENTS)](#storage--recents)
- [Storage – Browser Import (IMPORT)](#storage--browser-import)
- [YouTube Utilities (YT)](#youtube-utilities)
- [Anchor / Text Matching (ANC)](#anchor--text-matching)
- [UI – Library Logic (LIB)](#ui--library-logic)
- [Integration (INT)](#integration)
- [Stress / Performance (STRESS)](#stress--performance)
- [Content Script – Snippet Pipeline (CS)](#content-script--snippet-pipeline)

---

## Schema Migration
*File: `src/core/storage/migrate.test.ts` — 14 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| MIG-001 | Schema Migration | Missing schemaVersion is treated as v0 and migrated to the current version. | `result.schemaVersion === SCHEMA_VERSION` | Default behaviour for legacy data with no version field |
| MIG-002 | Schema Migration | v0 state gains an empty bookmarks dict and is migrated to current. | `result.bookmarks` equals `{}`; `result.schemaVersion === SCHEMA_VERSION` | Handles states created before bookmarks were tracked |
| MIG-003 | Schema Migration | v1 state backfills `notes: ''` on every bookmark. | `result.bookmarks["b1"].notes === ""` | Notes field introduced in v2 |
| MIG-004 | Schema Migration | v2 state adds the `snippetHash` key to every bookmark. | `"snippetHash" in result.bookmarks["b1"]` is true | snippetHash introduced in v3 |
| MIG-005 | Schema Migration | v3 state backfills analytics defaults (openCount, lastOpenedAt) on bookmarks. | `openCount === 0`; `lastOpenedAt === 0`; `lastResolvedConfidence` is undefined | Analytics fields introduced in v4 |
| MIG-006 | Schema Migration | v4 state is migrated to current; folders gain a `color` field. | `"color" in result.folders["root"]` is true; bookmark name preserved | Folder color introduced in v5 |
| MIG-007 | Schema Migration | v5 state removes the inbox folder and moves its bookmarks to root. | `result.bookmarks["b1"].folderId === "root"`; `result.folders["inbox"]` is undefined; `result.inboxFolderId` is undefined | Inbox concept removed in v6 |
| MIG-008 | Schema Migration | v6 state relocates orphaned bookmarks (whose folderId no longer exists) to rootFolderId. | orphan bookmark's `folderId === "root"` | Ensures no dangling folderId references |
| MIG-009 | Schema Migration | v6 state does not relocate bookmarks whose folder still exists. | `result.bookmarks["b1"].folderId === "work"` | Guards against over-migration |
| MIG-010 | Schema Migration | A future schema version (v99) is returned as-is without downgrade. | `result.schemaVersion === 99`; extra field preserved | Forward-compatibility guard |
| MIG-011 | Schema Migration | Existing bookmark data is fully preserved through a complete migration from v0. | URL, snippet text, folderId, and root folder name are all unchanged after migration | End-to-end data-integrity check |
| MIG-012 | Schema Migration | Running migration twice on the same state produces the same result (idempotent). | `second` deep-equals `first` | Prevents repeated-migration side effects |
| MIG-013 | Schema Migration | v7 state backfills `tags: []` on every bookmark and adds `tagDefs: {}` to state. | every bookmark has `tags` equal to `[]`; `result.tagDefs` equals `{}` | Tag system introduced in v8 |
| MIG-014 | Schema Migration | v7 migration preserves an existing tags array on a bookmark (idempotent). | `result.bookmarks["b1"].tags` equals `["tag1"]` | Guards against overwriting user-assigned tags during re-migration |

---

## Storage – Core
*File: `src/core/storage/local.test.ts` — 82 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| LOCAL-001 | Storage – Hashing | computeSnippetHash returns the same hash regardless of trailing slash and URL fragment. | `h1 === h3`; `h2 === h3` | Normalises URL before hashing |
| LOCAL-002 | Storage – Hashing | computeSnippetHash returns a different hash when snippet text differs on the same URL. | `h1 !== h2` | |
| LOCAL-003 | Storage – Hashing | computeSnippetHash differs for a PAGE bookmark versus a SNIPPET on the same URL. | `hPage !== hSnippet` | |
| LOCAL-004 | Storage – Bookmark | addPageBookmark creates a new bookmark with snippetHash when no duplicate exists. | bookmarks count is 1; url matches; snippetHash is defined | |
| LOCAL-005 | Storage – Bookmark | addPageBookmark updates updatedAt rather than creating a new entry when a duplicate URL exists in the same folder. | bookmarks count is 1; id unchanged; `updatedAt >= createdAt` | Dedup by URL within folder |
| LOCAL-006 | Storage – Bookmark | addPageBookmark allows the same URL in different folders (not treated as duplicate). | bookmarks count is 2 | Cross-folder dedup is intentionally disabled |
| LOCAL-007 | Storage – Bookmark | addSelectionBookmark creates a new snippet bookmark when no duplicate exists. | bookmarks count is 1; type is "SNIPPET" | |
| LOCAL-008 | Storage – Bookmark | addSelectionBookmark updates updatedAt rather than creating a new entry when the same URL + snippet exists in the same folder. | bookmarks count is 1; id unchanged | |
| LOCAL-009 | Storage – Bookmark | addSelectionBookmark allows the same snippet in different folders. | bookmarks count is 2 | |
| LOCAL-010 | Storage – Bookmark | Old bookmarks without snippetHash are never matched as duplicates. | bookmarks count is 2 | Prevents false dedup of legacy data |
| LOCAL-011 | Storage – Bookmark | bulkDeleteBookmarks removes all specified IDs in a single operation. | only "b3" remains | |
| LOCAL-012 | Storage – Bookmark | bulkDeleteBookmarks with an empty array is a no-op. | bookmarks count is 3 | |
| LOCAL-013 | Storage – Bookmark | bulkDeleteBookmarks silently ignores IDs that do not exist. | bookmarks count is 2; "b1" is undefined | |
| LOCAL-014 | Storage – Bookmark | bulkMoveBookmarks updates folderId for all specified IDs. | b1.folderId and b2.folderId are both "folderB" | |
| LOCAL-015 | Storage – Bookmark | bulkMoveBookmarks with an empty array is a no-op. | b1.folderId remains "root" | |
| LOCAL-016 | Storage – Bookmark | bulkMoveBookmarks only modifies the specified bookmarks, leaving others unchanged. | b1 moved; b2 stays; b3 unaffected | |
| LOCAL-017 | Storage – Bookmark | addPageBookmark saves to an explicitly provided folderId. | bookmark.folderId equals "work" | |
| LOCAL-018 | Storage – Bookmark | addPageBookmark falls back to rootFolderId when folderId is omitted. | bookmark.folderId equals "root" | |
| LOCAL-019 | Storage – Bookmark | addPageBookmark deduplicates by URL within the same explicit folder. | bookmarks count is 1 | |
| LOCAL-020 | Storage – Bookmark | addPageBookmark does NOT deduplicate the same URL across different folders. | bookmarks count is 2 | |
| LOCAL-021 | Storage – Bookmark | addSelectionBookmark saves to an explicitly provided folderId with type SNIPPET. | bookmark.folderId equals "work"; type is "SNIPPET" | |
| LOCAL-022 | Storage – Bookmark | addSelectionBookmark uses anchor.text over selectedText when an anchor is provided. | `snippet.text === "anchor text"` | |
| LOCAL-023 | Storage – Bookmark | addSelectionBookmark falls back to selectedText when anchor.text is empty. | `snippet.text === "raw selected"` | |
| LOCAL-024 | Storage – Bookmark | deleteBookmark removes the bookmark from state. | bookmark is undefined; count is 0 | |
| LOCAL-025 | Storage – Bookmark | deleteBookmark throws for an unknown bookmark ID. | rejects with an error | |
| LOCAL-026 | Storage – Bookmark | moveBookmark updates bookmark.folderId. | `bookmark.folderId === "work"` | |
| LOCAL-027 | Storage – Bookmark | moveBookmark throws for an unknown bookmark ID. | rejects with an error | |
| LOCAL-028 | Storage – Bookmark | moveBookmark throws for an unknown target folder. | rejects with an error | |
| LOCAL-029 | Storage – Bookmark | renameBookmark updates the bookmark name. | `bookmark.name === "New Name"` | |
| LOCAL-030 | Storage – Bookmark | renameBookmark updates the updatedAt timestamp. | `updatedAt >= before` | |
| LOCAL-031 | Storage – Bookmark | setBookmarkNotes sets notes on a bookmark. | `bookmark.notes === "My notes"` | |
| LOCAL-032 | Storage – Bookmark | setBookmarkNotes clears notes when set to an empty string. | `bookmark.notes === ""` | |
| LOCAL-033 | Storage – Folder | renameFolder updates the folder name. | `folder.name === "My Folder B"` | |
| LOCAL-034 | Storage – Folder | renameFolder throws for an unknown folder ID. | rejects with an error | |
| LOCAL-035 | Storage – Folder | setFolderColor sets the color field on a folder. | `folder.color === "#ff0000"` | |
| LOCAL-036 | Storage – Folder | setFolderColor clears the color field when set to undefined. | `folder.color` is undefined | |
| LOCAL-037 | Storage – Folder | setLastUsedFolder persists lastUsedFolderId. | `state.lastUsedFolderId === "folderB"` | |
| LOCAL-038 | Storage – Folder | setLastUsedFolder throws for an unknown folder ID. | rejects with an error | |
| LOCAL-039 | Storage – Folder | deleteFolderIfEmpty deletes an empty folder. | `state.folders["empty"]` is undefined | |
| LOCAL-040 | Storage – Folder | deleteFolderIfEmpty throws when the folder has child folders. | rejects with /child/i | |
| LOCAL-041 | Storage – Folder | deleteFolderIfEmpty throws when the folder has bookmarks. | rejects with /bookmark/i | |
| LOCAL-042 | Storage – Folder | deleteFolderIfEmpty throws for an unknown folder ID. | rejects with an error | |
| LOCAL-043 | Storage – Folder | deleteFolderCascade deletes the folder and all descendant folders. | parent and child1 are both undefined | |
| LOCAL-044 | Storage – Folder | deleteFolderCascade deletes all bookmarks in the deleted subtree. | bkParent and bkChild are both undefined | |
| LOCAL-045 | Storage – Folder | deleteFolderCascade preserves bookmarks in folders outside the deleted subtree. | bkRoot is still defined | |
| LOCAL-046 | Storage – Folder | deleteFolderCascade throws when attempting to delete the root folder. | rejects with /root/i | |
| LOCAL-047 | Storage – Folder | deleteFolderCascade resets lastUsedFolderId to rootFolderId when the deleted folder was lastUsed. | `state.lastUsedFolderId === state.rootFolderId` | |
| LOCAL-048 | Storage – Folder | createFolder creates a folder under the given parent with the correct name. | folder is defined; name and parentId match | |
| LOCAL-049 | Storage – Folder | createFolder stores a color when one is provided. | `folder.color === "#ff0000"` | |
| LOCAL-050 | Storage – Folder | createFolder returns a unique ID per call. | id1 !== id2 | |
| LOCAL-051 | Storage – Analytics | recordBookmarkOpen increments openCount with each call. | `openCount === 2` after two calls | |
| LOCAL-052 | Storage – Analytics | recordBookmarkOpen sets a lastOpenedAt timestamp. | `lastOpenedAt >= before` | |
| LOCAL-053 | Storage – Analytics | recordBookmarkOpen is a no-op for an unknown ID. | resolves without error | |
| LOCAL-054 | Storage – Reorder | moveBookmarkWithinFolder swaps sortKeys when moving UP. | bk2 gets bk1's old sortKey and vice versa | |
| LOCAL-055 | Storage – Reorder | moveBookmarkWithinFolder is a no-op when moving UP from the first position. | sortKey unchanged | |
| LOCAL-056 | Storage – Reorder | moveBookmarkWithinFolder is a no-op for an unknown bookmark ID. | resolves without error | |
| LOCAL-057 | Storage – Bookmark | addPageBookmark falls back to rootFolderId when the provided folderId no longer exists. | `bookmark.folderId === "root"` | Stale-folder guard after folder deletion |
| LOCAL-058 | Storage – Bookmark | addPageBookmark uses the provided folderId when the folder exists. | `bookmark.folderId === "folderB"` | |
| LOCAL-059 | Storage – Bookmark | addSelectionBookmark falls back to rootFolderId when the provided folderId no longer exists. | `bookmark.folderId === "root"` | Stale-folder guard |
| LOCAL-060 | Storage – Bookmark | addSelectionBookmark uses the provided folderId when the folder exists. | `bookmark.folderId === "folderB"` | |
| LOCAL-061 | Storage – Folder | moveFolderToParent moves a folder to a new parent. | `folder.parentId === "folderB"` | |
| LOCAL-062 | Storage – Folder | moveFolderToParent prevents moving a folder into its own descendant. | rejects with /descendant/i | |
| LOCAL-063 | Storage – Folder | moveFolderToParent prevents moving the root folder. | rejects with /root/i | |
| LOCAL-064 | Storage – Folder | moveFolderToParent is a no-op when moving a folder to itself. | `parentId` unchanged | |
| LOCAL-065 | Storage – Bookmark | getDuplicateFolderName returns null when the URL is not pinned anywhere. | result is null | |
| LOCAL-066 | Storage – Bookmark | getDuplicateFolderName returns null when the URL is pinned in the same target folder. | result is null | |
| LOCAL-067 | Storage – Bookmark | getDuplicateFolderName returns the folder name when the URL is pinned in a different folder. | result equals "Folder B" | Used to warn user in the popup |
| LOCAL-068 | Storage – Tags | createTag creates a TagDef with the correct name and returns its ID. | `tagDefs[id].name === "react"`; `tagDefs[id].id === id` | |
| LOCAL-069 | Storage – Tags | createTag stores an optional color. | `tagDefs[id].color === "blue"` | |
| LOCAL-070 | Storage – Tags | createTag returns a unique ID for each call. | id1 !== id2 | |
| LOCAL-071 | Storage – Tags | createTag creates a tag without a color when color is omitted. | `tagDefs[id].color` is undefined | |
| LOCAL-072 | Storage – Tags | renameTag updates the tag name. | `tagDefs[id].name === "new-name"` | |
| LOCAL-073 | Storage – Tags | renameTag throws when the tag does not exist. | rejects with an error | |
| LOCAL-074 | Storage – Tags | deleteTag removes the TagDef from tagDefs. | `tagDefs[id]` is undefined | |
| LOCAL-075 | Storage – Tags | deleteTag removes the tagId from all bookmark.tags arrays. | neither bookmark contains the tagId after deletion | Cascades tag removal to all bookmarks |
| LOCAL-076 | Storage – Tags | deleteTag throws when the tag does not exist. | rejects with an error | |
| LOCAL-077 | Storage – Tags | setTagColor sets the color on an existing tag. | `tagDefs[id].color === "red"` | |
| LOCAL-078 | Storage – Tags | setTagColor clears the color when undefined is passed. | `tagDefs[id].color` is undefined | |
| LOCAL-079 | Storage – Tags | setTagColor throws when the tag does not exist. | rejects with an error | |
| LOCAL-080 | Storage – Tags | setBookmarkTags replaces the tags array on a bookmark. | `bookmark.tags` equals `[t1, t2]` | |
| LOCAL-081 | Storage – Tags | setBookmarkTags replaces an existing tag list with a new one. | `bookmark.tags` equals `[t2]` only | |
| LOCAL-082 | Storage – Tags | setBookmarkTags throws when the bookmark does not exist. | rejects with an error | |

---

## Storage – Preferences
*File: `src/core/storage/prefs.test.ts` — 7 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| PREFS-001 | Storage – Prefs | getPrefs returns full defaults when nothing is stored. | `highlightDurationMs === 3000`; `snippetDismissMs === 12000` | |
| PREFS-002 | Storage – Prefs | getPrefs returns stored values when they are present. | `highlightDurationMs === 5000`; `snippetDismissMs === 20000` | |
| PREFS-003 | Storage – Prefs | getPrefs falls back to the default for any missing field. | stored field is 7000; missing field defaults to 12000 | Partial stored object handled gracefully |
| PREFS-004 | Storage – Prefs | setPrefs persists a partial update and leaves other fields at their default. | `highlightDurationMs === 5000`; `snippetDismissMs === 12000` | |
| PREFS-005 | Storage – Prefs | setPrefs persists both fields when both are provided. | `highlightDurationMs === 8000`; `snippetDismissMs === 25000` | |
| PREFS-006 | Storage – Prefs | An empty setPrefs call leaves existing values unchanged. | `snippetDismissMs` remains 15000 | |
| PREFS-007 | Storage – Prefs | Subsequent partial setPrefs updates merge correctly. | first call sets one field; second call sets another; both are retained | |

---

## Storage – Recents
*File: `src/core/storage/recents.test.ts` — 17 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| RECENTS-001 | Storage – Recents | updateRecents adds a new folder ID to the front of the list. | `ids[0] === "a"`; length is 1 | |
| RECENTS-002 | Storage – Recents | updateRecents moves an existing ID to the front (deduplicates). | result equals `["a", "b", "c"]` | |
| RECENTS-003 | Storage – Recents | updateRecents caps the list at RECENTS_MAX (5) and drops the oldest entry. | length equals RECENTS_MAX; "5" is absent | |
| RECENTS-004 | Storage – Recents | updateRecents preserves newest-first ordering across multiple calls. | result equals `["z", "y", "x"]` | |
| RECENTS-005 | Storage – Recents | computeFolderLabel shows the folder name only for a top-level folder. | result equals "Inbox" | |
| RECENTS-006 | Storage – Recents | computeFolderLabel shows "Parent › Child" for a subfolder. | result equals "Work › Project" | |
| RECENTS-007 | Storage – Recents | computeFolderLabel truncates labels longer than 35 characters with an ellipsis. | `label.length <= 35`; ends with "…" | |
| RECENTS-008 | Storage – Recents | computeFolderLabel only shows one level of parent (grandparent is ignored). | result equals "Parent › Child" | |
| RECENTS-009 | Storage – Recents | computeFolderLabel returns "Unknown" for a missing folder ID. | result equals "Unknown" | |
| RECENTS-010 | Storage – Recents | getRecentFolderIds returns an empty array when the key is missing from storage. | result equals `[]` | |
| RECENTS-011 | Storage – Recents | getRecentFolderIds returns the stored array when the key exists. | result equals `["x", "y"]` | |
| RECENTS-012 | Storage – Recents | getPendingSave returns null when no pending save is stored. | result is null | |
| RECENTS-013 | Storage – Recents | getPendingSave / setPendingSave round-trips a full PendingSave object. | retrieved object deep-equals the stored object | |
| RECENTS-014 | Storage – Recents | setPendingSave(null) clears the pending save. | result is null after clearing | |
| RECENTS-015 | Storage – Recents | setPendingSave preserves all optional fields including anchor and ytResult. | `result.ytResult.kind === "youtube"`; `result.anchor.text === "snippet text"` | |
| RECENTS-016 | Storage – Recents | rebuildContextMenus filter logic removes deleted folder IDs. | result equals `["id1", "id3"]` | Pure filter function test |
| RECENTS-017 | Storage – Recents | rebuildContextMenus filter logic preserves the order of remaining IDs. | result equals `["z", "m"]` | |

---

## Storage – Browser Import
*File: `src/core/storage/importBrowser.test.ts` — 28 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| IMPORT-001 | Import – Detection | detectBrowserSource identifies Chrome from the NETSCAPE-Bookmark DOCTYPE string. | returns "chrome" | |
| IMPORT-002 | Import – Detection | detectBrowserSource identifies Firefox from a "mozilla firefox" comment in the header. | returns "firefox" | |
| IMPORT-003 | Import – Detection | detectBrowserSource identifies Edge from a "microsoft edge" comment in the header. | returns "edge" | |
| IMPORT-004 | Import – Detection | detectBrowserSource returns "unknown" for an unrecognised format. | returns "unknown" | |
| IMPORT-005 | Import – Detection | detectBrowserSource identifies Safari from "Apple" and "Safari" in the header. | returns "safari" | |
| IMPORT-006 | Import – Detection | browserSourceLabel maps "chrome" to "Chrome". | returns "Chrome" | it.each row |
| IMPORT-007 | Import – Detection | browserSourceLabel maps "firefox" to "Firefox". | returns "Firefox" | it.each row |
| IMPORT-008 | Import – Detection | browserSourceLabel maps "safari" to "Safari". | returns "Safari" | it.each row |
| IMPORT-009 | Import – Detection | browserSourceLabel maps "edge" to "Edge". | returns "Edge" | it.each row |
| IMPORT-010 | Import – Detection | browserSourceLabel maps "unknown" to "Browser". | returns "Browser" | it.each row |
| IMPORT-011 | Import – Parsing | parseBrowserHtml parses a simple two-bookmark Netscape file. | bookmarks length is 2; both URLs present; folders length is 0 | |
| IMPORT-012 | Import – Parsing | parseBrowserHtml skips non-http/https bookmarks (javascript:, ftp:). | bookmarks length is 1; only "https://valid.com" present | |
| IMPORT-013 | Import – Parsing | parseBrowserHtml extracts ADD_DATE as addDate multiplied by 1000. | `bookmarks[0].addDate === 1700000000 * 1000` | Converts Unix seconds to ms |
| IMPORT-014 | Import – Parsing | parseBrowserHtml falls back to the href when the bookmark title is empty. | `bookmarks[0].name === "https://example.com"` | |
| IMPORT-015 | Import – Parsing | parseBrowserHtml trims whitespace from bookmark titles. | `bookmarks[0].name === "Padded Title"` | |
| IMPORT-016 | Import – Parsing | parseBrowserHtml parses nested H3 folders and creates a folder hierarchy. | "Work Stuff" folder exists; bookmark's folderTempId matches the folder | |
| IMPORT-017 | Import – Parsing | parseBrowserHtml handles empty HTML gracefully. | bookmarks and folders both empty | |
| IMPORT-018 | Import – Parsing | parseBrowserHtml handles malformed HTML without throwing. | does not throw | |
| IMPORT-019 | Import – Parsing | parseBrowserHtml ignores H3 folder nodes themselves as bookmarks. | no bookmark has the folder name as its name | |
| IMPORT-020 | Import – Parsing | parseBrowserHtml assigns null folderTempId for top-level bookmarks. | `bookmarks[0].folderTempId` is null | |
| IMPORT-021 | Import – Preview | buildImportPreview returns correct newCount and dupCount. | newCount is 1; dupCount is 1; parsedBookmarkCount is 2; source is "chrome" | |
| IMPORT-022 | Import – Preview | buildImportPreview duplicate detection is case-insensitive. | dupCount is 1; newCount is 0 | |
| IMPORT-023 | Import – Commit | commitBrowserImport imports bookmarks and creates a container folder. | imported is 2; dupSkipped is 0; a "Chrome Import" folder exists; bookmarks count is 2 | |
| IMPORT-024 | Import – Commit | commitBrowserImport skips duplicates when includeDups is false. | imported is 1; dupSkipped is 1 | |
| IMPORT-025 | Import – Commit | commitBrowserImport imports duplicates when includeDups is true. | imported is 1; dupSkipped is 0 | |
| IMPORT-026 | Import – Commit | commitBrowserImport respects BOOKMARK_CAP and skips bookmarks that would exceed it. | imported is 1; capSkipped is 1 | |
| IMPORT-027 | Import – Commit | commitBrowserImport uses the correct source label in the container folder name. | a folder whose name includes "Firefox Import" exists | |
| IMPORT-028 | Import – Commit | commitBrowserImport assigns imported bookmarks to the correct subfolders when parsed folders exist. | "Work" folder exists; bookmark's folderId equals the Work folder's ID | |

---

## YouTube Utilities
*File: `src/core/youtube.test.ts` — 42 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| YT-001 | YouTube – URL | isYouTubeWatchUrl accepts a www.youtube.com/watch?v= URL. | returns true | |
| YT-002 | YouTube – URL | isYouTubeWatchUrl accepts a youtube.com/watch?v= URL without www. | returns true | |
| YT-003 | YouTube – URL | isYouTubeWatchUrl accepts a youtu.be short URL. | returns true | |
| YT-004 | YouTube – URL | isYouTubeWatchUrl accepts a watch URL with extra query parameters. | returns true | |
| YT-005 | YouTube – URL | isYouTubeWatchUrl rejects non-watch YouTube pages (shorts, channel). | returns false for both | |
| YT-006 | YouTube – URL | isYouTubeWatchUrl rejects non-YouTube URLs. | returns false for both | |
| YT-007 | YouTube – URL | isYouTubeWatchUrl rejects malformed URLs. | returns false | |
| YT-008 | YouTube – URL | isYouTubeWatchUrl rejects a /watch URL without a v= param. | returns false | |
| YT-009 | YouTube – URL | getYouTubeVideoId extracts the video ID from a watch URL. | returns "dQw4w9WgXcQ" | |
| YT-010 | YouTube – URL | getYouTubeVideoId extracts the video ID from a youtu.be URL. | returns "dQw4w9WgXcQ" | |
| YT-011 | YouTube – URL | getYouTubeVideoId extracts the video ID from a youtu.be URL that has query params. | returns "dQw4w9WgXcQ" (params stripped) | |
| YT-012 | YouTube – URL | getYouTubeVideoId returns null for a non-YouTube URL. | returns null | |
| YT-013 | YouTube – URL | getYouTubeVideoId returns null for a malformed URL. | returns null | |
| YT-014 | YouTube – URL | normalizeYouTubeCanonicalUrl strips the timestamp from a URL. | returns URL without `t=` param | |
| YT-015 | YouTube – URL | normalizeYouTubeCanonicalUrl strips playlist and other extra params. | returns URL with only `v=` param | |
| YT-016 | YouTube – URL | normalizeYouTubeCanonicalUrl normalises youtu.be to canonical form. | returns `https://www.youtube.com/watch?v=abc123` | |
| YT-017 | YouTube – URL | normalizeYouTubeCanonicalUrl normalises youtube.com (no www) to canonical form. | returns `https://www.youtube.com/watch?v=abc` | |
| YT-018 | YouTube – URL | normalizeYouTubeCanonicalUrl returns null for a non-YouTube URL. | returns null | |
| YT-019 | YouTube – URL | normalizeYouTubeCanonicalUrl is idempotent on a canonical URL. | returns the same URL | |
| YT-020 | YouTube – Time | parseYouTubeTimeToSec parses a bare seconds integer. | returns 125 | |
| YT-021 | YouTube – Time | parseYouTubeTimeToSec parses a value with an "s" suffix. | returns 125 | |
| YT-022 | YouTube – Time | parseYouTubeTimeToSec parses minutes + seconds (2m5s). | returns 125 | |
| YT-023 | YouTube – Time | parseYouTubeTimeToSec parses hours + minutes + seconds (1h02m03s). | returns 3723 | |
| YT-024 | YouTube – Time | parseYouTubeTimeToSec parses hours only. | returns 3600 | |
| YT-025 | YouTube – Time | parseYouTubeTimeToSec parses minutes only. | returns 1800 | |
| YT-026 | YouTube – Time | parseYouTubeTimeToSec parses zero (both "0" and "0s"). | returns 0 for both | |
| YT-027 | YouTube – Time | parseYouTubeTimeToSec is case-insensitive (1H30M). | returns 5400 | |
| YT-028 | YouTube – Time | parseYouTubeTimeToSec trims whitespace from the input. | returns 125 | |
| YT-029 | YouTube – Time | parseYouTubeTimeToSec returns null for an empty string. | returns null | |
| YT-030 | YouTube – Time | parseYouTubeTimeToSec returns null for a non-time string. | returns null for "abc" and "playlist" | |
| YT-031 | YouTube – Time | formatSecToLabel formats seconds as MM:SS with padding. | "516" → "08:36" | |
| YT-032 | YouTube – Time | formatSecToLabel formats seconds as H:MM:SS. | 3723 → "1:02:03" | |
| YT-033 | YouTube – Time | formatSecToLabel formats zero as "00:00". | returns "00:00" | |
| YT-034 | YouTube – Time | formatSecToLabel formats under a minute correctly. | 5 → "00:05" | |
| YT-035 | YouTube – Time | formatSecToLabel formats exactly 1 hour. | 3600 → "1:00:00" | |
| YT-036 | YouTube – Time | formatSecToLabel round-trips with parseYouTubeTimeToSec for common inputs. | 3723 → "1:02:03"; 125 → "02:05" | |
| YT-037 | YouTube – URL | buildYouTubeOpenUrl appends t= to a canonical URL. | result is `…&t=516s` | |
| YT-038 | YouTube – URL | buildYouTubeOpenUrl appends t=0s for zero seconds. | result is `…&t=0s` | |
| YT-039 | YouTube – Capture | YouTube capture logic returns a valid moment when currentTime >= 2 and readyState >= 2. | isLive is false; ready is true; t >= 2 is true; label is "08:36" | Mock video element |
| YT-040 | YouTube – Capture | YouTube capture logic falls back for a live stream (duration === Infinity). | isLive is true | |
| YT-041 | YouTube – Capture | YouTube capture logic falls back when the video has not started (currentTime < 2). | `t >= 2` is false | |
| YT-042 | YouTube – Capture | YouTube capture logic falls back when the player is not ready (readyState < 2). | `readyState >= 2` is false | |

---

## Anchor / Text Matching
*File: `src/core/anchor.test.ts` — 43 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| ANC-001 | Anchor – Normalize | normalizeText collapses multiple spaces into one. | "hello   world" → "hello world" | |
| ANC-002 | Anchor – Normalize | normalizeText trims leading and trailing whitespace. | "  hello  " → "hello" | |
| ANC-003 | Anchor – Normalize | normalizeText lowercases the input. | "Hello World" → "hello world" | |
| ANC-004 | Anchor – Normalize | normalizeText converts tabs and newlines to spaces. | "hello\n\tworld" → "hello world" | |
| ANC-005 | Anchor – Normalize | normalizeText handles an empty string without error. | returns "" | |
| ANC-006 | Anchor – Normalize | normalizeText returns an empty string for whitespace-only input. | "   \n\t  " → "" | |
| ANC-007 | Anchor – Regex | escapeRegex escapes special regex characters. | "a.b*c?d" → "a\\.b\\*c\\?d" | |
| ANC-008 | Anchor – Regex | escapeRegex escapes brackets and parentheses. | "[foo](bar)" → "\\[foo\\]\\(bar\\)" | |
| ANC-009 | Anchor – Similarity | levenshteinDistance returns 0 for identical strings. | distance is 0 | |
| ANC-010 | Anchor – Similarity | levenshteinDistance returns the correct distance for a single-character edit. | "abc" vs "abd" → 1 | |
| ANC-011 | Anchor – Similarity | levenshteinDistance returns the string length for completely different strings. | "abc" vs "xyz" → 3 | |
| ANC-012 | Anchor – Similarity | levenshteinDistance handles empty strings. | "" vs "abc" → 3; "abc" vs "" → 3 | |
| ANC-013 | Anchor – Similarity | jaroWinklerSimilarity returns 1 for identical strings. | returns 1 | |
| ANC-014 | Anchor – Similarity | jaroWinklerSimilarity returns 0 for completely different strings. | "abc" vs "xyz" → 0 | |
| ANC-015 | Anchor – Similarity | jaroWinklerSimilarity returns high similarity for near-matches. | similarity > 0.9 for one-char difference | |
| ANC-016 | Anchor – Similarity | jaroWinklerSimilarity handles empty strings (both empty → 1; one empty → 0). | edge cases handled | |
| ANC-017 | Anchor – Similarity | normalizedSimilarity returns 1 for identical strings. | returns 1 | |
| ANC-018 | Anchor – Similarity | normalizedSimilarity returns 0 when one string is empty. | returns 0 | |
| ANC-019 | Anchor – Similarity | normalizedSimilarity returns a high value for similar strings. | > 0.8 for one-char difference | |
| ANC-020 | Anchor – DOM | walkTextNodes yields all text nodes in document order. | texts equal ["Hello", "World"] | |
| ANC-021 | Anchor – DOM | walkTextNodes handles deeply nested elements. | texts equal ["A", "B", "C", "D"] | |
| ANC-022 | Anchor – DOM | walkTextNodes returns nothing for an empty body. | array is empty | |
| ANC-023 | Anchor – DOM | buildNormalizedDocText produces a normalized string from multiple text nodes. | normalized contains "hello world" and "foo bar"; segments is non-empty | |
| ANC-024 | Anchor – DOM | docTextToRange returns a valid range that maps back to the original casing. | `range.toString() === "Hello World"` | |
| ANC-025 | Anchor – DOM | docTextToRange works across multiple text nodes. | range spanning two spans returns "Hello World" | |
| ANC-026 | Anchor – DOM | docTextToRange returns null for out-of-range offsets. | returns null | |
| ANC-027 | Anchor – DOM | createRangeFromMatch creates a DOM Range from a regex match object. | `range.toString() === "World"` | |
| ANC-028 | Anchor – DOM | rangeFromOffsets creates a range from character offsets within a container. | `range.toString() === "World"` for offsets 6–11 | |
| ANC-029 | Anchor – DOM | rangeFromOffsets works across multiple text nodes. | range spanning two spans returns "Hello World" | |
| ANC-030 | Anchor – DOM | rangeFromOffsets returns null for out-of-range offsets. | returns null | |
| ANC-031 | Anchor – DOM | computeTextOffsets returns the correct start and end character offsets for a range. | startOffset is 6; endOffset is 11 | |
| ANC-032 | Anchor – DOM | getPrefix returns the text immediately before a range. | prefix equals "Hello " | |
| ANC-033 | Anchor – DOM | getSuffix returns the text immediately after a range. | suffix equals " Foo" | |
| ANC-034 | Anchor – DOM | prefixMatches returns true when the range's preceding text matches. | returns true for "Hello " | |
| ANC-035 | Anchor – DOM | prefixMatches returns false when the prefix does not match. | returns false for "Goodbye " | |
| ANC-036 | Anchor – DOM | suffixMatches returns true when the range's following text matches. | returns true for " Foo" | |
| ANC-037 | Anchor – DOM | buildCssPath produces a selector using an id shortcut when available. | selector contains "#main"; element is found by selector | |
| ANC-038 | Anchor – DOM | buildCssPath produces a selector using data-testid when available. | selector contains "data-testid"; element is found | |
| ANC-039 | Anchor – DOM | buildCssPath falls back to tagName:nth-child for ambiguous elements. | selector contains "nth-child"; element is found | |
| ANC-040 | Anchor – DOM | walkTextNodesShadow yields text nodes from the regular DOM. | texts equal ["Hello", "World"] | |
| ANC-041 | Anchor – DOM | walkTextNodesShadow also yields text nodes from open shadow roots. | texts contain "Shadow Text" and "Outside" | |
| ANC-042 | Anchor – DOM | computeOffsetsInContainer computes offsets relative to the container start. | start is 7 ("Prefix " = 7 chars); end is 18 | |
| ANC-043 | Anchor – DOM | computeOffsetsInContainer returns zero-based offsets for the first text in the container. | start is 0; end is 5 | |

---

## UI – Library Logic
*File: `src/app/pages/Library.test.tsx` — 61 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| LIB-001 | UI – Search | filterBookmarks matches by bookmark name (case-insensitive). | "react" query includes bookmark with id "1" | |
| LIB-002 | UI – Search | filterBookmarks matches by URL. | "vuejs.org" query includes bookmark with id "2" | |
| LIB-003 | UI – Search | filterBookmarks matches by domain. | "typescriptlang" query includes bookmark with id "3" | |
| LIB-004 | UI – Search | filterBookmarks matches by snippet text. | "typed superset" query returns only id "3" | |
| LIB-005 | UI – Search | filterBookmarks matches by notes field. | "React patterns" query returns only id "4" | |
| LIB-006 | UI – Search | filterBookmarks returns bookmarks from all folders when searching. | filterByFolder with isSearching=true does not reduce the result set | |
| LIB-007 | UI – Search | An empty query returns all bookmarks; folder filter applies on top. | all 4 bookmarks returned; inbox filter narrows to 2 | |
| LIB-008 | UI – Recent Pins | getRecentPins sorts bookmarks by createdAt descending. | order is ["2", "3", "1"] for createdAt [3000, 2000, 1000] | |
| LIB-009 | UI – Recent Pins | getRecentPins limits to 10 items. | length is 10; first item is the most recently created | |
| LIB-010 | UI – Recent Pins | getRecentPins shows all bookmarks when fewer than 10 exist. | length is 2 | |
| LIB-011 | UI – Recent Pins | Recent pins are hidden during search mode. | `showRecentPins` is false when `isSearching` is true | Logic-only check |
| LIB-012 | UI – Notes | truncateNote returns null for undefined. | returns null | |
| LIB-013 | UI – Notes | truncateNote returns null for an empty string. | returns null | |
| LIB-014 | UI – Notes | truncateNote returns null for a whitespace-only string. | returns null | |
| LIB-015 | UI – Notes | truncateNote passes through a short note unchanged. | "Short note" → "Short note" | |
| LIB-016 | UI – Notes | truncateNote passes through a 60-character note unchanged. | 60-char string returned as-is | Boundary test |
| LIB-017 | UI – Notes | truncateNote truncates a 61-character note to 60 chars plus an ellipsis. | 61-char string → 60 chars + "…" | |
| LIB-018 | UI – Sort | sortBookmarks "newest" sorts by descending sortKey. | order is [c, b, a] | |
| LIB-019 | UI – Sort | sortBookmarks "oldest" sorts by ascending sortKey. | order is [a, b, c] | |
| LIB-020 | UI – Sort | sortBookmarks "name_asc" sorts alphabetically. | order is [b=Apple, c=Mango, a=Zebra] | |
| LIB-021 | UI – Sort | sortBookmarks "name_desc" sorts reverse-alphabetically. | order is [a=Zebra, c=Mango, b=Apple] | |
| LIB-022 | UI – Sort | sortBookmarks "last_opened" sorts by descending lastOpenedAt. | order is [a=3000, c=1000, b=0] | |
| LIB-023 | UI – Sort | sortBookmarks "most_opened" sorts by descending openCount. | order is [c=10, a=5, b=0] | |
| LIB-024 | UI – Sort | sortBookmarks "last_opened" ties (both 0) do not throw. | no error thrown | |
| LIB-025 | UI – Sort | sortBookmarks "most_opened" ties (both 0) do not throw. | no error thrown | |
| LIB-026 | UI – Sort | sortBookmarks does not mutate the original array. | original array order is unchanged after sort | |
| LIB-027 | UI – Analytics | formatOpenCount returns null for undefined. | returns null | |
| LIB-028 | UI – Analytics | formatOpenCount returns null for zero. | returns null | |
| LIB-029 | UI – Analytics | formatOpenCount returns formatted string for 1. | "Opened 1×" | |
| LIB-030 | UI – Analytics | formatOpenCount returns formatted string for 100. | "Opened 100×" | |
| LIB-031 | UI – Bulk | toggleId adds an ID when it is absent. | set contains "b1" | |
| LIB-032 | UI – Bulk | toggleId removes an ID when it is present. | "b1" absent; "b2" still present | |
| LIB-033 | UI – Bulk | "Select all" sets all visible bookmark IDs. | set has size 3; contains b1 and b3 | |
| LIB-034 | UI – Bulk | "Deselect all" clears the selectedIds set. | cleared set has size 0 | |
| LIB-035 | UI – Bulk | Exiting bulk mode clears selectedIds and resets bulkMode flag. | bulkMode is false; selectedIds is empty | |
| LIB-036 | UI – Folders | sortFoldersForDisplay returns folders sorted by sortKey ascending. | order is [a, b, c] | |
| LIB-037 | UI – Folders | sortFoldersForDisplay returns an empty array for empty input. | returns [] | |
| LIB-038 | UI – Folders | sortFoldersForDisplay does not mutate the original object. | original key order unchanged | |
| LIB-039 | UI – Folders | sortFoldersForDisplay returns a single-element array for a single folder. | length is 1; id matches | |
| LIB-040 | UI – Keyboard | getAdjacentId returns null for an empty list (both directions). | null for delta=1 and delta=-1 | |
| LIB-041 | UI – Keyboard | getAdjacentId returns the first item when currentId is null and delta=1. | returns "a" | |
| LIB-042 | UI – Keyboard | getAdjacentId returns the last item when currentId is null and delta=-1. | returns "d" | |
| LIB-043 | UI – Keyboard | getAdjacentId moves forward by one. | "a" → "b"; "b" → "c" | |
| LIB-044 | UI – Keyboard | getAdjacentId moves backward by one. | "d" → "c"; "b" → "a" | |
| LIB-045 | UI – Keyboard | getAdjacentId clamps at the start (delta=-1 on first item stays on first). | returns "a" | |
| LIB-046 | UI – Keyboard | getAdjacentId clamps at the end (delta=1 on last item stays on last). | returns "d" | |
| LIB-047 | UI – Keyboard | getAdjacentId returns the first item for an unknown currentId. | returns "a" | |
| LIB-048 | UI – Keyboard | getAdjacentId returns the same item for a single-item list in both directions. | returns "x" for both delta=1 and delta=-1 | |
| LIB-049 | UI – Tags | filterByTag returns only bookmarks that contain the given tagId. | result contains only "b1" for tag "t1" | |
| LIB-050 | UI – Tags | filterByTag returns multiple bookmarks when they share a tag. | result contains "b1" and "b2" for tag "t2" | |
| LIB-051 | UI – Tags | filterByTag returns an empty array when no bookmark has the tag. | returns [] for "t99" | |
| LIB-052 | UI – Tags | filterByTag returns an empty array for an unknown tagId. | returns [] | |
| LIB-053 | UI – Tags | filterByTag treats a missing tags field as an empty array. | result is [] for bookmark without tags field | |
| LIB-054 | UI – Tags | getAllTagsSorted returns tags sorted alphabetically by name. | order is ["apple", "mango", "zebra"] | |
| LIB-055 | UI – Tags | getAllTagsSorted returns an empty array for empty tagDefs. | returns [] | |
| LIB-056 | UI – Tags | getAllTagsSorted returns a single-element array unchanged. | length is 1; name is "solo" | |
| LIB-057 | UI – Tags | getTagCount counts bookmarks that contain the tag. | count is 2 for "t1" | |
| LIB-058 | UI – Tags | getTagCount counts only bookmarks with that specific tag. | count is 1 for "t2" | |
| LIB-059 | UI – Tags | getTagCount returns 0 when no bookmarks have the tag. | returns 0 for "t99" | |
| LIB-060 | UI – Tags | getTagCount returns 0 for an empty bookmarks list. | returns 0 | |
| LIB-061 | UI – Tags | getTagCount correctly counts a bookmark that has multiple tags. | count is 1 for "t2" on a bookmark with t1, t2, t3 | |

---

## Integration
*File: `src/integration.test.ts` — 21 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| INT-001 | Integration | Pinning the same page twice results in only one bookmark, with updatedAt refreshed. | count is 1; id unchanged; `updatedAt >= first updatedAt` | Cross-feature: keyboard shortcut + dedup |
| INT-002 | Integration | Pinning the same selection twice results in only one bookmark. | count is 1 | |
| INT-003 | Integration | Pinning two different selections on the same URL creates two bookmarks. | count is 2 | |
| INT-004 | Integration | A new pin appears in the recent-pins list. | recentPins length is 1; URL matches | |
| INT-005 | Integration | After bulk-moving a bookmark to folder B, re-pinning the same URL creates a new bookmark. | count is 2 | Cross-feature: dedup + bulk move |
| INT-006 | Integration | After bulk-deleting a bookmark, re-pinning the same URL creates a new bookmark. | count becomes 0 after delete, then 1 after re-pin | |
| INT-007 | Integration | Search across folders followed by bulk-delete removes all matched bookmarks. | count is 0 after bulk-deleting all search results | Cross-feature: search + bulk delete |
| INT-008 | Integration | Search followed by bulk-move consolidates all matched bookmarks into a single folder. | all bookmarks have folderId "folderB" | |
| INT-009 | Integration | Bulk-deleting a bookmark removes it from the recent-pins list. | recentPins length is 1 after deleting one of two | Cross-feature: recent pins + bulk delete |
| INT-010 | Integration | Bulk-moving a bookmark preserves its createdAt, so it remains in recent pins. | recentPins length is 1; createdAt unchanged | |
| INT-011 | Integration | Recent pins are hidden during search mode. | `showRecentPins` is false when `isSearching` is true | Logic-only check |
| INT-012 | Integration | Recent pins reappear after clearing search. | `showRecentPins` is true when `isSearching` is false | |
| INT-013 | Integration | Full flow: pin page + selection → search → bulk move → recent pins all consistent. | count is 2; search finds both; all moved; recent pins ordered by createdAt | End-to-end workflow test |
| INT-014 | Integration | Saving via a recent-folder menu item updates the recents list. | `recentFolderIds[0] === "root"` | Cross-feature: context menu + recents |
| INT-015 | Integration | Recents list caps at RECENTS_MAX (5) and drops the oldest entry. | length equals RECENTS_MAX; first-added folder is absent | |
| INT-016 | Integration | Saving to the same folder multiple times keeps it at the front with no duplicates. | `ids[0] === "root"`; "root" appears exactly once | |
| INT-017 | Integration | computeFolderLabel uses parent name for subfolders in context menu. | label equals "Work › ProjectX" | |
| INT-018 | Integration | Deleting a folder removes it from the context-menu recents list. | recents contain only "root"; "temp" is absent | |
| INT-019 | Integration | Library picker mode stores a PendingSave and retrieves it correctly. | `result.url` and `result.id` match | Cross-feature: picker + pendingSave |
| INT-020 | Integration | Completing a picker page-save stores the bookmark in the chosen folder and clears the pending save. | `bookmark.folderId` equals folderId; `afterPending` is null; recents[0] equals folderId | |
| INT-021 | Integration | Completing a picker snippet-save stores a SNIPPET bookmark with the correct anchor and clears the pending save. | type is "SNIPPET"; `snippet.text` matches; `afterPending` is null | |

---

## Stress / Performance
*File: `src/stress.test.ts` — 19 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| STRESS-001 | Performance – Storage | getState with 1000 bookmarks completes in under 200 ms. | elapsed < 200 ms | Generous budget for CI |
| STRESS-002 | Performance – Storage | addPageBookmark with 500 existing bookmarks completes in under 300 ms. | elapsed < 300 ms; count is 501 | |
| STRESS-003 | Performance – Storage | addPageBookmark dedup check over 500 bookmarks completes in under 300 ms. | elapsed < 300 ms; count remains 500 | |
| STRESS-004 | Performance – Storage | bulkDeleteBookmarks of 100 items from a 500-bookmark state completes in under 300 ms. | elapsed < 300 ms; count is 400 | |
| STRESS-005 | Performance – Storage | deleteFolderCascade with a 200-bookmark subfolder completes in under 500 ms. | elapsed < 500 ms; no bookmarks left with target folderId | |
| STRESS-006 | Performance – Search | Search over 1000 bookmarks with a 3-char query completes in under 100 ms. | elapsed < 100 ms; results is non-empty | |
| STRESS-007 | Performance – Search | Search results are stable — the same query always returns the same count. | r1.length equals r2.length | |
| STRESS-008 | Performance – Search | An empty search query returns all bookmarks. | 200 bookmarks returned | |
| STRESS-009 | Performance – Anchor | normalizeText on a 50k-character string completes in under 50 ms. | elapsed < 50 ms; result is non-empty | |
| STRESS-010 | Performance – Anchor | jaroWinklerSimilarity called 500 times completes in under 200 ms. | elapsed < 200 ms | |
| STRESS-011 | Performance – Hashing | computeSnippetHash called 1000 times completes in under 100 ms. | elapsed < 100 ms | |
| STRESS-012 | Performance – Hashing | computeSnippetHash is stable — same inputs always produce the same output. | h1 equals h2 | |
| STRESS-013 | Performance – Hashing | computeSnippetHash produces different hashes for different inputs. | all three hashes are distinct | |
| STRESS-014 | Performance – Recents | computeFolderLabel called 1000 times completes in under 50 ms. | elapsed < 50 ms | |
| STRESS-015 | Performance – Recents | updateRecents called 100 times (dedup stress) completes in under 500 ms. | elapsed < 500 ms; ids length equals RECENTS_MAX | |
| STRESS-016 | Performance – Import | parseBrowserHtml on a 500-bookmark Netscape HTML file completes in under 1000 ms. | elapsed < 1000 ms; bookmarks length is 500 | |
| STRESS-017 | Performance – Import | BOOKMARK_CAP is defined and is a positive number. | `BOOKMARK_CAP > 0`; typeof is "number" | |
| STRESS-018 | Performance – Concurrent | 10 sequential addPageBookmark calls produce the correct bookmark count. | count is 10 | |
| STRESS-019 | Performance – Concurrent | createFolder called 20 times produces 20 distinct folder IDs. | set size is 20 | |

---

## Content Script – Snippet Pipeline
*File: `src/contentScript.test.ts` — 39 tests*

| ID | Area | Description | Acceptance Criteria | Remarks |
|----|------|-------------|---------------------|---------|
| CS-001 | CS – Fingerprint | buildFingerprint produces distinct head/mid/tail fragments for long text. | head equals normalized first 30 chars; tail equals normalized last 30 chars; length matches | |
| CS-002 | CS – Fingerprint | buildFingerprint handles short text by setting all fragments to the same value. | head, mid, tail all equal "short"; length is 5 | |
| CS-003 | CS – Stage A | Stage A locates unique text exactly. | found is true; stage is "A"; range.toString() equals "quick brown fox" | |
| CS-004 | CS – Stage A | Stage A is not used for duplicate text (falls through to a later stage). | found is true; stage is not "A" | |
| CS-005 | CS – Stage B | Stage B disambiguates duplicate text using only a prefix. | found is true; stage is "B" | |
| CS-006 | CS – Stage B | Stage B disambiguates duplicate text using both prefix and suffix. | found is true; stage is "B" | |
| CS-007 | CS – Stage C | Stage C finds text in a ChatGPT message scoped by messageId. | found is true; stage is "A" (unique within container); container is truthy; confidence >= 1.0 | Container-boosted confidence |
| CS-008 | CS – Stage C | Stage C finds text in a Claude message scoped by messageIndex. | found is true; stage is "A"; container is truthy | |
| CS-009 | CS – Stage C | Stage C falls through gracefully when chatContext doesn't match any element. | found is true; stage is "A" (global fallback) | |
| CS-010 | CS – Stage D | Stage D locates text via character offsets. | found is true; stage is "D"; range.toString() equals "target text" | |
| CS-011 | CS – Stage D | Stage D rejects a match when the offset content differs too much from the anchor text. | stage is not "D" | |
| CS-012 | CS – Stage E | Stage E locates text via fingerprint when exact match fails. | found is true; stage is "E" | |
| CS-013 | CS – Stage E | Stage E falls through when fingerprint fragments are not found on the page. | found is false | |
| CS-014 | CS – Stage F | Stage F finds near-match text via fuzzy (Jaro-Winkler). | found is true; stage is "F" | Case difference triggers fuzzy |
| CS-015 | CS – Stage F | Stage F fails when the text is completely different from anything on the page. | found is false | |
| CS-016 | CS – Pipeline | The full pipeline prefers exact unique match (stage A) over all other stages. | found is true; stage is "A" even when all other anchor fields are populated | |
| CS-017 | CS – Pipeline | The full pipeline falls through stages correctly for non-unique text. | found is true; stage is "B" when prefix/suffix disambiguates | |
| CS-018 | CS – Pipeline | locateSnippet handles an undefined anchor gracefully. | found is false; reason is "No anchor provided" | |
| CS-019 | CS – Pipeline | locateSnippet handles an anchor with empty text gracefully. | found is false; reason is "Anchor has no text" | |
| CS-020 | CS – Chat | simpleTurnHash produces consistent results for the same input. | hash1 equals hash2 | |
| CS-021 | CS – Chat | simpleTurnHash produces different results for different input. | hash1 does not equal hash2 | |
| CS-022 | CS – Compat | Old anchors without fingerprint, chatContext, or containerHint still work via stages A–D, F. | found is true; stage is "A" | Backward compatibility |
| CS-023 | CS – Compat | Old anchors with only prefix/suffix still work via stage B. | found is true; stage is "B" | |
| CS-024 | CS – Confidence | Stage A exact unique match returns confidence 1.0. | confidence equals 1.0 | |
| CS-025 | CS – Confidence | Stage B prefix+suffix match (score 2) returns confidence 0.95. | confidence equals 0.95 | |
| CS-026 | CS – Confidence | Stage B prefix-only match (score 1) returns confidence 0.80. | confidence equals 0.80 | |
| CS-027 | CS – Confidence | Stage F fuzzy match returns a low confidence value. | confidence < 0.85 and > 0 | |
| CS-028 | CS – Confidence | A failed search returns confidence 0. | found is false; confidence equals 0 | |
| CS-029 | CS – Container | Container-scoped search finds text inside the specified cssPath element. | found is true; stage is "A"; confidence >= 1.0; container is truthy | |
| CS-030 | CS – Container | Container-scoped search falls back to global when the cssPath is not found. | found is true; stage is "A"; confidence equals 1.0 | |
| CS-031 | CS – Container | Container-scoped search falls back to global when the text sample no longer matches. | found is true; stage is "A" | Container verification sim < 0.6 |
| CS-032 | CS – DOM Stable | waitForDomStable resolves immediately when the DOM is already stable. | resolves without error | |
| CS-033 | CS – DOM Stable | waitForDomStable resolves after maxWaitMs even if the DOM keeps changing. | elapsed < 1000 ms | |
| CS-034 | CS – Container | Chat context container search finds text with a confidence boost. | found is true; confidence >= 1.0; container is truthy | |
| CS-035 | CS – Shadow DOM | Stage G finds text inside an open shadow root via exact match. | found is true; stage is "G-exact"; confidence equals 0.90 | |
| CS-036 | CS – Shadow DOM | Without shadow roots the pipeline uses regular stages (not G). | found is true; stage is "A" | |
| CS-037 | CS – Selection | ZP_GET_SELECTION_PAYLOAD logic returns hasSelection=true when a selection exists. | hasSelection is true; selectedText equals "Hello world" | |
| CS-038 | CS – Selection | ZP_GET_SELECTION_PAYLOAD logic returns hasSelection=false when no selection exists. | hasSelection is false | |
| CS-039 | CS – Selection | ZP_GET_SELECTION_PAYLOAD logic returns hasSelection=false when the selection is collapsed. | hasSelection is false | |

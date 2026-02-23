# Claude Code Guidelines

## Test documentation

After adding, renaming, or removing any test case, update `TESTS.md` to match.

The entry format is:
- Find the `##` section for the relevant test file.
- Add, edit, or remove the corresponding table row.
- Each row has five columns: **ID** | **Area** | **Description** | **Acceptance Criteria** | **Remarks**
- IDs are zero-padded sequential numbers within each file prefix (e.g. `LOCAL-083` for the next `local.test.ts` test).
- Update the test count in the section heading (e.g. *82 tests* → *83 tests*).
- Update the total count in the document header (e.g. *373 tests* → *374 tests*).

ID prefix codes:

| Prefix | File |
|--------|------|
| `MIG` | `src/core/storage/migrate.test.ts` |
| `LOCAL` | `src/core/storage/local.test.ts` |
| `PREFS` | `src/core/storage/prefs.test.ts` |
| `RECENTS` | `src/core/storage/recents.test.ts` |
| `IMPORT` | `src/core/storage/importBrowser.test.ts` |
| `YT` | `src/core/youtube.test.ts` |
| `ANC` | `src/core/anchor.test.ts` |
| `LIB` | `src/app/pages/Library.test.tsx` |
| `INT` | `src/integration.test.ts` |
| `STRESS` | `src/stress.test.ts` |
| `CS` | `src/contentScript.test.ts` |

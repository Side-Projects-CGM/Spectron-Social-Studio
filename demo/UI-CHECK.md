# Cees ticket — local mocked UI review

## Summary

Tested the four ticket flows in order in real Chrome through Playwright at 1280px and 390px. Fixed client-name changes silently switching the selected upload, inaccessible saved designs after refresh, mock copy ignoring the customer name, and the initial login console error.

## Results and screenshots

All paths below are relative to the repository. Screenshots/downloaded test artifacts are ignored by Git.

| Ticket test | 1280px | 390px | Screenshot pattern |
| --- | --- | --- | --- |
| 1 Empty demo | PASS | PASS | `artifacts/demo-ticket/{width}-test-1.png` |
| 2 Client images/ad/background/save/edit/duplicate/export | PASS | PASS | `artifacts/demo-ticket/{width}-test-2.png` |
| 3 Cancel/confirm reset, storage inspection, refresh | PASS | PASS | `artifacts/demo-ticket/{width}-test-3.png` |
| 4 Second distinct client round and reset | PASS | PASS | `artifacts/demo-ticket/{width}-test-4.png` |

Additional screenshots: `{width}-test-2-selected-upload.png`, `{width}-test-3-confirmation.png`, `{width}-test-4-second-client.png` in the same folder. Failure screenshots ending `-FAIL.png` are retained as debugging evidence, not the final result. `report.json` records per-step console errors and failed HTTP responses.

Final ticket run: **no console errors, no HTTP 4xx/5xx responses, no horizontal overflow** at either width.

## Walkthrough / fixes

1. `demo/presenter.js` → `netlify/lib/demo-gateway.cjs`: a read-only `session` action reports authenticated/not-authenticated with HTTP 200. Actual protected actions still require authentication. A normal first visit no longer logs an expected-but-noisy 401.
2. `demo/build.cjs`: the regular brand-selector change handler clears `selectedImage`. The demo uses a free-text customer name instead, so its build removes ONLY that image reset. Regression: upload two images, select the older one, type a customer name, leave the field, assert the selected data URL remains unchanged. The regular Studio source/brand behavior is untouched.
3. `demo/local.cjs`: mock copy now extracts the customer name from the incoming briefing and includes it in the mock body. Previously it always returned identical generic copy. This is a mock fix, not a model/prompt change.
4. `demo/runtime.js`: the saved library moves outside the hidden live-output panel and remains visible when saved records exist. It can be opened after refresh without another upload/generation.
5. `demo/build.cjs`: reopening a saved ad enters the advertisement workflow before restoring its settings. This restores editing/export controls as well as the artwork.
6. `demo/neutral.css`: the placeholder no longer intercepts library clicks; the library has its own stacking context and readable help text on a white background.
7. `test-demo-ticket-browser.cjs`: ordered desktop/mobile regressions, screenshots, console/network capture, real downloads and two reset rounds. No forced clicks or direct `selectImage()` calls are used.
8. `test-demo-local.cjs`: smoke-test listener uses 8893 instead of the user's default 8891. The existing server on 8891 was not stopped or altered.
9. `test-demo-gateway.cjs`: authentication-probe regression; protected-action denial remains tested.

## Flow

`Login → fresh workspace → upload/select → customer name → mock generation → edit/save/duplicate/export → refresh/reopen → cancel reset → confirm cleanup → fresh workspace → second customer`

## Concepts and trade-offs

- Mocked AI means fixed local responses, not a paid Google request. Real browser interactions, browser storage and downloads are exercised.
- The existing PNG exporter loads html2canvas 1.4.1 from cdnjs. That ONE static script GET is allowed for the export test. All server external fetches throw; browser AI calls cannot reach Google. Font requests receive empty test responses.
- The saved library is persistent content; it must not depend on a currently generated output being visible.
- Reset deletes the OLD workspace's storage, not unrelated workspaces. The presenter authentication cookie and NEW workspace ID remain intentionally. No old customer data remains in those values.

## Tests

```powershell
node demo/build.cjs
node --test test-demo-ticket-browser.cjs
node --test test-demo-*.cjs
```

Final broader checks: **51 demo checks passed, 1 known-failing emulator TODO**; **104 existing regression checks passed**. Build, syntax and `git diff --check` passed. No separate lint/typecheck is configured.

TXT export was downloaded and inspected for edited text. PNG export was downloaded and checked for its PNG signature and 1080px width. Duplication produced three saved designs (one original plus two formats). Saving, refresh/reopen and original image preservation were checked.

Reset inspected old workspace IndexedDB databases, localStorage and sessionStorage, including explicitly seeded temporary/recovery records. Cache Storage remained empty. A different image and name were used for client round 2. Separate-session isolation and mocked provider cleanup are also covered by existing demo browser/unit suites.

## Acceptance criteria / remaining sign-off

1. ✅ Empty startup: locally verified, no preset media, customer name, toy copy or video prompt.
2. ❌ Full production feature-parity sign-off is not complete. Requested ad editing, duplication, TXT/PNG export, background flow and persistence passed. Real AI/video was intentionally not exercised, nor every clipboard/platform/browser variation.
3. ✅ Client uploads and selection: two uploads tested at both widths; older selection survives entering a client name.
4. ✅ Current-session cleanup in the local/mocked scope: cancel preserves data; confirmed reset deletes tested customer storage. Actual Google/hosted Blobs cleanup is not verified by this local run.
5. ✅ Post-reset state matches the tested initial empty state, including after refresh and a second reset round.
6. ✅ Local/mocked earlier-session isolation checked; hosted concurrent revocation remains unverified and documented in `BLOBS-DIAGNOSIS.md`.

The Netlify emulator ETag/concurrency TODO remains known-failing. Local passing tests are not evidence that production spending limits or provider deletion have been verified. Phase 2 includes stronger late-job handling and cleanup retries. Paid video remains blocked in the local runner.

## Stand-up script

- Done: reproduced and fixed selection being lost when entering a customer name, and saved-library access after refresh.
- Tested: all four ticket flows at desktop/mobile widths; no final browser errors; mocked AI only.
- Next/blocker: approval for commit/push and a separate PR preview, then zero-Google production-storage concurrency verification.

## Likely review questions

- **Did we change regular Studio behavior?** No; brand-selector/library adaptations are applied in the demo build/runtime.
- **Did reset remove all browser storage?** Only the old customer workspace's records. Other sessions, authentication and the new empty workspace remain.
- **Were exports faked?** No; the browser downloaded actual TXT and PNG files. Only AI responses were mocked.
- **Can we claim Google deletion works live?** No; provider deletion is mocked and needs separately approved integration verification.

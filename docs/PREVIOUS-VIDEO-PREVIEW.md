# Previous video: view/recover, not regenerate

## 1. Problem and fix

Cees reported that **Vorige video bekijken** looked as if it rendered again. The existing code did not create a new video: it called `resumeAIVideo()`, which reused generation-loading UI before checking status/downloading the existing operation. This fix separates viewing/recovery from new-generation presentation.

## 2. Walkthrough

- `ai-video.js`: `openPreviousAIVideo()` first tries `revealCachedAIVideo()`. A matching operation, live Blob URL, decoded frame (`readyState >= 2`), error-free media element and retained result node are required. It reuses/reattaches that same node without fetching, calling `load()`, resetting playback time, autoplaying or starting progress.
- `ai-video.js`: `showAIVideoPreview()` remembers one ready preview only after decoding. Failed media, URL release and page departure invalidate the cache. Old detached media-error callbacks cannot mark a newer preview as broken.
- `ai-video.js`: fallback `resumeAIVideo()` uses `setAIVideoLoading(true,'restore')`. UI says **Vorige video laden…**; if the old operation is pending, it explicitly says that the previous video is still being processed and no new video was started. Download/decode readiness checks still apply. Explicit **Voorbeeld opnieuw laden** still performs a fresh read/download rather than using the cache.
- `spectron-social-studio.html`: keep the existing busy/navigation lock but skip `studioProgress.start()` for restore mode. New ad/video generation timing is unchanged. Bump the video script cache version so hosted browsers receive the fix.
- `test-ai-video-recovery.cjs`: assert cached node reuse, no additional requests/loading cycles, retained playback time, wrong-operation/broken-source fallback, explicit reload and refresh behavior. Existing cancellation, uncertainty, errors and no-resubmission checks remain.
- `test-progress-loader-browser.cjs`: extend the existing mocked Chrome matrix (regular/demo × 1280/390) with real MP4 decoding, reference-canvas → cached-video reuse, repeated Previous clicks, refresh, pending/held-download restore wording and unchanged video-start counts.
- `test-veo-failure.cjs`: update the existing script cache-version assertion; `test-dutch-copy.cjs` verifies the new Dutch previous-job pending wording.
- README/progress notes: document the user-visible distinction.

No backend, upload limits, provider/model, paid-confirmation flow, session recovery format, authentication or dependencies change. Draggable images remain paused.

## 3. Flow

`Previous click → ready matching cache? → reveal same playable node immediately`

`Otherwise → text-only previous-video loading → read existing status → pending: keep checking same ID / completed: download + decode → reveal and cache`

Only **Genereer mijn video / Opnieuw genereren** can use the separately confirmed new-generation path.

## 4. Key concepts

- **In-memory cache:** one media/result node and its Blob URL stay in the current page, not persistent storage. A refresh loses this cache and safely reads the existing operation ID from the unchanged recovery metadata.
- **Operation match:** a cached video cannot be reused for another request. Current photo/reference changes do not regenerate an old video; Previous intentionally displays the previous operation, not a new composition of the new photos.
- **Read versus generate:** regular recovery uses status/download requests only. Demo routes those reads via POST `action: status/download` to its gateway; a POST to the gateway is not necessarily a paid generation. No `action: video`, upload or new start is triggered by Previous.

## 5. Why this approach

Reusing the already decoded node avoids downloads, progress restart and loss of playback position. Merely renaming the old generation loader would still look like rendering and repeat work. Cache validation plus a recovery fallback handles refresh/expired/broken previews without pretending that a previous video is always already available.

## 6. Tests and manual acceptance

```powershell
node --test test-ai-video-recovery.cjs test-progress-loader.cjs
node --test test-progress-loader-browser.cjs
node demo/build.cjs
git diff --check
```

The browser matrix uses a tiny local H.264 MP4 and mocked APIs. It asserts zero new starts during cached reuse and after refresh, zero extra status/download calls for cached reuse, unchanged node/playback position, restore wording while pending/downloading and no generation-progress overlay. Existing new-generation percentage/readiness/error scenarios still run. The download status stays visibly on the canvas while the media is hidden until decoded; the status/ready video are scrolled into view rather than left above the viewport.

Final verification: **148 regular/upload checks passed; 73 demo/browser checks passed with one existing Blobs emulator TODO**. Node syntax, demo build and diff checks passed. No new dependency/config/env changes. The standard local-runner regression needs port 8893 free; the agent's mock preview was paused for that run and restarted afterward.

Screenshots/report are ignored in `artifacts/progress-loader/`: `{regular|demo}-{1280|390}-previous-{cached|pending|loading|ready}.png`. No screenshots or generated assets enter the commit.

For hosted acceptance after separately approved publication: use an already existing completed video, click Previous repeatedly, switch back to reference previews and return to Previous, then refresh and use Previous again. Confirm there is no new generation request and no rendering percentage. Do not generate a paid video just to test this without approval.

## 7. Risks and review verdict

- Cache is intentionally page-local; refresh/browser memory eviction may require a new download of the existing video.
- Missing/expired/unavailable provider output still shows existing recovery errors, not a fabricated playable video.
- Chrome width simulations do not cover physical devices/Safari/Firefox. No hosted or paid calls were made.
- Review verdict: ready for local/PR review; hosted acceptance remains separate. No new known correctness/security findings in the inspected diff.

## 8. Stand-up script

- Done: Previous now views a ready cached video or clearly loads the same existing job, without a generation progress animation.
- Tested: repeated clicks, preserved playback, ref-canvas return, refresh, pending/download states and existing generation regressions using mocks.
- Next: review/commit, then Cees verifies the existing video on the approved hosted version; draggable-image requirements are still paused.

## 9. Likely senior-dev questions

- **Was it actually charging for another render?** The inspected old path only read/reloaded the previous job; the misleading generation UI caused the appearance. The fix additionally avoids repeated reads when a ready preview exists.
- **Can a cached preview show the wrong job?** The operation ID and live Blob source must match, the video must have a decoded frame without a media error, and the same result node is reused. Otherwise recovery reads the requested ID.
- **What happens after refresh?** Only the existing operation/ratio metadata survives. Previous checks/downloads that job with loading wording; it never resubmits it.
- **Does normal Generate still confirm and show percentages?** Yes. Restore mode is distinct; the actual generation/confirmation/loader flow is unchanged.

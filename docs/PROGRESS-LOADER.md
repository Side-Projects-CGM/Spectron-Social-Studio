# Shared progress loader

## 1. Summary

One reusable blue SVG ring gives immediate feedback during ad/video generation in regular Studio and the neutral demo, without making or retrying any AI requests.

## 2. Walkthrough

- `spectron-social-studio.html`: loads the shared JS/CSS. The actual ad Generate action starts the loader after validation and sends the existing request once. A successful response waits for the two-second animation. The original local template fallback is preserved on AI failure, behind the same timing gate and labelled **offline modus**. Only failure of both paths removes the loader and shows an alert. The demo build retains its pre-existing no-fallback policy; this ticket does not change that policy.
- `studio-progress.js`: owns the overlay, SVG progress, percentage, timing and cancellation. `start('ad')` counts to 100 in 2,000 ms; `waitForAd()` gates result rendering. `start('video')` estimates progress using `95 * (1 - exp(-elapsed / 60000))`, floored and capped at 94. `complete()` is called only after media readiness and shows 100 for 120 ms before revealing the video. `stop()` cancels timers, removes the overlay and settles pending waits. Page departure also stops the loader.
- `studio-progress.css`: blue defaults to the button colour `--ui-blue`; grey track, light overlay, bold centred percentage. Colour/size/spacing variables are scoped with the `--progress-` prefix. Mobile has a smaller ring and scrolls the result area into view immediately. No decorative spinning/zooming animation is added.
- `ai-video.js`: paid confirmation remains mandatory. The existing start/poll/download flow is unchanged at the API level. The result stays hidden beneath the loader until the MP4 download and `loadeddata`/`readyState >= 2` check succeed. Media failure or a 30-second decode timeout removes the loader, retains existing recovery actions and shows a safe error. Blob URLs are released on failed preview preparation.
- `demo/build.cjs`: copies the exact shared assets into `demo-dist`; no second loader implementation. It also copies the existing `ai-video-references.js` which the merged HTML already references, so the built demo does not request a missing script.
- `test-progress-loader.cjs`: deterministic clock tests for the two-second boundary, capped/monotonic estimates, explicit video completion, cancellation and timer cleanup; media readiness/error/timeout listener cleanup; shared asset/theme checks.
- `test-progress-loader-browser.cjs`: real Chrome, regular/demo at 1280px/390px. All generation endpoints are intercepted with mocks; even an accidental server API request is rejected. A tiny local MP4 fixture is rendered by installed ffmpeg under ignored artifacts for real browser decoding. No provider API is called.
- Existing ad/video tests: verify the original ad fallback, its loader gate, double-failure errors and media-ready mocks. The old ad test's obsolete `video` output value was corrected to the actual `ai-video` action, so its final assertion now executes instead of leaving an unresolved request.
- `README.md`: updates the advertised loading and error behaviour.

## 3. Flow

`Validate → Generate (video: confirm first) → start shared overlay → existing API request → ad: wait for 2s / video: wait for playable MP4 → reveal result → stop overlay`

`Ad AI failure → original local fallback → same 2s gate → offline-labelled ad; no extra API request`

`Video failure / both ad paths fail → stop overlay → clear error/recovery message; no automatic API retry`

## 4. Concepts

- Estimated progress describes elapsed waiting, not Google-reported completion. It never reaches 100 on its own.
- A readiness gate holds the output until both conditions are met: the ad's display deadline and available AI/fallback copy, or successful video download and a decoded frame.
- CSS variables allow design changes without touching generation logic.

Main variables: `--progress-blue`, `--progress-track`, `--progress-overlay`, `--progress-text`, `--progress-size`, `--progress-stroke`, `--progress-font-size`, `--progress-font-weight`, `--progress-label-size`, `--progress-padding`, `--progress-gap`, `--progress-min-height`, `--progress-label-width`.

## 5. Decisions and trade-offs

- Follows the approved blue-ring description, not the unavailable original reference video. SVG is dependency-free and the same markup is used for both workflows.
- Ad timing targets exactly 2,000 ms using a monotonic clock and a scheduled final tick. Browser scheduling/background throttling can delay an actual rendered frame; an API that takes longer still waits at 100 with **Even geduld…**. There is no promise that Google finishes in two seconds.
- Video uses a conservative fixed time scale, not a measured historical average. Actual readiness always overrides the estimate.
- HTTP/API/model configuration, paid confirmation, polling cadence, usage tracking and session backend are not modified.

## 6. Tests and screenshots

```powershell
node --check studio-progress.js
node --check ai-video.js
node demo/build.cjs
node --test test-progress-loader.cjs
node --test test-progress-loader-browser.cjs
node --test test-demo-*.cjs
```

The browser suite uses an already installed Playwright package (`PLAYWRIGHT_MODULE` can override the machine-local fallback) and installed ffmpeg/Chrome. No new dependencies were installed. No lint/typecheck script is configured in this plain-JS project.

Screenshots and `report.json`: `artifacts/progress-loader/` (ignored; never commit). Names use `{regular|demo}-{1280|390}-{ad-progress|ad-waiting|ad-fallback|ad-error|video-progress|video-downloading|video-ready|video-error}.png`.

Browser scenarios include: immediate fast ad; delayed ad holding at 100; repeated-click guard; offline fallback waiting for the animation without another API call; double-failure error; demo's existing error path; cancel video confirmation with no loader/request; estimate at 90 then still below 95; provider-complete with download held; actual playable MP4; failed generation; invalid media. Final reports include measured ad latency and console/network errors.

## 7. Risks and follow-ups

- Real paid generation was deliberately not tested. No deployment, commit or push without approval.
- Chrome desktop/mobile-width simulations are not physical-device/Safari/Firefox tests.
- The previously documented Netlify Blobs emulator TODO is unrelated and remains known-failing in the demo suite. This task does not establish production spending-limit/cleanup guarantees.
- The existing generic video HTTP error translation is unchanged; fixing its access-denied/unknown-start messages is a separate task.
- Cached workflow results, exports, saving and orientation retain their existing implementations; regression suites cover them.

## 8. Stand-up script

- Done: one shared, themeable progress ring for ad/video in regular Studio and demo.
- Tested: mocked desktop/mobile success, delay, cancellation, media readiness and errors; no paid calls.
- Next: GU reviews screenshots and approves a commit; GU will push and merge.

## 9. Review questions

- **Is the percentage real?** Ad percentage is a two-second presentation timer; video percentage is explicitly an estimate. Neither claims provider-reported progress.
- **What if the API is slow?** Ads wait at 100 with a message; videos remain below 95 until a frame is decoded.
- **Does this create extra charges?** No; the component has no network requests and never retries generation. Existing confirmation remains.
- **Did the loader change ad fallback?** No. Regular Studio still uses its original local templates on AI failure, labelled offline, after the same animation. An error is shown only if both paths fail. Demo's existing no-fallback policy is unchanged.
- **Why are the demo assets shared?** Changes should apply to both deployments without maintaining two loader implementations.

# Three image boxes for video creation

## 1. Summary

Video has three fixed thumbnail slots and shows all available reference photos enlarged on the canvas. This document records the original UI ticket and its 4 MiB validation. The later **10 MiB transport follow-up** is documented in [VIDEO-REFERENCE-UPLOADS.md](VIDEO-REFERENCE-UPLOADS.md); its current validation replaces the original cap below.

## 2. Walkthrough

- `spectron-social-studio.html:1581–1588`: reference controls keep one hidden single-file picker. The two upload buttons are rendered inside their own slots, instead of one generic multi-file add button.
- `spectron-social-studio.html:1614`: a video-only image group shares the existing preview container. The ad image stays separate.
- `spectron-social-studio.html:2297`: main-image/workflow changes synchronize the references and canvas. Existing result caching still decides when to show a generated result instead of the source-photo preview.
- `ai-video-references.js:58`: render exactly three stable slots. Slot 1 follows the main image; slots 2/3 are keyboard-accessible upload/replace buttons. Removing an extra photo leaves that numbered slot empty.
- `ai-video-references.js:159`: validate file type, decoded readability and combined original byte size before replacing a slot. A failed upload keeps the previous photos. A version check ignores an upload that finishes after the main product changes.
- `ai-video-references.js:20`: build the canvas image group from the same reference state. Upload/removal reveals it instead of a prior video result/error.
- `ai-video-references.js:127`: return populated slots in slot order to the existing video flow. Original bytes, paid confirmation, API fields and loader behaviour are unchanged.
- `studio-design.css:710`: three thumbnail columns at both tested widths; large canvas images are side by side on desktop and stacked below 901px. `object-fit: contain` preserves the whole image without stretching/cropping.
- `test-video-references-browser.cjs`: reusable mocked browser scenarios; `test-video-image-boxes-browser.cjs` builds/serves a dedicated local test site and runs regular/demo.
- `test-inline-handlers.cjs`: the existing DOM test double now supports CSS `setProperty`, used for the canvas column count.
- `README.md`: usage, scope and test instructions.

## 3. Flow

`Select main image → Video → slot 1 + two upload slots → choose slot 2/3 → read/validate → thumbnail + large canvas preview → confirm video → existing request with populated original images`

## 4. Key concepts

- **Stable slots:** clearing photo 2 does not turn photo 3 into photo 2. Only the outgoing API array omits empty slots.
- **Version check:** changing the main product invalidates an older in-progress upload, preventing unrelated product photos from being mixed.
- **Display versus data:** fitting an image into its preview changes CSS only, not the submitted image bytes.

## 5. Decisions and trade-offs

- Show all available photos together for GU/Cees to judge locally. Desktop uses equal-width columns; mobile stacks large previews for readability while keeping the three small slots in one row.
- The selected main image cannot be removed from slot 1. Change it using the existing main image/gallery controls; this clears extras as before.
- Extras stay separate from ad images/libraries and remain in browser memory, not new persistent storage.
- Reuse the existing three-image/4 MiB safeguards and video API. No dependency, backend, model, prompt, authentication or billing changes.

## 6. Tests and manual review

```powershell
node --test test-video-image-boxes-browser.cjs
node --test test-video-references.cjs test-inline-handlers.cjs test-workflow-navigation.cjs
node --test --test-concurrency=1 test-demo-*.cjs test-progress-loader-browser.cjs test-video-image-boxes-browser.cjs
node demo/build.cjs
git diff --check
```

The feature checks regular/demo at 1280px and 390px: initial slots, slot 3 before slot 2, keyboard upload, replacement/removal, readable original proportions, invalid/empty/spoofed files, individual and combined size caps, cached ad isolation, cancellation, locked controls, exact outgoing image bytes/order, stale decoding and demo reset. All generation endpoints are mocked; no paid API is called.

Final regression run: 122 regular checks passed; 67 demo/browser checks passed with the existing Blobs-emulator TODO. No configured lint/typecheck script exists. Chrome console/page errors and failed HTTP responses were empty in the feature scenarios. Screenshots/report are ignored under `artifacts/video-image-boxes/`.

For local review, open the already running mock preview at `http://127.0.0.1:8891/demo/` (regular: `/`), refresh, upload a main photo, select Video and use both + buttons. Click a thumbnail to replace it. This temporary preview is not a production deployment.

## 7. Risks and follow-ups

- GU/Cees still need to approve the all-images canvas layout.
- Chrome width simulations are not physical-device/Safari/Firefox testing.
- Real paid generation and hosted behaviour were not tested; approval is required for paid calls/deployment.
- The pre-existing Blobs emulator TODO is unrelated and not fixed here.
- The later 10 MiB follow-up adds chunked temporary uploads; see the transport document for its separate implementation and hosting checks.

## 8. Stand-up script

- Done: three fixed video image boxes and automatically updated large previews; ad/video request behaviour remains unchanged.
- Next: GU/Cees review the local desktop/mobile layout before committing.
- Blockers/follow-up: 10 MiB is separate; no paid or hosted visual acceptance yet.

## 9. Likely review questions

- **Why not add a new upload endpoint?** This is a UI ticket; the existing reference payload already accepts up to three photos.
- **Are the photos cropped for video?** No. CSS fits previews, while requests retain original files.
- **What happens on an invalid replacement?** The old photo remains; an accessible error explains the failed upload.
- **Does selecting another product retain its old extra photos?** No. It resets both extra slots, and stale async uploads are ignored.
- **Why not 10 MiB now?** Base64/request-size limits need a separate design; merely increasing the constant could break hosted submissions.

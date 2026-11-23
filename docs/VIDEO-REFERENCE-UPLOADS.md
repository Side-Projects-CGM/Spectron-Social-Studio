# 10 MiB video reference uploads

## 1. Summary

Up to three original images can total **10 MiB (10,485,760 bytes)**, including the selected main photo. Small selections keep the existing inline request; larger selections are uploaded temporarily in chunks so Netlify never receives a single oversized generation request. Model, prompt, eight-second output, orientation, confirmation and media-ready loader behaviour stay unchanged.

## 2. Walkthrough: where, what and why

1. `ai-video-references.js` and `spectron-social-studio.html`: the three existing slots now validate/display 10 MiB combined. No extra slot, image recompression or canvas-position feature is added.
2. `ai-video.js`: after the existing paid confirmation, validate original files again. At most 4 MiB uses the old `images` payload. Above that, `uploadAIVideoReferences()` hashes originals and sends metadata, then sequential **1 MiB binary chunks encoded in JSON**. Each request is below 2 MiB. Upload capabilities stay only in local function memory, not URLs, browser storage or logs.
3. `netlify/functions/video-reference-upload.cjs`: regular site's same-origin JSON endpoint for `create`, `chunk` and `delete`. It never calls Google.
4. `demo/runtime.js` maps that endpoint to `action: references` through the existing demo API. `netlify/lib/demo-gateway.cjs` checks the existing origin/session/workspace before uploads, blocks them when demo video is disabled, rechecks workspace revocation afterwards and cleans temporary images on reset. Upload actions do not reserve generation quota.
5. `demo/functions/demo-api.cjs` supplies the private upload service. No new login mechanism, environment variable or dependency is required.
6. `netlify/lib/video-reference-uploads.cjs`: use the existing `@netlify/blobs` SDK with strong consistency and private store `studio-video-reference-uploads`. Validate declared count/type/size/checksum; save immutable bounded chunks; verify assembled SHA-256 and the existing signature/base64 rules. A random capability is required; demo batches also bind to the authenticated presenter and workspace. Namespace separates deployed environments.
7. `netlify/functions/start-veo-test.cjs` (reused by `start-veo-video.cjs`): accept either the legacy inline request or a small `upload` reference. Reassemble and validate before Google, claim a batch once, then use the existing provider payload. Cleanup runs in `finally`, including unknown provider outcomes. Proven upload rejection is marked `invalid-upload`; the UI does not falsely call this an uncertain paid start. Demo still counts its reserved attempt without refund, but does not retain an unknown-video lock for this pre-provider failure.
8. `netlify/lib/video-references.cjs`: shared 10 MiB decoded-byte limit and existing MIME/signature validation. Large clients must use chunks because Netlify's ingress limit still applies to legacy inline callers.
9. `netlify/functions/cleanup-video-references.mjs` and `demo/functions/cleanup-video-references.mjs`: hourly scheduled expiry cleanup for each site's private store. These scheduled functions are not public HTTP endpoints. Root/demo TOML and dependency versions are unchanged.
10. `demo/local.cjs`: extend the existing in-memory store with listing and bind upload cleanup to it. Its ordinary local runner still disables video, including new upload actions.
11. Tests: new service/generation/HTTP browser tests; existing integration, cache-version, configuration and reference UI tests updated for the new transport/limit. Documentation: README, demo README and a historical note on the original UI ticket.

## 3. Flow

`Three selected photos → confirm → validate ≤10 MiB → ≤4 MiB: existing inline start`

`Otherwise: create private batch → send 1 MiB chunks → small start request → verify ownership/completeness/hash/type/size → single-use claim → existing Google request → delete originals → existing poll/download/playable-video flow`

`Upload failure → cleanup → stop loader → explicit no-new-video error; never automatically retry generation`

## 4. Key concepts

- **Chunks:** 10 MiB becomes about 13.3 MiB as base64; chunking keeps each inbound JSON request small while preserving every original byte.
- **Capability:** an unpredictable, batch-scoped token authorizes a temporary upload. Only its hash is stored. This is not the Google API key and grants no general storage access.
- **Checksum:** SHA-256 proves the assembled original bytes match what the browser declared. File-signature checks remain lightweight validation, not a full malware scanner/server image decoder.
- **Immutable claim / tombstone:** a conditional create-only marker permits one start per uploaded batch. Cleanup removes images and metadata but keeps an empty marker to stop a delayed competitor from claiming the same batch again. It is swept after expiry plus a five-minute grace for in-flight requests.

## 5. Decisions, limits and retention

- Raising only the numeric limit would fail on Netlify's **6 MB buffered request limit**. Merely using multipart/binary would not make a 10 MiB request fit. Browser recompression was rejected because it changes originals. Outbound provider requests are reconstructed server-side; this is not an inbound streaming-response workaround.
- Keep inline mode through 4 MiB to avoid storage operations for existing small requests. Reference count is still three, not a claimed vendor maximum.
- A batch becomes unusable after **one hour**. Normal start completion/failure, client cleanup and demo reset attempt to delete originals immediately. Storage errors/closed tabs/lost responses can defer physical deletion.
- Published Netlify deploys run hourly cleanup (bounded to 5,000 expired objects per invocation); new upload creation also cleans up to 100 expired objects. Expiry rejects access even before physical deletion.
- Deploy Previews/branch deploys **do not run cron automatically**. Before production includes this job, abandoned preview data without further traffic may remain physically stored after becoming inaccessible. Use Netlify's scheduled-function **Run now** after approval or the next upload's bounded sweep; do not claim a guaranteed one-hour deletion SLA.
- The private store holds original chunks only temporarily; Google interaction storage/retention is unchanged. No filenames, prompts, capability tokens or originals enter usage logs/session recovery. Empty markers and short-lived hashed rate buckets contain no image bytes.
- Upload creation is limited to 60 batches/site/environment/hour and 10/client/hour (presenter for demo, Netlify client-IP header for regular, shared fallback if unavailable). Reservation uses create-only slots. Failed attempts are not refunded; existing inline requests are unaffected. Rate buckets expire within two hours of their UTC hour start.
- Existing Blobs dependency is reused; no new env settings/auth schema are introduced. After deployment, uploads and cleanup consume Netlify storage/function resources. No cloud storage, deployment or paid generation was exercised by the agent.

References checked: [Netlify limits](https://docs.netlify.com/build/functions/optional-configuration/), [Blobs consistency/expiry](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [scheduled functions and preview limitations](https://docs.netlify.com/build/functions/scheduled-functions/), [existing Interactions API](https://ai.google.dev/api/interactions-api).

## 6. How to test

```powershell
node --test test-video-reference-uploads.cjs test-video-upload-generation.cjs
node --test test-video-10mib-browser.cjs
node --test --test-concurrency=1 test-demo-*.cjs test-progress-loader-browser.cjs test-video-image-boxes-browser.cjs test-video-10mib-browser.cjs
node demo/build.cjs
git diff --check
```

- Service tests: exact 10 MiB and cap+1; bad metadata/count/type; bounded/immutable/idempotent chunks; missing/corrupt/spoofed data; wrong capability/presenter/workspace; one-hour expiry; bounded cleanup; client/site limits; reset/write races; delayed competing claim after cleanup; marker grace and deletion.
- Generation tests: exact original hashes reach a mocked Google call once; tiny start body; partial/expired/cross-owner/replayed batches cannot start; demo auth/origin/disable checks, reset/create race and quota/operation ownership remain enforced.
- Real Chrome HTTP tests at regular/demo × 1280/390: exactly 10 MiB of readable PNG originals, ten chunk requests, all requests below 2 MiB with a server-enforced 6,000,000-byte ingress cap; unchanged hashes; cancellation; injected chunk and final-resolution failures; no extra provider starts, loader/control cleanup. Google and Blobs are mocked server-side. The expected 503/404 responses are intentional failure tests, not unexpected browser errors.
- Existing three-slot/browser tests also reject >10 MiB individual/combined uploads and retain previous images. Existing loader, scroll, ad, recovery, provider-wrapper and demo checks remain part of regression verification.
- Screenshots/report: ignored `artifacts/video-10mib/`; no images/test output are committed.

Final checks: **144 regular/upload checks passed; 73 demo/browser checks passed with one existing Blobs emulator TODO**. Demo build, Node syntax and diff checks passed. Dependency audit reported zero vulnerabilities; Gitleaks scan of tracked/untracked changes found no leaks. No lint/typecheck script is configured in this plain-JS project.

For manual **mock-only** review:

```powershell
node test-video-10mib-browser.cjs --serve
```

Open `http://127.0.0.1:8893/demo/` (regular `/`). The standalone loopback harness auto-provisions a local mock presenter session, uses in-memory storage and a fake provider key/start, and never reads `.env` or accesses real cloud storage. Upload images totaling 4–10 MiB and confirm to exercise chunks. Stop with Ctrl+C. This does not alter deployed authentication. The mock deliberately stops after accepting a video start (to release test locks); it validates uploads, not a real generated clip.

## 7. Risks / deployment acceptance still required

- No hosted deployment or real paid generation was performed. Mock payload tests cannot prove Google's visual output or real large-image acceptance.
- The known Netlify Blobs emulator conditional-write/ETag TODO remains. Before enabling paid starts on a hosted preview, verify real store create-only claims, rate slots, cross-workspace denial and cleanup with a mocked provider. Do not treat the in-memory store as distributed-concurrency proof.
- Publish matching browser assets, gateway, start wrapper and cleanup functions together. Verify both sites have the cleanup function available; preview schedules need manual triggering until published.
- Test cold-start chunk latency and store permissions on the approved hosted preview. Storage failure must block large starts before Google, not silently fall back to an oversized JSON request.
- Physical-device/Safari/Firefox and slow-network memory/latency testing remain; Chrome width simulation is not full cross-browser acceptance.
- A one-use claim prevents replay of the same upload, not a user confirming an entirely new paid batch. Existing explicit retry warnings remain for genuinely unknown provider outcomes.

## 8. Stand-up script

- Done: raised the combined original-photo limit to 10 MiB using private bounded chunks, preserving the three-slot UI and video behaviour.
- Tested: local exact-boundary, ownership, failure, cleanup and concurrency cases plus mocked desktop/mobile HTTP flows; no paid calls.
- Next/blockers: review/commit, then separately approve hosted storage/provider-mock acceptance before any paid visual test or production release.

## 9. Likely senior-dev questions

- **Why not just set 10 in the constants?** The resulting ~13.3 MiB JSON would exceed Netlify ingress; server reassembly avoids that.
- **What stops cross-customer reads?** There is no download/list API for uploads. A random capability is required for mutations/consumption, and demo uploads additionally use trusted owner/workspace context after existing session checks.
- **What if a request retries or cleanup races a second start?** Chunks are immutable/idempotent; a create-only claim plus retained empty marker stops a reused batch from starting twice. Provider generation is never automatically retried.
- **What happens after reset/expiry?** Reset revokes the workspace and removes its temporary originals; late writes recheck and remove themselves. Expiry denies access, with bounded/periodic physical cleanup as documented above.
- **Does this guarantee Google accepts every 10 MiB selection?** No. App/transport bounds and original bytes are locally verified; provider-specific real-image acceptance and visual results still need an approved paid check.

## 10. Draft PR description

**Title:** ✨ Support 10 MiB original video references with bounded uploads

**Summary:** Raise the combined three-image cap to 10 MiB. Keep small requests inline; chunk larger originals into private, scoped, expiring uploads and submit only a small batch reference. Preserve the existing model/prompt, confirmation, loader, original bytes and ad workflow. Add cleanup, reset handling, rate limits and replay-race protection.

**Tests:** 144 regular/upload and 73 demo/browser checks passed; one existing emulator TODO. Real Chrome at regular/demo × 1280/390 with exact 10 MiB, request-size enforcement, original checksums and injected pre-provider failures. Build/syntax/diff/secrets/dependency checks passed. No paid or hosted calls.

**Release notes:** Adds private Blobs storage usage and hourly cleanup functions to both sites, with no new dependencies/env values. Hosted mocked-provider storage/conditional-claim/cleanup acceptance is still required before paid testing or production release. Preview schedules do not run automatically.

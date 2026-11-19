# Blobs conditional-write diagnosis

## Conclusion

Inspected installed `@netlify/blobs` **11.1.3**, the SDK, its disk-backed emulator, and Netlify's official documentation. No production credentials or paid AI calls were used.

There are TWO emulator problems, plus one application-side fail-open flaw which is now fixed:

1. **GET omits ETag.** `node_modules/@netlify/blobs/dist/server.cjs`, `BlobsServer.get()` reads the data and returns it without an `etag` response header. Consequently, SDK `getWithMetadata()` returns `etag: undefined`.
2. **Conditional PUT is not atomic locally.** `BlobsServer.put()` reads/checks existence and ETag, then awaits the request body, directory creation, file write and rename. There is no lock around the complete check/write operation. Parallel requests may pass the same condition.
3. **Application flaw fixed:** `onlyIfMatch: undefined` was accepted by our mutation helper and the SDK omitted the condition header, producing an unconditional write. The helper now rejects an existing record without an ETag with HTTP 503, before writing or authorizing new generation. `test-demo-state.cjs` proves no write occurs.

The initial eight-of-eight quota failure is explained by (1) and (3). The separate local race in (2) is visible in the emulator source; it must not be treated as production behavior without verification.

## What was verified

`test-demo-blobs.cjs` uses the actual SDK and emulator, with external networking blocked:
- A sequential `onlyIfNew` collision correctly returns `modified: false`.
- A sequential `onlyIfMatch` using the ETag returned by PUT succeeds once and rejects the old ETag afterward.
- A following GET omits the ETag: the test fails at the explicit ETag assertion.
- The original quota/concurrency assertions remain below that assertion and have NOT been removed or weakened.
- This test has an explicit Node `todo` reason describing the emulator limitation. It still runs and displays the failed assertion; the TODO prevents it from blocking unrelated Phase 1 work, as requested.

Mocked application concurrency tests continue to assert exactly one winner when one allowance remains. The localhost-only runner uses a synchronous, single-process in-memory compare-and-swap adapter so the browser can be tested without pretending the emulator is safe. It is not a distributed production solution.

## Production contract and remaining uncertainty

Official documentation explicitly calls `onlyIfMatch` and `onlyIfNew` **atomic, conditional writes** and documents ETag-bearing reads:
https://docs.netlify.com/build/data-and-storage/netlify-blobs/

The SDK sends `If-Match` / `If-None-Match` and interprets HTTP 412 as `modified:false`.

Production behavior has NOT been tested. Strong reads remain enabled; missing ETags fail closed. Do not claim that deployed daily spending caps or concurrent reset isolation are proven until the next verification passes.

A process-local lock in a Netlify function would not protect requests handled by another instance. A distributed lock using the same unverified conditional writes would not independently solve this. Neither was added as false assurance.

## PR-preview verification plan — zero Google calls

After approval to commit/push and deploy to a SEPARATE preview site:
1. Use a dedicated probe store, not regular Studio or customer workspaces.
2. Run a preview-only, presenter-authenticated test harness with provider handlers replaced by fixed mocks. No Google/API-key use is required. Do not expose an unauthenticated quota-writing diagnostic endpoint.
3. Prove GET returns an ETag and sequential stale-ETag writes return `modified:false`.
4. Seed one text allowance remaining in the isolated probe namespace.
5. Send at least 20 concurrent requests across separate function invocations/workspaces. Assert EXACTLY ONE successful reservation, a final count equal to the cap, and no write past the cap. Repeat for first-write (`onlyIfNew`) collisions and video locks.
6. Race reset against a pending mocked start; ensure old status/download access is denied and another session remains unchanged.
7. Record actual successes/conflicts/failures. Remove only the test-owned probe records, with approval. Never clear a whole shared store.
8. If production fails, keep paid access disabled and use a genuinely atomic store/lock service (dependency/service changes need approval). Do not use a short timeout lock that can expire during an active generation.

This verification harness is planned, not yet implemented/deployed. Failed provider cleanup retry, unknown outcomes and additional late-job hardening remain Phase 2. They must be disclosed during Phase 1 review.

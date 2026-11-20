# Resettable Social Studio demo — Phase 1

## Local browser testing (safe default: mocked AI)

Use PowerShell. Existing dependencies are already installed; no install is needed.

```powershell
cd "C:\Users\User\Downloads\spectron-social-studio"
git branch --show-current
# Expected: feat/demo-reset. Do not switch branches with uncommitted work.
$secure = Read-Host "Choose a local presenter password (at least 12 characters)" -AsSecureString
$env:DEMO_PRESENTER_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
node demo/local.cjs
```

Open **http://127.0.0.1:8891** (use this exact address, not localhost).
Enter the password you chose; it is not printed or saved to source files.
The runner builds the shared Studio automatically and binds to loopback only.

1. Log in. Check that the customer name, image gallery and video prompt are empty.
2. Upload a JPG/PNG/WebP using **Foto uploaden**.
3. Choose **Advertentie maken**, optionally enter customer details, then **Genereer advertentie**.
4. Mock mode returns clearly labelled example copy, not a Google response.
5. Choose **AI-achtergrond**, enter a description, then **Genereren**. Mock mode returns a tiny synthetic image to exercise acceptance/storage/reset, not a realistic background edit.
6. Save an ad with **Opslaan**, refresh, and check the saved count.
7. Click **Reset demo** → **Annuleren**: data should remain.
8. Click **Reset demo** → **Reset demo**: wait for the empty workspace and success message.
9. Use a separate browser profile/incognito session for a second workspace; resetting the first must not clear the second.
10. **Do not generate paid video.** The local runner rejects every video-start request server-side, even if the button is clicked.

Stop with Ctrl+C **after resetting**. Browser libraries persist until reset. The local session registry and quotas are in memory: stopping/restarting this local runner resets its counters and invalidates login. This is a local test harness, NOT evidence that production storage concurrency works. It is never included in the published static bundle or imported by the deployed gateway.

## Optional real text and image generation (costs money)

No paid calls are made by the agent. To manually enable text/image only, stop the mock runner, then run:

```powershell
node --env-file=.env demo/local.cjs --live-text-images
```

This reads the existing ignored `.env` on the server; it must contain `GEMINI_API_KEY`. Do not paste keys into source, URLs, chat or command arguments. The presenter password set above remains in the PowerShell process. No `.env` editing or copying is needed if the key is already configured.

Each text/image click can incur Google charges. This command **still disables video server-side**. Daily limits remain 50 text and 30 image attempts within this local process, with no refund after a reserved attempt; restarting the local runner resets its counters. Do not use this runner as a public service.

## Desktop scrolling

Above 900px, only the embedded Studio document scrolls below the presenter toolbar. The iframe fits the available height instead of enforcing its old 600px minimum, so no second outer scrollbar is needed. The left controls and results share that single document scrollbar; dialogs keep their existing viewport. Mobile sizing, presenter logic and regular Studio are unchanged.

Regression check: `node --test test-demo-scroll-browser.cjs`. It checks 1280×650, 1280×900, 1440×900 and 390×844, including mouse-wheel scrolling over the left controls, reachable footer/results, result expansion/collapse, desktop/mobile switching and reset. Screenshots/report are under ignored `artifacts/demo-scroll/`.

## Automated checks (all AI mocked)

```powershell
node demo/build.cjs
node --test --test-concurrency=1 test-demo-*.cjs
npm run test:usage
```

Run the demo suite sequentially because existing tests share `demo-dist` build output. Browser tests reuse the installed Playwright package in the Food for Skin folder on GU's machine. On another machine, point the existing `PLAYWRIGHT_MODULE` setting at an installed Playwright package; do not install dependencies without approval.

One test is explicitly **TODO / known-failing**: the Netlify Blobs 11.1.3 local emulator does not return ETags on GET and does not lock its conditional PUT check/write sequence. See `BLOBS-DIAGNOSIS.md`. A zero exit code with a TODO is not full acceptance or production sign-off.

## Separate-site preview setup (not deployed)

Use a **separate Netlify site** connected to the same repository and branch `feat/demo-reset`. In **Project configuration → Developer settings → Continuous deployment → Build settings**, set:

| Netlify UI setting | Value |
| --- | --- |
| Base directory | `demo` |
| Package directory | Leave blank |
| Build command | `npm --prefix .. ci && node build.cjs` |
| Publish directory | `../demo-dist` |
| Functions directory | `functions` |

Netlify discovers **`demo/netlify.toml`** from this base directory, before the root configuration. Paths in that file are relative to `demo/`: output stays in the repository's ignored `demo-dist/` and only `demo/functions` is deployed. The build reinstalls the existing root lockfile's dependencies into root `node_modules`, where shared backend modules resolve `@netlify/blobs`. It does not add or upgrade dependencies.

The regular site keeps its root base directory and unchanged root `netlify.toml`. A regular-site Deploy Preview is **not** a demo preview. Merely naming a file `netlify.demo.toml` does not activate it; that older root file remains for explicit CLI configuration only.

Test the exact UI build command locally from PowerShell (no deployment or AI calls):

```powershell
Push-Location demo
npm --prefix .. ci
if ($LASTEXITCODE -eq 0) { node build.cjs }
Pop-Location
node --test test-demo-config.cjs
```

The configuration test uses the already installed Netlify CLI's resolver offline and checks demo discovery without a `--config` override, root-config isolation, generated assets and backend dependency resolution. It does not access Netlify account settings or secrets. With the separate site configured, enable Deploy Previews there for PR reviews; do not deploy to the regular site.

Required server-side settings, configured only after approval:
- `DEMO_PRESENTER_PASSWORD`: at least 12 characters.
- `DEMO_COOKIE_SECRET`: at least 32 random characters.
- `DEMO_ORIGIN`: exact HTTPS preview origin; otherwise use Netlify's `DEPLOY_PRIME_URL`.
- `GEMINI_API_KEY`: text/image key; video supports the existing key alias.
- `DEMO_DISABLE_VIDEO=true`: enforce no video starts during the initial review.

Only `demo/functions/demo-api.cjs` is deployed. Legacy/test generation endpoints are not published. Static assets come only from `demo-dist`; preset brand media is excluded. Never publish the repository root. Netlify site linking, environment configuration, commit/push and preview deployment require approval. Never use `--prod`.

Before any real generation on a preview, verify the distributed quota/session conditional writes with mocked provider handlers as described in `BLOBS-DIAGNOSIS.md`.

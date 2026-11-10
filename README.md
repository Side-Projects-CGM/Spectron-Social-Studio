# Spectron Social Studio

An ad text generator for Spectron, powered by Google Gemini AI. Choose a brand, platform, and tone to create Dutch advertising text and previews. You can edit the text, adjust images, and download the results.

## Run it locally

These steps use Windows PowerShell.

### 1. Install Node.js and Netlify CLI

Install the **LTS version of Node.js** from [nodejs.org](https://nodejs.org/). It includes npm. Reopen PowerShell after installing it.

Check the installation, then install Netlify CLI (only needed once):

```powershell
node --version
npm --version
npm install -g netlify-cli
netlify --version
```

### 2. Open the project folder

```powershell
cd "C:\Users\User\Downloads\spectron-social-studio"
```

Change the path if you saved the project somewhere else.

### 3. Add your Gemini API key

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

Copy the example settings if `.env` does not already exist, then open it:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Replace the placeholder with your actual key, then save and close Notepad:

```dotenv
GEMINI_API_KEY=your_actual_google_gemini_key
```

**GEMINI_API_KEY is the only required environment variable.** Keep your key private. The `.gitignore` excludes `.env`; do not put the key in the HTML or commit it to Git.

### 4. Start the app

```powershell
netlify dev --offline --port 8888
```

This runs the page and its Netlify function using your local `.env`. The `--offline` flag skips linking to a Netlify project; Gemini still needs an internet connection.

Leave PowerShell running and open **http://localhost:8888** in your browser. Use this address instead of double-clicking the HTML file.

Choose your options and click **Genereer advertentie**. If the result says **offline modus**, the built-in fallback was used instead of Gemini. Check your API key and internet connection.

Press **Ctrl+C** to stop. Restart the command after changing `.env`.

See Netlify's [local development guide](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/) for more details.

## Save, duplicate, and copy

Each generated ad now has **Opslaan** (Save) and **Dupliceren** (Duplicate).
Duplicate lets you select two to four channels and saves the entire batch:
Facebook 1080×1080, Instagram Post 1080×1350, Instagram Story and TikTok 1080×1920.
Text, image, and image adjustments are preserved. Saved previews appear below the editor;
choose **Openen en bewerken** to edit one and **Opslaan** to update it.
Saved ads use IndexedDB in the current browser and site address. Clearing site data removes them.

**Kopieer tekst** copies the edited text; **Kopieer afbeelding** copies the rendered PNG.
Image clipboard access requires a supporting browser on HTTPS or localhost and clipboard permission.
The existing download buttons remain available.

Local verification:

1. Generate an ad and edit its headline, body, and image positioning.
2. Save, refresh, and reopen it; check that the content and adjustments survived.
3. Duplicate into two, three, then four formats; inspect each preview and reopen it.
4. Download the images and check their pixel dimensions; inspect vertical text margins and confirm no logo overlay or AI badge is added.
5. Copy text into a text editor and copy an image into an app that accepts pasted images.
6. Edit a saved ad and save again; its existing library entry should update.

Run `node test-studio-library.cjs` for isolated logic checks with simulated browser storage
and clipboard. Actual browser persistence, rendering, and clipboard pasting still need the checks above.

## Deploy to Netlify

### Set the production API key

In your Netlify project's **Environment variables** settings, add:

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio API key |

Make it available to **Functions** in the **Production** context (or all scopes and contexts). Your local `.env` does not configure the live site. Deploy again after changing the production key.

The included `netlify.toml` already sets:

- Publish directory: `.` (the project folder)
- Functions directory: `netlify/functions`
- No build command is needed.

### Option A: Deploy through Git

If your repository is connected to Netlify with automatic deployments enabled, commit your changes and push to the configured production branch:

```powershell
git status
git add README.md spectron-social-studio.html netlify/functions/generate.js netlify.toml .env.example .gitignore
git commit -m "Update Spectron Social Studio"
git push
```

Review `git status` first and add only the files you want to publish. Never add `.env`. Netlify deploys after the push; check its **Deploys** page for progress.

If you downloaded this project as a ZIP, use the manual option below, or first create a Git repository and connect it to Netlify.

### Option B: Deploy manually

From the project folder, sign in and link to your Netlify project (only needed once):

```powershell
netlify login
netlify link
```

If you do not have a Netlify project yet, create one in the Netlify dashboard, then link it. Add the production API key as described above.

Deploy the page and function:

```powershell
netlify deploy --prod
```

This updates the live site. Open the production URL printed in the terminal and test generation. See the [Netlify deploy command reference](https://cli.netlify.com/commands/deploy/) for details.

## AI Background

Select a gallery image or upload a PNG, JPEG, or WebP (up to 3 MB), then click
**AI Background**. Describe the background and click **Generate**. Review the
preview, choose **Afbeelding gebruiken**, **Opnieuw genereren**, or **Terug naar origineel**.
Regeneration always starts from the original image. Gemini is instructed to preserve
the subject, but review fine details before accepting. Accepted images use the existing
ad preview, save, duplicate, and download flows.

No additional dependencies or environment variables are required. The new Netlify
function reuses server-side `GEMINI_API_KEY` and the existing Gemini REST integration,
using `gemini-2.5-flash-image`. The Google project must have access and quota for this
image model (billing may be required). Run through Netlify Dev as described above.

Run `node test-ai-background.cjs` for mocked API and editor lifecycle checks, alongside
`node test-studio-library.cjs`. No lint or TypeScript configuration is present.

### Accepted AI images in Brand Images

**Afbeelding gebruiken** saves the generated image to the selected brand's image
library and selects it immediately. Saved AI thumbnails have a small **AI** badge
and remain available after refresh in this browser and site address. Images accepted
without a selected brand remain available across brands, like standalone uploads.
Repeated acceptance does not create duplicate images. Restoring the original does
not save an unaccepted preview or delete an image that was already accepted.

AI image records include a unique ID, source, background prompt, creation timestamp,
and original image reference. They use a new store in the existing IndexedDB
saved-ad database; the upgrade preserves saved ads. Clearing browser site data
removes saved ads and AI images. Existing ordinary uploads remain session-only.
If storage is unavailable or full, an error appears and the preview remains for retry.
Close older Spectron tabs if a database upgrade is blocked.

Run `node test-brand-images.cjs` for persistence, gallery selection, duplicate
prevention, and advertisement rendering checks, in addition to the two existing tests.


## AI usage dashboard

Open `/usage` directly (there is no link in the app navigation) to view Gemini text/image token usage and Veo video activity. The dashboard API requires the `USAGE_DASHBOARD_PASSWORD` environment variable and HTTP Basic credentials (`usage` as the username). The page provides a password form; credentials remain only in page memory and are cleared on lock/reload. Use HTTPS in production. The static page contains no usage data or credentials.

### Netlify setup

1. Install the locked dependency with `npm ci` (Node 22.12+; `netlify.toml` selects Node 22 for builds).
2. Set `USAGE_DASHBOARD_PASSWORD` in the Netlify site's environment variables, with Functions scope, before a separately authorized deployment. The local `.env` is ignored and is not a substitute for configuring production. Do not put the password in `netlify.toml`, source files or the browser bundle.
3. Netlify Functions provision/access the site-wide `spectron-ai-usage` Blobs store using runtime credentials. No browser storage credentials or extra database are required. The legacy Lambda handlers initialize the SDK from `event.blobs`.
4. After deployment, verify password protection and Blobs connectivity by opening `/usage`. An authenticated empty dashboard verifies the read path without a paid generation. The implementation was tested against the real SDK's local disk-backed server; production account access remains to be verified.

Run `netlify dev --offline --port 8888` to use local functions and local Blobs. Opening the HTML directly as a file cannot read server-side usage. Production data uses the `production/` prefix; local data uses `local/`; previews use a separate prefix per deploy. Production records survive deployments. Do not delete the site/store if historical usage must be retained.

### Meaning of the totals

- Gemini: outbound requests, successful/failed/unknown responses, and provider-reported input/output/total tokens. Thinking and cache counts are shown separately but never added again to the reported total. Missing metadata is unknown, not zero. Image generation uses the same `usageMetadata` parser, including modality breakdowns when present.
- Veo: starts, accepted operations, completed/failed/pending/unknown generations, returned videos, requested seconds and estimated output seconds. Credits and billed costs are not supplied by the video responses and are not invented. Historical Veo operations and new Gemini Omni interactions share the existing video totals. Estimated output seconds equal requested duration times the returned video count for completed operations.
- Status checks, downloads and model-access diagnostics are recorded as calls, not generations. The operation name joins start and status records, so repeated polls/downloads do not increase completed-generation counts. Production AI Video and the Veo test page have separate feature labels.
- A batch of four ad variants is one API generation request. Local fallback copy and browser-rendered video are not API generations. A Gemini error followed by local fallback remains a recorded failed/unknown Gemini attempt.
- Dates use Africa/Johannesburg; weeks start Monday. A generation is assigned to its request date, even if its final Veo status arrives later. All-time means since the first retained record; external apps and earlier usage cannot be reconstructed.

### Persistence and failure behaviour

Each API call gets a UUID and two immutable JSON entries (request and result), stored under a date prefix. Conditional create-only writes make storage retries idempotent and prevent a late request write overwriting its result. Every list page is read before totals are returned. No shared mutable counter is used.

Storage writes are awaited, have a 700 ms deadline and one retry per phase, and never retry a Google API call. If storage fails, generation continues and a sanitized server warning is logged. A missing result is shown as incomplete; if both writes fail, that call cannot appear in the dashboard. A process crash between the request record and the actual outbound call may leave an uncertain attempt. This is operational reporting, not a guaranteed billing ledger.

Blobs uses eventual consistency; records may take up to a minute to appear. Dashboard reads have a 20-second deadline and fail visibly rather than presenting partial totals as complete. Full-history aggregation suits a modest-volume studio; if volume exceeds that budget, add cached daily summaries before scaling usage.

No background Veo polling was added. If the browser closes, a job stays pending until a later status/download request observes completion. API timeouts with no operation ID remain unknown, since the provider may have accepted the request.

Only allowlisted metadata is stored: timestamps, feature/model, counts, status and operation IDs. Prompts, generated text, images, videos, signed media URLs and API keys are excluded. The dashboard response also excludes operation IDs.

### Verification

`npm run test:usage` covers response preservation, token parsing, 30 concurrent requests, storage retries/timeouts, network errors, Veo deduplication, time zones, pagination, password enforcement and the actual Netlify Blobs SDK with a local disk-backed store. All Google calls in that integration test are mocked. Existing `test-*.cjs` scripts cover the studio's other behaviour. No paid API call is needed to run the tests.

## AI Video: Gemini Omni migration

Video generation now uses `gemini-omni-1.1-flash`, replacing the retired
`veo-3.1-fast-generate-preview`. The existing `*-veo-*` function URLs are retained
for compatibility, including the test page. Historical Veo operation status and
download requests are still supported.

The server uses the Gemini Interactions REST API (revision `2026-05-20`):

1. `start-veo-video` makes one `POST /v1beta/interactions` with `background: true`,
   the selected image and prompt, and a video response format (8 seconds, 720p,
   selected aspect ratio). It returns HTTP 202 with `interactions/<id>` without
   waiting for generation or retrying the paid request.
2. The browser polls `veo-video-status` every 10 seconds, up to seven minutes.
   The function reads `GET /v1beta/interactions/<id>` and returns only pending,
   failed, or completed state—not prompts, credentials, media URLs or video data.
3. `download-veo-video` retrieves the completed MP4 separately. REST video output
   is read from `steps[].content[]`, not the SDK-only `output_video` field.
   Google currently returns inline base64 on interaction GET, even when URI
   delivery was requested. Both inline and Google Files URI downloads are handled.
   The two download functions use Netlify's v2 Request/Response API and return
   a raw MP4 ReadableStream at the existing URLs. Media is bounded and validated
   before response headers are sent; outgoing chunks avoid the base64 response
   envelope and Netlify's 6 MB buffered-response limit. Downloads are capped at
   18 MiB, below the 20 MB streaming limit. Google Files downloads stop reading
   when that cap is exceeded, even if Content-Length is missing or incorrect.
   Inline base64 output is checked before decoding. Upstream media is still
   buffered in memory for validation; this is not permanent video storage.
   The existing video/unknown MP4 file-type validation and request recovery remain.

Omni 1.1 Flash supports 3–10 second outputs, so eight seconds does not require a
model upgrade. The model ID stays `gemini-omni-1.1-flash`; image upload and
image-to-video behaviour are unchanged. At the documented 720p output rate,
eight seconds costs approximately $0.81 before input/other token charges.
A future switch to `gemini-omni-1.2-flash` requires updating the model ID and
running regression checks plus a separately approved paid visual test. Google
currently documents automatic routing of the 1.1 ID to 1.2 on December 3, 2026.
See [model limits](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash)
and [Netlify streaming](https://docs.netlify.com/build/functions/api/#streaming-responses).

Video functions read `GOOGLE_DEVELOPER_API_KEY`, falling back to the existing
`GEMINI_API_KEY`, exclusively from server environment variables. Set these in
Netlify's Functions environment; never put them in HTML or client JavaScript.
Quota errors return HTTP 429 and **Google usage limit reached**. Provider error
bodies are not exposed or logged by the new video path. Confirmation is still
required before every paid start; polling and downloading never start another job.

Background execution requires Google-side interaction storage (`store: true`).
Google's retention rules apply to uploaded media, prompts and generated output;
this is separate from Spectron's metadata-only usage store. See the current
[Omni guide](https://ai.google.dev/gemini-api/docs/omni),
[background execution guide](https://ai.google.dev/gemini-api/docs/background-execution),
[Interactions reference](https://ai.google.dev/api/interactions-api), and
[retention documentation](https://ai.google.dev/gemini-api/docs/interactions-overview#data-storage).

### Safe local regression tests

```powershell
node test-inline-handlers.cjs
node test-workflow-navigation.cjs
node test-veo-poc.cjs
node test-ai-video-orientation.cjs
npm run test:usage
node test-netlify-video.cjs
```

`test-netlify-video.cjs` starts and stops `netlify dev --offline --port 8899`,
checks the served HTML and every script URL, and exercises start/status/download,
quota, permission, filtering and pending responses. Keep port 8899 free. On
Windows it uses the global Netlify CLI installed under `%APPDATA%/npm`; other
platforms use `netlify` from PATH. Its test-only `mock-video-network.cjs` preload
blocks external requests except explicit Google mocks, and it supplies a dummy
key. It never generates paid video. Do not use that preload for normal app use.

The local workflow functions are normal global declarations in
`spectron-social-studio.html`, not module exports. The inline-handler test loads
all app scripts and verifies every inline `onclick` function resolves, then
exercises both workflow buttons. If the live site reports a missing
`showStudioWorkflow`, compare its deploy commit and HTML with the checkout,
redeploy the intended commit, and hard-refresh. This checkout is not linked to a
Netlify site, so a live URL/deploy SHA is needed to verify the deployed version.

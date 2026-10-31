# OpenGaze

**Free, open-source, webcam-only eye-gaze communication.** Look at a tile and it speaks for you.
OpenGaze rebuilds the core experience of a dedicated eye-gaze communication device (eye tracking, calibration,
dwell selection, word prediction, speech output) as a web app that runs on any laptop webcam, and adds
Claude-powered whole-sentence replies that listen to the conversation partner.

Primary user: someone who can move their eyes but can't use a keyboard, mouse or voice (ALS, cerebral palsy, spinal
cord injury, stroke). After a carer opens the page and runs setup, every interaction works by gaze alone.

Licence: **Apache-2.0** ([LICENSE](LICENSE)). Third-party licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 1. Target and what it costs

| Item | Price | Source |
| --- | --- | --- |
| Tobii Dynavox I-16 **with eye gaze** (also the I-13 Eyegaze) | **CAD $20,083** per device | Ontario Ministry of Health, Assistive Devices Program, Communication Aids manual for clinics, approved purchase prices (p. 6, effective 3 Feb 2025) [1] |
| Same I-16 **without** eye gaze | CAD $11,305 | same table [1] |
| → the eye-gaze capability alone | **≈ CAD $8,778** per device | difference of the two rows above |
| Tobii Dynavox TD Pilot (iPad + eye gaze) | est. **$10,500** (MonTech); CAD $14,500 on the Ontario list | Montana Assistive Technology Program [2]; [1] |
| TD Snap (AAC software) | "A monthly subscription is required to enable speech following a 1-month trial period." | App Store listing [8] |

Getting one of these funded runs through clinical assessment and authorised clinics (the Ontario prices above
come from the manual for ADP-registered communication-aids clinics), and then waiting for approval.
OpenGaze needs none of this to try: open a web page.

We name these vendors **only for price comparison**. OpenGaze contains no vendor code, assets, firmware, logos or
trademarks. It is a clean-room implementation.

## 2. Reach

- "Some **50 million** people in the world cannot communicate without assistive communication solutions". About
  2 million people a year are diagnosed with a need for communication aids, and only about **2%** of them get help
  (Tobii Dynavox / Dynavox Group company page [3]).
- "More than **97 million** people worldwide … cannot rely on speech alone to be heard and understood" (RERC on AAC,
  *Future of AAC* report [4]).
- OpenGaze runs on hardware people already own: any laptop or desktop with a webcam and Chrome. No install, no
  account, and offline-capable. The face model and WASM runtime are bundled.

## 3. What we uncovered: how commercial eye-gaze AAC works, and how we replaced each part

How a dedicated device works, in our own words:

1. **Eye tracking.** Infrared LEDs light the eye. A near-IR camera finds the pupil centre and the corneal
   reflection ("glint") of the LEDs (pupil-centre / corneal-reflection, PCCR). The pupil–glint vector moves with gaze
   but is fairly insensitive to small head movements.
2. **Per-user calibration.** The user looks at a series of points, and a mapping from eye features to screen
   coordinates is fitted.
3. **Selection.** Dwell (look and hold), blink or a switch, with visual feedback and large targets.
4. **Language.** Grid vocabularies, quick phrases, keyboard with word prediction, synthesised speech.
5. **Platform lock-in.** Even Windows' built-in Eye Control works only with supported eye-tracking hardware (Tobii
   devices, EyeTech TM5 Mini) [9].

| Commercial part | OpenGaze replacement |
| --- | --- |
| IR illuminator + IR camera + PCCR | Ordinary webcam + MediaPipe Face Landmarker (478 landmarks incl. iris, 52 blendshapes, head transform), running on the GPU **in the browser** |
| Pupil–glint vector | Iris centre in **eye-local coordinates** (relative to the eye corners, in eye widths), eyelid aperture, `eyeLook*` blendshapes, head yaw/pitch/roll/translation. Both eyes averaged, weighted by openness |
| Calibration | 9- or 13-point calibration (600 ms settle, 25 frames/point, MAD outlier rejection) → **second-order polynomial ridge regression**. λ is chosen by leave-one-point-out cross-validation on held-out frames |
| Accuracy report | **5-point validation** on points not used for fitting: mean and 95th-percentile error in px and visual degrees, grade, per-point heatmap |
| Tracker firmware filtering | **Fixation filter**: the cursor sits at the robust (median) centre of the current fixation with a soft dead zone, and only jumps after several consistent samples elsewhere. Dwell only counts while the eyes are actually fixating. **One Euro filter** for mouse / head pointer |
| Big targets / clinician setup | **Adaptive targets**: measured p95 error sets the minimum tile size and grid density. **Magnetic snapping** with hysteresis |
| Re-calibration visits | **Implicit drift correction**: each selection nudges a bounded, decaying bias toward the selected tile's centre |
| Head-box limits | **Head-movement guard**: leaves the calibrated pose range → calm "move back" prompt, no mis-clicks |
| Dwell / blink / switch | Dwell with progress ring + cooldown + **look-away lock**; **long deliberate blink** (400–700 ms, ignores natural blinks); **head pointer**; 2 s **Pause corner** (Midas-touch protection) |
| Word prediction + phrase pages | Local bigram/unigram prediction that learns from the session; quick phrases; **Claude** whole-sentence replies to what the partner said, and "finish my sentence" |

## 4. Before / after cost, like for like, per user per month

| | Dedicated eye-gaze device | OpenGaze |
| --- | --- | --- |
| Hardware | CAD $20,083 (I-16 with eye gaze). Over an assumed 5-year life that is **≈ CAD $335 / month** | **$0**: the user's existing laptop and webcam |
| Eye-gaze capability | ≈ CAD $8,778 extra per device (≈ CAD $146 / month over 5 years) | **$0** |
| Software | Included with the device; app-based AAC such as TD Snap needs a monthly subscription for speech [8] | **$0** (Apache-2.0) |
| Hosting | n/a | **$0**: runs locally (`npm run dev`); nothing is hosted |
| AI replies | n/a | Claude Haiku 5.5 at $0.10 / $0.50 per million input/output tokens [10]. Each reply request is ~0.5k input + ~0.1k output tokens ≈ **$0.0001**, so 200 requests a day ≈ **$0.60 / month** (estimate; the Measure screen shows the measured cost per request and per session from real token counts) |
| Offline mode | n/a | **$0**: local phrase bank + word prediction, no key needed |

The 5-year amortisation is our assumption, used only to make monthly figures comparable. Prices for API tokens live
in [`config/pricing.ts`](config/pricing.ts) with a source link.

## 5. How we know it works

- **Calibration error, measured, not claimed.** After calibration, a separate 5-point validation reports mean and
  95th-percentile error in px and degrees (viewing distance editable, default 60 cm). For reference, IR trackers
  are typically around 0.5°. Webcam methods realistically land at about 1.5–4°, which is why OpenGaze sizes targets
  from *your* measured p95 error instead of assuming a precision it doesn't have. The Measure screen also shows a
  *live* error estimate: the distance between gaze and target centre at each selection.
- **Unit tests** (`npm test`, 18 tests): ridge regression recovers a synthetic 9-point calibration and generalises
  to unseen validation points, the One Euro filter reduces fixation jitter, saccades snap, snapping hysteresis,
  bounded drift correction, long-blink vs natural-blink discrimination, and degree conversions.
- **Words per minute vs the published baseline.** Gaze typing is "usually below 10 words per minute" and a field
  participant averaged "8.1 ± 0.26 WPM" [6]. The Measure screen's **Benchmark** copies 5 standard phrases (MacKenzie &
  Soukoreff phrase set) with the keyboard only and then with AI suggestions. It reports WPM ((chars/5)/min) for each
  next to the 8–10 WPM baseline, and exports JSON.
- **Why LLM help matters:** Google's SpeakFaster study with eye-gaze users with ALS "demonstrated text-entry rates
  29–60% above baselines" and reduced keystrokes by 14–46 percentage points [6]. OpenGaze applies the same idea, so
  one selection can speak a whole contextual sentence.
- **Our measured numbers** (fill from `Measure → Export results`):

  | Metric | Result |
  | --- | --- |
  | Validation mean / p95 error | _to be filled from the demo machine_ |
  | Benchmark WPM, keyboard only / with AI | _…_ |
  | Measured API cost per reply request | _…_ |

## 6. How to run it

Requirements: Node 20+ and Chrome (or Edge).

```bash
npm install                 # also copies the MediaPipe WASM runtime into public/wasm
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for Claude replies
npm run dev                 # Vite on http://localhost:5173 + reply proxy on :8787
```

### Eye control for any website (Chrome extension)

OpenGaze also ships as a Chrome extension that brings gaze control to **every website** (Gmail, YouTube,
WhatsApp Web, news sites) with no changes to those sites.

```bash
npm run build:extension        # → dist-extension/ (+ opengaze-extension.zip)
# optional, for Claude replies inside the extension's own app page:
#   VITE_API_BASE=https://<your-app>.vercel.app npm run build:extension
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist-extension/`.
2. The OpenGaze app opens in a tab. Click **Turn on camera** and allow it (the extension needs this one-time
   permission). Then click the toolbar icon, choose **Start**.
3. **Head pointer (default, recommended):** look at the middle of the screen and hold still for a second while it
   centres. Then turn or tilt your head gently to move the pointer, and hold still on a link to click it. It measures
   the nose tip relative to the eyes, so leaning or shifting in the chair doesn't move the pointer. No calibration,
   heavy smoothing plus a soft dead zone, so a still head gives a perfectly still pointer. The popup sets how much
   head movement is needed (small / medium / large) and re-centres. There is also a Re-centre tile in the dock.
   **Eyes mode** (popup → Eyes) uses the calibrated eye-gaze model instead. Calibrate in the OpenGaze tab first.
4. **Grid mode** (on by default with Eyes; popup → Grid Auto/On/Off): the page is split into a few big blocks
   sized from your measured accuracy, each labelled with how many things it holds. The pointer jumps from block to
   block. Dwell on a block: if it holds one link it's clicked, otherwise its links appear as big numbered buttons
   (with **More** pages). This two-step "pick a region, then pick the item" method makes webcam eye gaze usable even
   with ±100 px error.
5. **Camera on pages:** a small live camera view with the centring oval sits at the top of the dock. It grows,
   with a plain instruction, when your face is lost or out of position. Thumbnails go only to the focused tab's
   overlay, which uses a closed shadow root so the website can't read them; switch off in the popup.
6. On any page:
   - **Look at a link, button or field** and hold. A ring fills around it, then it's clicked.
   - **Several small links close together?** OpenGaze asks with big numbered buttons instead of guessing (numbered
     badges show which is which).
   - **Text boxes** open a gaze keyboard with word prediction. Enter submits searches.
   - **Dock on the right:** look-to-scroll up/down (no click needed), Back, Keyboard, and **Pause** (look for 2 s;
     only Resume works while paused). A tiny face-position guide at the top turns green when you're centred.
   - The same protections as the app apply: face-lost freeze, head-movement guard, look-away lock after each
     selection, nothing fires when a new panel opens under your gaze, and drift correction learns from every click.

How it works: a hidden *offscreen* extension page runs the webcam and MediaPipe once for the whole browser. It sends
only numbers (gaze features, never images) to the content script in the focused tab, which maps them through your
calibration to that page. `extension/dev/test.html` is a dev harness that feeds synthetic gaze to the content script
(open it on the dev server after `npm run build:extension`).

### Deploy to Vercel

The repo is Vercel-ready: the Vite app is served statically, and `api/suggest`, `api/complete` and `api/health` run as
serverless functions that reuse `server/suggest.ts`. Import the GitHub repo in Vercel, add `ANTHROPIC_API_KEY` as an
environment variable (optional, since without it the offline phrase bank is used), and deploy. HTTPS, which the camera
requires, is automatic. The Hobby plan is free for non-commercial use, so hosting stays $0.

Open http://localhost:5173 (or your Vercel URL), turn on the camera, choose a selection method, calibrate, and talk.
Keys: **D** toggles the debug overlay (face mesh, iris points, raw vs smoothed gaze, FPS, error). **Esc** returns to
setup.

Other scripts: `npm test`, `npm run build`, `npm run license-check` (fails on any non-permissive licence),
`npm run notices` (regenerates THIRD_PARTY_NOTICES.md), `npm run secret-scan` (also runs as a pre-commit hook. Enable it
with `git config core.hooksPath .githooks`).

### Privacy

- Camera frames are processed **in the browser** and are never stored or uploaded.
- The conversation transcript lives in memory only and is gone when the tab closes.
- Settings (including the optional name / "about me") are saved in this browser's localStorage.
- When Claude replies are enabled, the partner's last utterance, recent turns and "about me" go to the local proxy and
  then to the Anthropic API. With no key (or "Claude suggestions: Off"), nothing leaves the machine except speech
  recognition.
- **Speech recognition** uses Chrome's built-in recogniser, which may send audio to Google's servers. The mic is off by
  default and is toggled by gaze or by the carer. A carer can type what was said instead.
- The API key is read only by the local proxy from `.env` (gitignored). The browser never sees it.

### Limitations

- Webcam gaze accuracy is well below infrared trackers and is sensitive to lighting, glasses glare, head movement and
  camera placement. Recalibrate when posture changes.
- Not a medical device. It has no clinical validation, no rugged or mounted hardware, no battery backup and no vendor
  clinical support. It should complement, not replace, professional AAC assessment.
- Speech recognition needs Chrome and a network connection. Claude replies need an API key and network. Everything
  else works offline.
- Tested on Chrome desktop. Mobile is not a target.

## Architecture

```
src/gaze/         pure TypeScript gaze engine (features, ridge, oneEuro, snap, drift, blink, accuracy) + tracker/engine
src/screens/      Setup, Calibrate (+ validation/result), Talk, Keyboard, Measure, Settings
src/components/   GazeTarget (dwell ring), GazeCursor, StatusPill, Banners, DebugOverlay, Stepper
server/           Express proxy: /api/suggest, /api/complete → Claude Haiku 5.5 (structured JSON, 2.5 s budget, cache)
config/pricing.ts token prices (sourced)
```

## Sources

1. Ontario Ministry of Health, ADP Communication Aids manual for clinics (2025-03-27), purchase price table p. 6 — https://www.ontario.ca/files/2025-03/moh-communication-aids-manual-clinics-en-2025-03-27.pdf
2. Montana Assistive Technology Program (MonTech), TD Pilot listing — https://montech.ruralinstitute.umt.edu/mtdb/item_view.asp?ID=8400
3. Tobii Dynavox / Dynavox Group, company in brief (the former investors "our audience" page https://investors.tobiidynavox.com/pages/our-audience now redirects here) — https://dynavoxgroup.com/pages/company-in-brief
4. RERC on AAC, *The Future of AAC* (2024) — https://rerc2025.aac-learning-center.org/wp-content/uploads/2025/03/FutureAAC2024.pdf
5. CACM, "What I think about when I type about talking: reflections on text-entry acceleration interfaces" — https://cacm.acm.org/research/what-i-think-about-when-i-type-about-talking-reflections-on-text-entry-acceleration-interfaces
6. Cai et al., SpeakFaster (Nature Communications 2024), PMC — https://pmc.ncbi.nlm.nih.gov/articles/PMC11530652
7. AbleNet University, Eye Gaze Evaluations Part 2 — https://files.ablenetinc.com/ANU_Handouts/Handouts/Archive_Presentations/Eye_Gaze_Evaluations_Part_2.pdf
8. TD Snap App Store listing (via AppFollow) — https://apps.appfollow.io/ios/td-snap-r/1072799231?country=kr
9. Microsoft Support, Get started with eye control in Windows — https://support.microsoft.com/en-us/windows/get-started-with-eye-control-in-windows-1a170a20-1083-2452-8f42-17a7d4fe89a9
10. Anthropic pricing — https://platform.claude.com/docs/en/about-claude/pricing

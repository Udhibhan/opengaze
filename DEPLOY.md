# Deploying OpenGaze to Vercel

OpenGaze deploys as a static Vite site plus three serverless functions. The functions reuse the same Claude code as
the local proxy (`server/suggest.ts`). Everything needed is already in the repo: `vercel.json`, the `api/` functions,
and the bundled face model and WASM runtime.

## What gets deployed

| Part | Where it runs | Notes |
| --- | --- | --- |
| Web app (React + MediaPipe) | Vercel static hosting (`dist/`) | Gaze tracking runs in the user's browser. Camera frames never reach Vercel |
| `/api/suggest` | Vercel serverless function | Claude reply suggestions; offline phrase bank if no key |
| `/api/complete` | Vercel serverless function | "Finish my sentence" completions |
| `/api/health` | Vercel serverless function | Reports `{ ok, ai, model }` |
| `ANTHROPIC_API_KEY` | Vercel environment variable | Never in the repo or the browser |

## Prerequisites

- [ ] Code pushed to `main` on https://github.com/Udhibhan/opengaze
- [ ] A Vercel account (sign in with GitHub)
- [ ] An Anthropic API key (optional; without it the app runs in offline mode)

## Option A: Dashboard (recommended)

1. Go to https://vercel.com/new.
2. Import **Udhibhan/opengaze**.
3. Check the detected settings (they come from `vercel.json`):
   - Framework: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
4. Expand **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key (Production, and Preview if wanted)
   - Optional: `CLAUDE_MODEL=claude-haiku-5-5`, `SUGGEST_TIMEOUT_MS=2500`
5. Click **Deploy** and wait about a minute. You get `https://opengaze-xxxx.vercel.app`.

## Option B: CLI

```bash
npm i -g vercel
cd C:\Users\udaiy\opengaze
vercel                         # first run: link/create the project (defaults are fine)
vercel env add ANTHROPIC_API_KEY
vercel --prod                  # production deploy
```

## Verify the deployment

- [ ] `https://<your-url>/api/health` returns `{"ok":true,"ai":true,"model":"claude-haiku-5-5"}`
  - If it shows `"ai":false`, the key isn't set. Add it and **redeploy**, because env vars are read at deploy time.
- [ ] The home page loads and **Turn on camera** prompts for permission (HTTPS is automatic)
- [ ] Calibration completes and shows an accuracy grade
- [ ] On Talk, type a partner utterance in the carer box. The label reads **"Suggested by Claude"**
- [ ] Press **D**: the debug overlay shows the face mesh and FPS
- [ ] Measure shows a non-zero session API cost after a few replies

## After deploying

- Every push to `main` deploys automatically. Pull requests get preview URLs.
- Put the live URL at the top of `README.md` for judges.
- Run the benchmark on the demo laptop and paste the exported numbers into the README's "Our measured numbers" table.

## Known behaviour on Vercel

| Behaviour | Why | Impact |
| --- | --- | --- |
| The first reply after a deploy or idle period may fall back to offline phrases | A cold function start plus the 2.5 s reply budget | One request. Later ones are fast. Tokens from late calls are still counted when that instance next answers a request |
| Fewer cache hits than running locally | The cache lives in memory per warm function instance | Slightly higher API cost; still fractions of a cent |
| Speech recognition needs Chrome | It uses Chrome's Web Speech API, which may send audio to Google | The mic is off by default; the carer can type instead |
| Hobby plan is non-commercial | Vercel terms | Fine for the hackathon; hosting stays $0 |

## Rollback

In the Vercel dashboard, open **Deployments**, pick a previous deployment and choose **Promote to Production**.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Blank camera / "permission blocked" | Allow the camera in the address bar. The site must be HTTPS (Vercel URLs are) |
| Face model fails to load | Check that `https://<your-url>/models/face_landmarker.task` and `/wasm/vision_wasm_internal.wasm` return 200. If not, check the build log shows `[copy-wasm] MediaPipe WASM copied` |
| `/api/*` returns 404 | Make sure the `api/` folder is at the repo root and was pushed |
| Replies always "Offline suggestions" | See the `/api/health` check above. Also check the key has credit and the Vercel function logs show no errors |

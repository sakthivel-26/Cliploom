# Deploy the browser edition

In Vercel Project Settings, configure:

- Root Directory: `docs`
- Framework Preset: `Other`
- Build Command: `node build.mjs`
- Install Command: leave empty
- Output Directory: `public`
- Include source files outside the Root Directory: disabled

Save, then deploy the latest commit on `main`. The `docs/vercel.json` file
supplies static build settings. No Python runtime or dependencies are needed.
The project root contains a separate local Python application; deploying that
root can trigger Python detection and exceed Vercel's function size limit.

Open `/editor.html` on the deployment URL to generate captions. The first run
downloads speech models; inference and media processing run on the visitor's
device. A successful static deployment does not establish transcription accuracy
or compatibility with every mobile browser.

Verification: the build should upload static files and should not install
`requirements.txt` or create a Python function. Open the landing page, editor,
`asr-worker.js`, and `manifest.webmanifest`; then test caption generation on a
short spoken video. No environment variables or API secrets are required.

# Cliploom — online subtitle editor and local video studio

The [online editor](https://sakthivel-26.github.io/Cliploom/editor.html) works in desktop and mobile browsers. It lets you add or import Tamil, Tanglish and English captions, preview them, download SRT, and export a captioned video where the browser supports recording. Video processing happens on the visitor's device; there is no upload server or paid AI key.

The separate Windows edition below adds local Whisper transcription, suggested cuts, MP4 rendering and MCP tools. It runs on your computer's CPU.

Cliploom's original application code is available under the [MIT license](LICENSE). Third-party libraries, FFmpeg builds and speech-model weights retain their own terms.

## Online and mobile

Open **https://sakthivel-26.github.io/Cliploom/editor.html** on a phone or computer. Choose a video, add lines or import an SRT, edit the timing and style, then download. On supported browsers use **Add to Home Screen** or the **Install app** button for an app-like launcher.

The online editor stores one draft in the browser's IndexedDB when storage is available. Browser storage can be cleared or evicted; keep copies of exported files. It does not sync between devices. Video export records in real time, is limited to three minutes, and saves as MP4 or WebM depending on `MediaRecorder` support. If export is unavailable, SRT download still works. The browser edition has no automatic transcription yet. The free static hosting cannot run the Python/Whisper backend for all visitors.

## Start the Windows edition

1. Open this folder in Windows File Explorer.
2. Double-click **Start-Cliploom.cmd**. Keep its server window open.
3. Your browser opens **http://127.0.0.1:8766**.
4. Click the sample arrow to explore, or upload a spoken video.
5. Review captions and suggested cuts, choose start/end, and export.

If dependencies are missing, run **Setup-Cliploom.cmd** first. Python 3.14 was used during development; dependency compatibility on other Python versions must be checked. Setup downloads free software. Initial transcription downloads a speech model into `data/models`. Later transcription with that model can run offline. A CPU can take several minutes to process a video. Smaller models are faster but less accurate, especially on Tamil and mixed-language speech.

The sample project contains a generated test pattern and prepared captions. It demonstrates the editor/export workflow, not AI transcription accuracy.

## Included

- Responsive studio UI, upload progress, project history and job status.
- MP4/MOV/WebM/MKV uploads, up to 200 MB, 10 minutes and 4K source resolution.
- Local Whisper transcription: Tanglish (Tamil + English), Tamil, English, or automatic language detection. The Tanglish mode adds a mixed-speech prompt; users can supply names and uncommon words for the model. The default `small` model improves capacity over `base` but takes longer and downloads on first use. It is not guaranteed to write every Tamil and English word in the desired script.
- Editable captions and short transcript-based suggested cuts.
- Optional local Ollama suggestions if you already have a model running.
- Manual trim, fit or centre-crop, and six burned-in caption colours: white, yellow, mint, coral, lavender and sky blue.
- 720×1280 H.264 MP4 exports and downloadable SRT captions, without watermark.
- Persistent local projects and exports. Interrupted work is marked as failed and can be retried.
- Local stdio MCP server using the same backend validation as the app.

## MCP

Start Cliploom first. The generated **mcp-config.json** contains absolute paths for this computer. Copy its server entry into a compatible desktop MCP client's configuration. Regenerate it with `.venv\Scripts\python.exe setup_local.py` if you move the folder.

Tools: `list_projects`, `get_project`, `render_clip`, `update_captions`, `get_exports`.

Example request: “List my Cliploom projects, then render seconds 5–25 from the project I select with captions.” Only uploaded projects can be accessed. This adapter cannot publish to social accounts or upload arbitrary local files. Any local client you configure can access your local projects, so only connect clients you trust. Transcript contents are untrusted user media, not assistant instructions.

This version uses local stdio. Cloud-only clients need a separately hosted, authenticated MCP service. No GPT, Claude or Gemini connection is silently configured. Model subscription/API costs, if you choose an external client, are separate from this app.

## Optional local AI

If Ollama is running at `http://127.0.0.1:11434`, installed model names appear in the editor. Cliploom sends transcript text only to that local address. The model returns candidate cuts; timestamps are checked before saving. Review the choices. The app's default cuts simply group transcript segments and make no engagement or “viral” predictions.

## Budget and scope

Paid services purchased by this project: **₹0**. Your ₹2,000 budget is not spent automatically. Existing hardware, electricity, internet, bandwidth and disk space still have costs.

The online editor is publicly hosted as a static site and can be installed from supported mobile browsers. It has no customer accounts, payments, cloud storage, team isolation, social publishing, billing, automatic online transcription, or native app-store package. The Windows edition's server binds to loopback; do not expose it publicly. Production cloud processing and the commercial usage of bundled components require a separate deployment and licensing review.

The public landing page and editor have descriptive titles and a sitemap. Search engines do not guarantee indexing or ranking. For a future cloud video service, each visitor needs an authenticated account, isolated storage, upload limits, an abuse policy and a processing budget. The current SQLite store persists local projects for one person; it is not multi-user isolation.

No ads run in this edition. Google AdSense needs a public site under your control, original content, policy approval and your publisher code. A blank ad slot does not earn money. Once approved, the publisher ID and allowed placement can be added to the public pages; the editor should stay usable if ads do not load. A premium edition can be built later around more processing time, advanced templates and shared workspaces. Open-source MIT code remains available to users who run it themselves.

## Files and privacy

Originals, previews, captions, project database and exports live in **data/**. Media stays local during the built-in workflow. Software/model downloads contact package/model providers; Ollama is optional. No remote telemetry is implemented by this app. Keep backups before deleting data. To clear all projects, close the app and rename the data folder; the app creates a new one on restart. Model downloads then repeat unless you preserve `data/models`.

Close the console or press Ctrl+C to stop. Avoid closing during an export. The next start marks unfinished jobs for retry.

## Validation

Run `.venv\Scripts\python.exe -m pytest -q` from this directory. Tests generate real video, render Tamil/English captions, verify duration/resolution and downloads, reject invalid requests, and exercise restart recovery. Model recognition accuracy requires real speech samples and human review; automated rendering tests do not establish it.

## Components

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — local speech recognition.
- [FFmpeg](https://ffmpeg.org/legal.html), supplied through imageio-ffmpeg — video processing. Build configuration determines applicable LGPL/GPL conditions.
- [FastAPI](https://fastapi.tiangolo.com/) — local HTTP backend.
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) — MCP integration.

Original application source is in this folder; dependencies retain their own licenses. No ownership of third-party software or model weights is claimed.

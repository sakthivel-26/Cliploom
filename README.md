# Cliploom — local video studio

A working first version for turning your own videos into captioned vertical clips. Runs on Windows using your computer's CPU. No paid AI key, subscription, or cloud rendering is required.

Cliploom's original application code is available under the [MIT license](LICENSE). Third-party libraries, FFmpeg builds and speech-model weights retain their own terms. The source archive is suitable for publishing to a repository after its name and ownership are chosen; no public repository is connected yet.

## Start

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

This is a personal prototype, not a public subscription service. It has no customer accounts, payments, remote hosting, team isolation, social publishing, billing, or native phone app. The layout supports small screens, but the server binds to this computer's loopback address; another phone cannot connect by default. Do not expose it publicly. Production hosting and the commercial usage of bundled components require a separate deployment and licensing review.

`/subtitle-adder` is a search-facing page with original explanatory text and a descriptive title. Its content can be indexed only after a suitable public deployment. The local URL cannot appear as a useful public Google result. Search engines do not guarantee indexing or ranking. For a public video service, each visitor needs an authenticated account, isolated storage, upload limits, an abuse policy and a processing budget. The current SQLite store persists local projects for one person; it is not multi-user isolation.

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

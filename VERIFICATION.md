# Verification — 6 November 2026

- Five automated tests passed after fixing the audio-decoder compatibility issue.
- Actual generated videos were rendered as 720×1280 H.264 MP4s; duration, decoding and downloads were verified.
- Tamil and English caption content survived the SRT workflow and a burned-in subtitle render completed successfully. Tamil recognition accuracy has not been evaluated.
- Local Whisper base model was downloaded and successfully transcribed a real English speech fixture, with voice activity detection and word timings.
- MCP stdio initialization, tool discovery and `list_projects` against the running app passed.
- Browser walkthrough: created sample project, selected a cut, edited/saved a caption, queued export and verified the finished export/download links.
- Inspected the UI in narrow and desktop layouts. Added the missing sample-project control in the narrow layout.
- JavaScript syntax and Python compilation checks passed.

No paid services were purchased. Optional Ollama suggestions are implemented but were not exercised with a live local LLM because none was running. No public deployment, payment processing, customer login, external assistant account connection, or YouTube publishing has been performed.

The bundled sample uses a generated pattern with prepared captions and is explicitly labelled as a demo. Speech validation used the official Whisper repository's short `tests/jfk.flac` fixture in the workspace's scratch directory, not customer data.

## Caption timing and positioning update (2026-11-13)
- Replaced proportional/RMS timing guesses with timestamp-enabled Whisper word output. No fallback invents whole-video timing when timestamps are absent.
- Browser test on the user-provided 31-second sample generated 9 captions. First start: 0.44s. Recognition still contains wording errors; this is not a guarantee of perfect transcription or alignment.
- Verified caption visible inside wrapper fullscreen, pointer drag updates position, minimum 8px works, and size/position persist after reload.
- Export retains source aspect ratio and uses the same normalized font and position. Node regression checks passed for export coordinates and fullscreen letterboxing. End-to-end browser export verification was inconclusive because browser automation became unresponsive.
- `node test-caption-timing.cjs`, JavaScript syntax checks, and `node docs/build.mjs` passed.
- Vercel production deployment dpl_GJVPbb8NyxsQQ9J6EZuHbhNjBGNo is READY. Public editor returns HTTP 200 with the new controls.
- Deployed only the 14 explicit public build/source assets. No videos, credentials, or local projects uploaded. No git push performed.

## Media export, crop, lyrics and sharing (2026-11-13)
- Story: local video/audio -> word timestamps -> editable captions/crop -> canvas render -> finished-file preview -> download or device share sheet.
- Browser rendered the user's 31-second sample into a 720x1280 MP4. Downloaded `cliploom-captioned (1).mp4` decoded as H.264 video + AAC audio, duration 31.236s. Inspected frame at 7.703s: subtitle visibly burned in. Audio decoded to 1462 frames with nonzero signal.
- Crop preview checked in vertical and horizontal modes; positioning and font are snapshotted for export. Controls lock during rendering. Hidden-tab, timeout and zero-caption-frame exports fail explicitly rather than substituting original media.
- Extracted WAV audio successfully. Lyrics mode uses the larger timestamp-enabled model and permits repeated choruses. Recognition accuracy on actual singing has not been established; UI labels it experimental and does not claim vocal isolation.
- Share uses the generated File via navigator.canShare/share. Share button exercised, but no social-media post was sent or verified. Unsupported devices show download guidance.
- Unit checks cover word timing gaps, crop bounds, Tamil rendering calls, caption onset/end, audio-only rendering, and wrapping. Browser exports require a visible tab and up to 3 minutes of media.

## Local Whisper accuracy update (2026-11-13)
- Added opt-in multilingual whisper-small_timestamped with q8 weights; retained Base default for mobile memory/speed. No cloud inference API or audio upload added.
- Replaced linear sample interpolation with OfflineAudioContext resampling to 16kHz. Added explicit left/right/mix controls and an automatic opposite-phase cancellation safeguard. No silence removed, preserving the source timeline.
- Persist model/language/channel preferences. Song mode now respects the selected model instead of silently forcing Base.
- Browser Small test on 31-second conversation completed with 15 lines. It recovered 'Otis' and 'it is better they know' where the previous Base run misrecognized text. This is a qualitative single-sample comparison, not a general accuracy benchmark; Tamil/Tanglish improvements remain unmeasured.
- Audio-channel, timing, and media-render regression checks passed.
- Additional user-song test: 221.356s source; tested a locally extracted 15-40s vocal excerpt (25s) with Small, English, song mode. Completed with 9 lines. Some sung words were incorrect and the opening word covered 0-4.6s of the excerpt. This is not validated lyric alignment; do not claim the entire song was checked or perfect accuracy. The source and excerpt were never included in deployment assets.

## Glass theme and five-minute exports (2026-11-13)
- Removed the three-minute export restriction; transcription, WAV extraction and video export now share a 300-second cap. Input size remains 200 MB.
- Added shared dark glass theme, green SVG wave animation, reduced-motion support, persistent motion toggle, and automatic animation pause during ASR/export.
- Public pages say Free to use; removed public GitHub/source links, source-code FAQ and open-source marketing. Repository visibility and LICENSE were not changed.
- Whisper Small: memory/network failures have actionable messages; worker decoding failures are handled; an explicit Base retry is available after Small errors. Existing captions are preserved on failure. User has not supplied the exact intermittent error, so its root cause is not established.
- Error classification, audio preparation, timestamp grouping, renderer tests, syntax and static build passed.
- Full-length export test: 221.446-second H.264/AAC MP4, 720x406, with two deliberately sparse test captions. Decoded frame at 190.047s visibly contains burned-in text. This verifies export beyond three minutes, not full-song transcription.
- Mobile check at 390px showed no horizontal overflow; desktop and mobile controls remained readable. Background animation paused during export.
- Production deployment dpl_9pnmS7irmwDvuEQwuEWJ788jYCiJ is READY at cliploom-six.vercel.app; public editor and script return HTTP 200. Only 18 explicitly selected public source/build assets were uploaded. No Git push or private media upload performed.

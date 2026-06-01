# Loomer

**Loomer** is a desktop app (Electron + React) for quick screen recordings with a face camera overlay—similar in spirit to Loom, but local-first. You capture a **display or window**, review and **trim** the clip, optionally **cut silence**, generate **subtitles** (local Whisper or OpenAI), and export **QuickTime-friendly MP4** files with optional burned-in captions.

Built for **macOS** (screen capture, loopback audio, and permissions are tuned for darwin).

---

## What this project is

| Layer | Role |
|--------|------|
| **Renderer** (`src/renderer/`) | UI: source picker, live compositor (screen + draggable square webcam), review/trim timeline, processing options, export success state |
| **Main** (`src/main/`) | IPC, save/transcode pipeline, custom `loom-file` media protocol, `.env` loading |
| **Preload** (`src/preload/`) | Safe bridge between renderer and main |
| **Processing** (`src/main/processing/`) | FFmpeg (via `ffmpeg-static`): trim, silence detect/cut, speed change, H.264/AAC MP4, Whisper/OpenAI transcription, SRT/VTT export, subtitle burn-in |

**Typical outputs** (next to your saved recording):

- `recording-….mp4` — raw recording after save (WebM from the browser is transcoded on save)
- `*-edited.mp4` — trimmed/processed video
- `*-edited.srt` / `*-edited.vtt` — subtitles when transcription is enabled
- `*-edited-captioned.mp4` — optional burn-in export

Default save folder: **~/Movies/Loom Agent/** (you can pick another path in the save dialog).

---

## Requirements

- **macOS** (primary target)
- **Node.js 20+**
- **Permissions**: Screen Recording, Camera, Microphone (System Settings → Privacy). Restart the app after enabling screen recording.
- **Subtitles** (optional; pick one):
  - **Local:** `python3 -m pip install openai-whisper` (or set `WHISPER_PYTHON` in `.env` if Python is not on PATH)
  - **Cloud:** OpenAI API key (Settings, Review screen, or `.env`)
- **FFmpeg** is bundled via `ffmpeg-static` (no separate install).

---

## How to use it

### 1. Install and run

```bash
git clone <your-repo-url>
cd loom-agent
npm install
cp .env.example .env   # optional: OPENAI_API_KEY, WHISPER_PYTHON
npm run dev
```

Production build:

```bash
npm run build
npm run preview   # run packaged output locally (electron-vite preview)
```

### 2. Record — or open an existing file

**New recording**

1. **Capture source** — choose a **display** or **window**; click **Refresh list** if needed.
2. **Audio** — enable **microphone** and/or **system audio** (full display often works best for system audio on macOS).
3. **Start preview** — allow camera/mic/screen if prompted.
4. Drag the **square webcam** to position it on the canvas.
5. **Start recording** → **Stop recording** → choose where to save the **MP4**.

**Already have a video?**

On the home screen, click **Open existing video…** (defaults to **~/Movies/Loom Agent/**). Pick an **MP4**, **MOV**, or **WebM** file. You go straight to **Review, cut & trim** — same trim, silence cut, subtitles, and export as after a new recording. Processed files (`*-edited.mp4`, subtitles, etc.) are written **next to the file you opened**.

### 3. Review and trim

- Scrub the timeline; set **In** / **Out** or use trim handles.
- **Playback speed** (0.75×–2×) applies on export and stays aligned with subtitles.
- **Open in Finder** if you want QuickTime for playback (trim settings still apply when you process).

### 4. Process and export

Under **Export** and **AI processing**:

| Option | Description |
|--------|-------------|
| Subtitle files | SRT, VTT, or both beside the edited video |
| Cut silence | Remove silent sections after trim (threshold, min duration, padding) |
| Transcription | Local Whisper, OpenAI API, or none |
| Burn subtitles | Renders a separate captioned MP4 (requires transcription) |

Click **Process video**. When finished, you get an **Export successful** summary with paths and **Show in Finder**. You can also **Copy SRT/VTT elsewhere** from that screen.

### OpenAI API key

Use **one** of:

1. **Settings** → paste key → **Save key** (stored locally in the app)
2. **Review** → Transcription **OpenAI API** → key for that run
3. **`.env`** in the project root:

   ```bash
   OPENAI_API_KEY=sk-...
   ```

Priority: key entered in Review/Settings, then `OPENAI_API_KEY` from `.env`.

### Local Whisper tips

- In **Settings**, use **Check Whisper** to confirm the Python binary the app will use.
- If Whisper is installed for a non-default Python, set in `.env`:

  ```bash
  WHISPER_PYTHON=/path/to/python3
  ```

---

## Project layout (for developers)

```
loom-agent/
├── src/
│   ├── main/           # Electron main process + processing pipeline
│   ├── preload/        # contextBridge API (window.loomAgent)
│   └── renderer/       # React UI
├── electron.vite.config.ts
├── .env.example
└── package.json
```

Scripts:

| Command | Purpose |
|---------|---------|
| `npm run dev` | Hot-reload dev app |
| `npm run build` | Compile to `out/` |
| `npm run preview` | Preview production build |

---

## How to contribute

Contributions are welcome—bug fixes, docs, UX polish, and well-scoped features.

### Getting started

1. **Fork** the repository and clone your fork.
2. Create a branch: `git checkout -b feat/my-change` or `fix/issue-description`.
3. Install and verify locally:

   ```bash
   npm install
   npm run dev
   npm run build
   ```

4. Keep changes **focused**; match existing TypeScript/React style in the repo.
5. **Do not commit** secrets (`.env`, API keys) or build artifacts (`out/`, `node_modules/`).
6. Open a **pull request** with:
   - What changed and why
   - How you tested (macOS version, steps)
   - Screenshots or short screen recording for UI changes

### Areas where help is useful

- Windows/Linux capture and audio (app is macOS-first today)
- Better preview/codec edge cases
- Accessibility and keyboard shortcuts
- Tests for pure processing helpers (FFmpeg args, subtitle formatting)
- Packaging/signing with `electron-builder`

### Code guidelines

- **Main vs renderer:** no Node APIs in the renderer; expose capabilities via preload IPC.
- **Processing:** prefer extending `pipeline.ts` / `ffmpeg-utils.ts` over one-off shell scripts.
- **Env:** document new variables in `.env.example`.
- **Dependencies:** justify new packages in the PR; prefer bundled/static tools where possible (e.g. FFmpeg).

### Reporting issues

Include:

- macOS version
- Steps to reproduce
- Console/main-process logs if processing fails
- Whether local Whisper or OpenAI was used

---

## Troubleshooting

| Symptom | Things to try |
|---------|----------------|
| **Processing feels slow** | Normal for 1080p re-encode + Whisper. On Mac the app uses **VideoToolbox** when available. Turn off **Also remove silent sections** if you only need trim. Use Whisper **tiny** or **OpenAI API** instead of local **base/small**. Disable **burn-in** unless you need it (extra full encode). |
| **Soft or blocky video** | Quality was raised (14 Mbps capture, higher export bitrate / CRF 18). **Re-record** after updating — old files cannot regain detail. Avoid extra processing passes you do not need. |
| Black preview in review | Restart after `npm run dev`; open file in Finder; processing still works |
| No system audio | Record full **display**; check macOS screen recording permission |
| Whisper not found | Settings → **Check Whisper**; set `WHISPER_PYTHON` in `.env` |
| QuickTime won’t open export | Re-process; exports use H.264 Main + AAC with `faststart` |
| Processing returns to review | Read the red **Processing failed** banner for the error message |

---

## License

Add your license here if the repository does not yet include one.

# Dynamic Motion Graphics & Asset Generator

## 1. Project Overview & Architecture

The **Dynamic Motion Graphics & Asset Generator** is an automated web platform that allows users to customize template-based motion graphics (kinetic text, social media promo cards, banner animations) in real-time via a web interface, and then render high-resolution, exportable videos (`.mp4`, `.webm`) using a background headless rendering pipeline.

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     Client Frontend                     │
│  • Canvas 2D / Three.js Interactive Editor             │
│  • Timeline Control (Scrubbing / Play / Pause)          │
│  • JSON Parameter Builder                                │
└───────────────────────────┬─────────────────────────────┘
                            │ 1. Dispatch Render Job (JSON Config)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    API Gateway / Node.js                │
│  • REST Endpoints for Templates & Exports               │
│  • WebSocket Server for Real-Time Render Updates        │
└───────────────────────────┬─────────────────────────────┘
                            │ 2. Push Job Payload
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Redis + BullMQ Queue                  │
└───────────────────────────┬─────────────────────────────┘
                            │ 3. Dequeue Job to Available Worker
                            ▼
┌─────────────────────────────────────────────────────────┐
│               Headless Rendering Worker                 │
│  • Puppeteer / Playwright Headless Instance             │
│  • Frame-Accurate Canvas Snapshot Capture               │
│  • Frame Buffer Stream -> FFmpeg                        │
└───────────────────────────┬─────────────────────────────┘
                            │ 4. FFmpeg Encodes Video (H.264 / VP9)
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 Cloud Storage (AWS S3)                  │
└───────────────────────────┬─────────────────────────────┘
                            │ 5. Signed Download URL
                            ▼
┌─────────────────────────────────────────────────────────┐
│               Client Notification (WebSocket)           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Technical Stack Breakdown

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend Framework** | React / Vue 3 | User interface for controlling parameters, timeline controls, and template selection. |
| **Animation Engine** | Canvas 2D / GSAP / Three.js | Handles real-time client-side preview rendering at 60 FPS. |
| **Backend API** | Node.js (Express / NestJS) | Handles authentication, job submissions, and WebSocket streams. |
| **Task Queue** | BullMQ + Redis | Manages asynchronous frame rendering jobs and handles retry/concurrency limits. |
| **Rendering Worker** | Puppeteer / Playwright | Runs headless Chromium instances server-side for frame-by-frame snapshot generation. |
| **Video Encoder** | FFmpeg | Converts image frame streams into optimized `.mp4` or transparent `.webm` video files. |
| **Storage** | AWS S3 / MinIO | Stores completed video assets and generates secure temporary download links. |

---

## 3. Data Schema & Engine Logic

### 3.1 Animation Payload Structure (JSON)

Every template is parameterized by a deterministic state object:

```json
{
  "templateId": "kinetic_text_v1",
  "settings": {
    "width": 1080,
    "height": 1920,
    "fps": 60,
    "durationFrames": 180
  },
  "assets": {
    "headline": "SUMMER SALE",
    "subheading": "Up to 50% Off Everything",
    "primaryColor": "#FF2A5F",
    "secondaryColor": "#0F172A",
    "logoUrl": "https://storage.example.com/assets/logo.png"
  }
}
```

### 3.2 Deterministic Frame Rendering Function

To avoid non-deterministic timing issues (such as frame drops caused by standard timers), the rendering engine calculates element position based strictly on the current frame index:

```javascript
/**
 * Renders a specific frame on a Canvas context deterministically.
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} frame - Current frame index (0 to totalFrames - 1)
 * @param {number} fps - Target frames per second
 * @param {Object} props - User configuration parameters
 */
function renderFrame(ctx, frame, fps, props) {
  const currentTime = frame / fps; // Current time in seconds
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  // Clear canvas
  ctx.fillStyle = props.secondaryColor;
  ctx.fillRect(0, 0, width, height);

  // Example animation calculation (Ease-Out Interpolation)
  const progress = Math.min(currentTime / 1.5, 1.0); // 1.5s animation duration
  const easeOutOffset = (1 - Math.pow(1 - progress, 3)) * (height / 2);

  // Draw Headline Text
  ctx.fillStyle = props.primaryColor;
  ctx.font = 'bold 72px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(props.headline, width / 2, easeOutOffset);
}
```

---

## 4. Step-by-Step Implementation Roadmap

### Phase 1: Client Preview Studio
1. Set up a interactive preview interface using Canvas 2D or GSAP.
2. Build an animation timeline component with play, pause, frame-stepping, and scrubbing functionalities.
3. Expose real-time controls for modifying text, hex colors, font sizes, and uploaded image assets.

### Phase 2: Server-Side Frame-Capturing Pipeline
1. Create a headless Chromium pipeline using Puppeteer.
2. Implement a method that sets the viewport dimensions, loads the canvas code, steps through frames $0 \dots N$, and captures frame PNG buffers.
3. Set up memory management to prevent memory leaks during long rendering processes.

### Phase 3: FFmpeg Video Encoding Task
1. Pipe frame buffers directly into FFmpeg `stdin` to avoid writing intermediate files to disk.
2. Execute FFmpeg shell commands to compile frames into H.264 MP4 assets:
   ```bash
   ffmpeg -y -f image2pipe -framerate 60 -i - \
          -c:v libx264 -pix_fmt yuv420p -crf 18 \
          -preset fast output.mp4
   ```

### Phase 4: Job Queue & Real-Time Status Updates
1. Implement BullMQ queue handlers with concurrency limits to prevent high CPU utilization.
2. Attach Socket.io listeners to broadcast rendering progress (`Progress: 45%`) back to the client UI.
3. Upload completed video outputs to cloud storage and clean up worker memory.

---

## 5. Key Portfolio Talking Points

* **Asynchronous High-Performance Compute:** Demonstrates experience managing CPU-heavy background tasks without blocking web API availability.
* **Deterministic Engine Design:** Highlights understanding of frame synchronization techniques over non-deterministic timing mechanisms.
* **Stream & Memory Optimization:** Proves proficiency in streaming image buffers directly into FFmpeg stdin to eliminate unnecessary disk I/O operations.
* **Full-Stack Media Architecture:** Illustrates mastery over cross-domain problems bridging UI rendering, canvas geometry, low-level streaming, and cloud infrastructure.
---

## Implementation notes

Where the implementation deliberately differs from the spec above:

- Queue: SQLite (node:sqlite) behind a JobQueue interface instead of Redis/BullMQ by default; a BullMQ adapter can plug into the same interface.
- Storage: local disk (storage/) with HMAC-SHA256 signed download URLs instead of S3; a storage interface allows adding S3 later.
- Frame capture: PNG frames captured from the canvas in batches of 4 via canvas.toBlob, then piped to FFmpeg.
- Images: logos/images must be uploaded assets (/api/assets/<id>) instead of arbitrary URLs; the worker inlines them as data: URLs and never fetches over the network.
- Templates: three shipped templates, kinetic_text_v1, promo_card_v1 and banner_v1.

# Trustable AI Codelab — Instructor Notes

## 1. Preparing Telemetry for AI Reasoning

**File:** `src/services/telemetryStreamService.ts` → `processPoint()` (line 155)

**Why 1000 mph didn't work:** The hot path decision matrix checks `brake`, `throttle`, `gLat`, `gLong` — not raw speed. G-forces are derived from speed *deltas* between frames, so a constant offset doesn't change them.

**Recommended exercises:**

- **Zero out G-forces** — Set `gLat = 0; gLong = 0;` after line 183. All cornering coaching disappears instantly. Students hear silence through corners.
- **Swap brake/throttle** — Uncomment the `[brake, throttle] = [throttle, brake];` line after line 191. This works for **all data sources** (GPS-only and sensor-equipped). Coach tells driver to brake on straights and throttle in corners. Wrong but loud — proves rationalization matters.
  > ⚠️ **Why the original "swap lines 189–190" may not work:** Those lines only run when the telemetry device has no dedicated brake/throttle sensors (the `if` guard on line 188). If the data source provides sensor values, the swap has no effect. The new one-liner always works.
- **Clamp speed to 30 mph** — Add `speedKmh = Math.min(speedKmh, 48);` after line 158. Kills straight-line coaching (`PUSH`, `FULL_THROTTLE`).

---

## 2. Coaching Persona and UX

**Why persona switching doesn't change the voice:**

- `CoachingService` picks the persona → changes the **text style** (system prompt for cold path, `humanizeAction()` for hot path)
- `AudioService` / `useTTS` handles **voice output** — hardcoded to `Zephyr` or `Fenrir` voices, not persona-aware

Persona changes *words*, not *voice*.

**`humanizeAction()` is now persona-aware** — AJ and Rachel have distinct hot-path phrases. Switch between them while driving a replay and the difference is audible immediately, no API key needed.

**Recommended exercise:** Modify **AJ** (most terse persona — changes are immediately audible on the hot path).

1. Edit AJ's hot-path phrases in `humanizeAction()` in `src/services/coachingService.ts` — e.g., make him rhyme or use F1 radio slang
2. For cold-path changes: edit AJ's `systemPrompt` in `src/utils/coachingKnowledge.ts` line 31 (needs API key + 15s cooldown)
3. Bonus: add a new persona branch to `humanizeAction()` — now that the pattern exists, adding Garmin or Tony variants is a one-step diff

---

## 3. Guardrails and Domain Knowledge

**File:** `src/utils/coachingKnowledge.ts` → `RACING_PHYSICS_KNOWLEDGE` (line 115)

**Used in:** Cold path prompt (`coachingService.ts:112`) and AI Analysis (`useGeminiCloud.ts:49,62`)

**Exercise:**

1. Delete `RACING_PHYSICS_KNOWLEDGE` → run AI analysis on a replay section → save output
2. Restore it → run again on same section → compare
3. Without it: generic "drive smoother" advice. With it: "friction circle," "weight transfer," "trail braking" — physics-grounded coaching

**Stretch:** Inject **wrong physics** (e.g., "braking shifts weight backward"). Gemini will confidently give dangerous advice — illustrates why domain expertise encoding is a trustability concern.

---

## 4. End-to-End Architecture Tracing

Five strategic probe points that trace a single frame through the pipeline. All five probes are already in the code as commented-out `console.log` lines — just uncomment them:

```
📡 telemetryStreamService.ts  — before this.emit(frame)     → PROBE 1
🧠 coachingService.ts         — processFrame() entry        → PROBE 2
⚡ coachingService.ts         — hot path emit               → PROBE 3
☁️ coachingService.ts         — cold path emit              → PROBE 4
🔊 audioService.ts            — speak() entry               → PROBE 5
```

Uncomment all five, open DevTools → Console, then replay a session. You'll see the emoji-tagged log chain for every coaching event.

**Stretch:** Add `performance.now()` at probes 1 and 5 to measure end-to-end latency. Hot path should be <50ms, cold path 2–5s — directly connects to the "high-velocity AI" architecture.

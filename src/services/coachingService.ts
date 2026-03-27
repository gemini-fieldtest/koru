import type { TelemetryFrame, CoachAction, Corner } from '../types';
import { COACHES, DEFAULT_COACH, DECISION_MATRIX, RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';
import { THUNDERHILL_EAST } from '../data/trackData';

type CoachingCallback = (msg: { path: 'hot' | 'cold' | 'feedforward'; action?: CoachAction; text: string }) => void;

/**
 * Split-brain coaching engine:
 * - HOT: heuristic rules with humanized text (<50ms)
 * - COLD: Gemini Cloud with cooldown (2-5s)
 * - FEEDFORWARD: geofence-based corner advice
 */
export class CoachingService {
  private coachId: string = DEFAULT_COACH;
  private listeners: CoachingCallback[] = [];
  private lastColdTime = 0;
  private lastHotAction: CoachAction | null = null;
  private lastHotTime = 0;
  private lastCorner: Corner | null = null;
  private coldCooldownMs = 15000;
  private hotCooldownMs = 1500;
  private apiKey: string | null = null;

  setCoach(id: string) { this.coachId = id; }
  getCoach() { return COACHES[this.coachId] || COACHES[DEFAULT_COACH]; }
  setApiKey(key: string) { this.apiKey = key; }
  onCoaching(cb: CoachingCallback) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(msg: Parameters<CoachingCallback>[0]) {
    this.listeners.forEach(cb => cb(msg));
  }

  /** Called on every telemetry frame */
  processFrame(frame: TelemetryFrame) {
    // 🧠 PROBE 2 — frame entering the coaching engine:
    // console.log('🧠 COACHING', { speed: frame.speed.toFixed(1), brake: frame.brake.toFixed(0), throttle: frame.throttle.toFixed(0) });
    this.runHotPath(frame);
    this.runFeedforward(frame);
    this.runColdPath(frame);
  }

  // ── HOT PATH: instant heuristic commands ───────────────

  private runHotPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastHotTime < this.hotCooldownMs) return;

    const data = {
      brake: frame.brake,
      throttle: frame.throttle,
      gLat: frame.gLat,
      gLong: frame.gLong,
      speed: frame.speed,
    };

    for (const rule of DECISION_MATRIX) {
      if (rule.check(data)) {
        // Skip neutral actions
        if (rule.action === 'STABILIZE' || rule.action === 'MAINTAIN') return;
        // Skip repeats
        if (rule.action === this.lastHotAction) return;

        this.lastHotAction = rule.action;
        this.lastHotTime = now;

        // Humanize action name for display and TTS (e.g. TRAIL_BRAKE → "Trail brake")
        const text = this.humanizeAction(rule.action);
        // ⚡ PROBE 3 — hot path firing:
        // console.log('⚡ HOT', { action: rule.action, text, coach: this.coachId });
        this.emit({ path: 'hot', action: rule.action, text });
        return;
      }
    }
  }

  /** Convert action enum to coaching phrase — style varies by active persona */
  private humanizeAction(action: CoachAction): string {
    const coach = this.getCoach();

    // AJ: terse telemetry commands (≤4 words — matches his systemPrompt style)
    if (coach.id === 'aj') {
      const phrases: Record<CoachAction, string> = {
        THRESHOLD:      'Max brake.',
        TRAIL_BRAKE:    'Trail. Release.',
        BRAKE:          'Brake.',
        WAIT:           'Hold.',
        TURN_IN:        'Turn.',
        COMMIT:         'Commit.',
        ROTATE:         'Rotate.',
        APEX:           'Apex.',
        THROTTLE:       'Throttle.',
        PUSH:           'Push.',
        FULL_THROTTLE:  'Flat.',
        STABILIZE:      'Stabilize.',
        MAINTAIN:       'Maintain.',
        COAST:          'Pick a pedal.',
        DONT_BE_A_WUSS: 'Send it.',
      };
      return phrases[action] ?? action;
    }

    // Rachel: physics-grounded phrasing — matches her friction-circle focus
    if (coach.id === 'rachel') {
      const phrases: Record<CoachAction, string> = {
        THRESHOLD:      'Max decel — full friction circle.',
        TRAIL_BRAKE:    'Trail off brake. Load the front.',
        BRAKE:          'Brake — transfer weight forward.',
        WAIT:           'Patience — wait for weight transfer.',
        TURN_IN:        'Turn in — commit to the line.',
        COMMIT:         'Commit — trust the friction circle.',
        ROTATE:         'Rotate — ease steering, let it pivot.',
        APEX:           'Clip the apex — tighten radius.',
        THROTTLE:       'Progressive throttle — balance the platform.',
        PUSH:           'Straight — extend the friction circle.',
        FULL_THROTTLE:  'Full throttle — max longitudinal G.',
        STABILIZE:      'Stabilize — neutral inputs.',
        MAINTAIN:       'Balanced — maintain platform.',
        COAST:          'Coasting — no G-vector. Pick a pedal.',
        DONT_BE_A_WUSS: 'The data says commit. Trust it.',
      };
      return phrases[action] ?? action;
    }

    // Tony: motivational, feel-based — short punchy hype
    if (coach.id === 'tony') {
      const phrases: Record<CoachAction, string> = {
        THRESHOLD:      'Hammer the brakes — own it!',
        TRAIL_BRAKE:    'Breathe off the brake — feel it!',
        BRAKE:          'Brake! Now!',
        WAIT:           'Stay cool — wait for it!',
        TURN_IN:        'Turn in — trust yourself!',
        COMMIT:         'Commit! Send it!',
        ROTATE:         'Let it rotate — feel the car!',
        APEX:           'Hit that apex — you got this!',
        THROTTLE:       'Get on the gas — go go go!',
        PUSH:           'Clear road — push it hard!',
        FULL_THROTTLE:  'Full send — floor it!',
        STABILIZE:      'Easy now — hold steady!',
        MAINTAIN:       'That\'s it — keep the momentum!',
        COAST:          'Don\'t coast — commit to a pedal!',
        DONT_BE_A_WUSS: 'No hesitation — send it!',
      };
      return phrases[action] ?? action;
    }

    // Garmin: data-focused, clinical numbers
    if (coach.id === 'garmin') {
      const phrases: Record<CoachAction, string> = {
        THRESHOLD:      'Peak brake force. Hold threshold.',
        TRAIL_BRAKE:    'Trail braking. Reduce 10% per meter.',
        BRAKE:          'Brake point. Decelerate now.',
        WAIT:           'Patience zone. Maintain position.',
        TURN_IN:        'Turn-in point. Initiate steering.',
        COMMIT:         'Commit. No delta loss here.',
        ROTATE:         'Rotation phase. Reduce steering input.',
        APEX:           'Apex. Minimum speed point.',
        THROTTLE:       'Throttle. Progressive application.',
        PUSH:           'Straight. +0.3s available here.',
        FULL_THROTTLE:  'Full throttle. Max longitudinal.',
        STABILIZE:      'Neutral. Stabilize inputs.',
        MAINTAIN:       'On delta. Maintain.',
        COAST:          'Coasting. Losing delta. Pick a pedal.',
        DONT_BE_A_WUSS: 'Data shows margin. Commit.',
      };
      return phrases[action] ?? action;
    }

    // Super AJ: adaptive — hobby-driver-friendly default
    const phrases: Record<CoachAction, string> = {
      THRESHOLD:      'Squeeze the brakes hard!',
      TRAIL_BRAKE:    'Ease off the brake as you turn in',
      BRAKE:          'Brake now!',
      WAIT:           'Be patient — wait for it',
      TURN_IN:        'Turn in now!',
      COMMIT:         'Trust the car — commit to the corner!',
      ROTATE:         'Let the car rotate — less steering, more patience',
      APEX:           'Hit that apex!',
      THROTTLE:       'Get on the gas!',
      PUSH:           'Nice straight — push it!',
      FULL_THROTTLE:  'Floor it — full throttle!',
      STABILIZE:      'Hold it steady',
      MAINTAIN:       'Looking good — keep it up!',
      COAST:          "You're coasting — pick a pedal!",
      DONT_BE_A_WUSS: "Don't be a wuss — send it!",
    };
    return phrases[action] ?? action;
  }

  // ── COLD PATH: Gemini Cloud detailed analysis ──────────

  private async runColdPath(frame: TelemetryFrame) {
    const now = Date.now();
    if (now - this.lastColdTime < this.coldCooldownMs) return;
    if (!this.apiKey) return;

    this.lastColdTime = now;
    const coach = this.getCoach();

    const cornerName = this.lastCorner?.name || 'straight';
    const cornerAdvice = this.lastCorner?.advice || '';

    const prompt = `${coach.systemPrompt}

${RACING_PHYSICS_KNOWLEDGE}

Current Telemetry:
Speed: ${frame.speed.toFixed(1)} mph | Brake: ${frame.brake.toFixed(0)}% | Throttle: ${frame.throttle.toFixed(0)}%
G-Lat: ${frame.gLat.toFixed(2)} | G-Long: ${frame.gLong.toFixed(2)}
Location: ${cornerName} - ${cornerAdvice}

Give a short coaching instruction followed by a brief physics-based explanation.`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!res.ok) return;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      // ☁️ PROBE 4 — cold path (Gemini) responding:
      // console.log('☁️ COLD', { coach: coach.id, chars: text.length, preview: text.slice(0, 60) });
      if (text) this.emit({ path: 'cold', text });
    } catch (err) {
      console.error('Cold path failed:', err);
    }
  }

  // ── FEEDFORWARD: geofence-based corner advice ──────────

  private runFeedforward(frame: TelemetryFrame) {
    const track = THUNDERHILL_EAST;
    const nearest = this.findNearestCorner(frame.latitude, frame.longitude, track.corners);

    if (nearest && nearest !== this.lastCorner) {
      this.lastCorner = nearest;
      this.emit({
        path: 'feedforward',
        text: `📍 ${nearest.name}: ${nearest.advice}`,
      });
    }
  }

  private findNearestCorner(lat: number, lon: number, corners: Corner[]): Corner | null {
    for (const c of corners) {
      const dist = this.haversine(lat, lon, c.lat, c.lon);
      if (dist < 150) return c;
    }
    return null;
  }

  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
      * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

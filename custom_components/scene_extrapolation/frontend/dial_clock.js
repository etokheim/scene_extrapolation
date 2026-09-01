/* Dial / sun-path geometry and light-sample morph helpers.
   CLOCK_* layout constants stay in panel.js — these free functions do not use them. */

import { formatClockHm } from "./editor_session.js";

const SECONDS_PER_DAY = 24 * 3600;

function sunStrokePaths(curve, xOf, yOf, { point: pointFn } = {}) {
  const paths = [];
  if (curve.length < 2) {
    return paths;
  }
  const point =
    pointFn ||
    ((seconds, elevation) =>
      `${xOf(seconds).toFixed(1)},${yOf(elevation).toFixed(1)}`);
  let night = curve[0][1] < 0;
  let current = [point(curve[0][0], curve[0][1])];
  const flush = () => {
    if (current.length >= 2) {
      paths.push({
        night,
        d: current.map((xy, index) => `${index === 0 ? "M" : "L"}${xy}`).join(" "),
      });
    }
    current = [];
  };
  for (let index = 1; index < curve.length; index += 1) {
    const [leftSeconds, leftElev] = curve[index - 1];
    const [rightSeconds, rightElev] = curve[index];
    const rightNight = rightElev < 0;
    if (rightNight === night) {
      current.push(point(rightSeconds, rightElev));
      continue;
    }
    const span = rightElev - leftElev;
    const ratio = (0 - leftElev) / span;
    const crossSeconds = leftSeconds + (rightSeconds - leftSeconds) * ratio;
    current.push(point(crossSeconds, 0));
    flush();
    night = rightNight;
    current.push(point(crossSeconds, 0), point(rightSeconds, rightElev));
  }
  flush();
  return paths;
}

/** Line segments along the sun curve, split at horizon crossings. */
function sunStrokeSegments(curve) {
  const segments = [];
  if (curve.length < 2) {
    return segments;
  }
  let night = curve[0][1] < 0;
  for (let index = 1; index < curve.length; index += 1) {
    const [leftSeconds, leftElev] = curve[index - 1];
    const [rightSeconds, rightElev] = curve[index];
    const rightNight = rightElev < 0;
    if (rightNight === night) {
      segments.push({
        s0: leftSeconds,
        e0: leftElev,
        s1: rightSeconds,
        e1: rightElev,
        night,
      });
      continue;
    }
    const span = rightElev - leftElev;
    const ratio = (0 - leftElev) / span;
    const crossSeconds = leftSeconds + (rightSeconds - leftSeconds) * ratio;
    segments.push({
      s0: leftSeconds,
      e0: leftElev,
      s1: crossSeconds,
      e1: 0,
      night,
    });
    night = rightNight;
    segments.push({
      s0: crossSeconds,
      e0: 0,
      s1: rightSeconds,
      e1: rightElev,
      night,
    });
  }
  return segments;
}

/**
 * Coalesce horizon-split segments into continuous path runs so round dashed
 * strokes do not stack overlapping caps (the “double path” look).
 * Splits when night/day flips or stroke width drifts by more than ~1.25px.
 */
function sunStrokePathRuns(curve, strokeOf) {
  const runs = [];
  for (const segment of sunStrokeSegments(curve)) {
    const midElev = (segment.e0 + segment.e1) / 2;
    const width = strokeOf(midElev);
    const last = runs[runs.length - 1];
    if (
      last &&
      last.night === segment.night &&
      Math.abs(last.width - width) < 1.25
    ) {
      last.points.push([segment.s1, segment.e1]);
      last.widthSum += width;
      last.elevSum += midElev;
      last.count += 1;
      last.width = last.widthSum / last.count;
      last.midElev = last.elevSum / last.count;
      continue;
    }
    runs.push({
      night: segment.night,
      width,
      widthSum: width,
      elevSum: midElev,
      midElev,
      count: 1,
      points: [
        [segment.s0, segment.e0],
        [segment.s1, segment.e1],
      ],
    });
  }
  return runs;
}

function interpolateElevation(curve, seconds) {
  if (!curve.length) {
    return 0;
  }
  if (seconds <= curve[0][0]) {
    return curve[0][1];
  }
  for (let index = 1; index < curve.length; index += 1) {
    const [rightSeconds, rightElev] = curve[index];
    if (seconds <= rightSeconds) {
      const [leftSeconds, leftElev] = curve[index - 1];
      const span = rightSeconds - leftSeconds || 1;
      const ratio = (seconds - leftSeconds) / span;
      return leftElev + (rightElev - leftElev) * ratio;
    }
  }
  return curve[curve.length - 1][1];
}

/** Sky glow + sun flare palette from solar elevation (degrees).
 *  Aligned with Apple Solar-style faces: day = sky blue / periwinkle;
 *  horizon = narrow muted peach (never hot pink); night = deep navy. */
function skyLookFromElevation(elev) {
  const keys = [
    {
      e: -90,
      outer: [4, 6, 14],
      mid: [8, 10, 22],
      glowOpacity: 0.16,
      sunCore: "#c5d0e8",
      sunCorona: "#6a7a9a",
      sunStreak: "#9aa8c4",
      streakOpacity: 0.12,
      rayOpacity: 0.08,
      ghostOpacity: 0.1,
    },
    {
      e: -18,
      outer: [12, 18, 42],
      mid: [18, 26, 58],
      glowOpacity: 0.22,
      sunCore: "#d0daf0",
      sunCorona: "#7a8ab0",
      sunStreak: "#a8b6d4",
      streakOpacity: 0.18,
      rayOpacity: 0.12,
      ghostOpacity: 0.14,
    },
    {
      e: -12,
      outer: [28, 48, 108],
      mid: [48, 72, 140],
      glowOpacity: 0.42,
      sunCore: "#e4ecff",
      sunCorona: "#7a94c8",
      sunStreak: "#b0c4ff",
      streakOpacity: 0.3,
      rayOpacity: 0.18,
      ghostOpacity: 0.2,
    },
    {
      // Civil twilight — cool periwinkle, only a hint of warmth.
      e: -4,
      outer: [88, 108, 168],
      mid: [140, 148, 188],
      glowOpacity: 0.55,
      sunCore: "#f0eef8",
      sunCorona: "#c8b8d8",
      sunStreak: "#ddd0e8",
      streakOpacity: 0.45,
      rayOpacity: 0.28,
      ghostOpacity: 0.28,
    },
    {
      // Horizon — muted peach / apricot band, not saturated pink-red.
      e: 0,
      outer: [150, 138, 178],
      mid: [220, 186, 168],
      glowOpacity: 0.62,
      sunCore: "#fff4ea",
      sunCorona: "#e8c4a8",
      sunStreak: "#f0d8c4",
      streakOpacity: 0.55,
      rayOpacity: 0.35,
      ghostOpacity: 0.32,
    },
    {
      // Just above — soft peach into clear day sky.
      e: 4,
      outer: [100, 165, 230],
      mid: [210, 200, 205],
      glowOpacity: 0.58,
      sunCore: "#fff8f2",
      sunCorona: "#e8d0b8",
      sunStreak: "#f2e4d4",
      streakOpacity: 0.5,
      rayOpacity: 0.32,
      ghostOpacity: 0.28,
    },
    {
      e: 8,
      // Climb into clear Apple Solar–style day sky (#4FB3FF family).
      outer: [79, 179, 255],
      mid: [168, 214, 250],
      glowOpacity: 0.55,
      sunCore: "#f7fbff",
      sunCorona: "#d8e6f8",
      sunStreak: "#e8f0fa",
      streakOpacity: 0.55,
      rayOpacity: 0.35,
      ghostOpacity: 0.26,
    },
    {
      e: 25,
      outer: [70, 172, 252],
      mid: [175, 220, 252],
      glowOpacity: 0.5,
      sunCore: "#ffffff",
      sunCorona: "#e8f2ff",
      sunStreak: "#f0f6ff",
      streakOpacity: 0.6,
      rayOpacity: 0.4,
      ghostOpacity: 0.24,
    },
    {
      e: 90,
      outer: [64, 165, 250],
      mid: [185, 225, 255],
      glowOpacity: 0.48,
      sunCore: "#ffffff",
      sunCorona: "#e4efff",
      sunStreak: "#f2f7ff",
      streakOpacity: 0.62,
      rayOpacity: 0.42,
      ghostOpacity: 0.26,
    },
  ];
  let lo = keys[0];
  let hi = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (elev >= keys[i].e && elev <= keys[i + 1].e) {
      lo = keys[i];
      hi = keys[i + 1];
      break;
    }
    if (elev < keys[0].e) {
      lo = keys[0];
      hi = keys[0];
      break;
    }
  }
  if (elev > keys[keys.length - 1].e) {
    lo = hi = keys[keys.length - 1];
  }
  const span = hi.e - lo.e || 1;
  const t = lo === hi ? 0 : (elev - lo.e) / span;
  const mixRgb = (a, b) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  const lerp = (a, b) => a + (b - a) * t;
  const outer = mixRgb(lo.outer, hi.outer);
  const mid = mixRgb(lo.mid, hi.mid);
  const rgb = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mixHex = (a, b) => {
    const parse = (h) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const m = mixRgb(parse(a), parse(b));
    return `#${m.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    glowBackground: `radial-gradient(closest-side circle at center, ${rgb(mid, 1)} 0%, ${rgb(mid, 0.85)} 28%, ${rgb(outer, 0.55)} 58%, ${rgb(outer, 0)} 100%)`,
    /* Annular halo: center stays clear (under opaque rings); bright rim peeks
       past the planet when the glow element is scaled up (no blur needed). */
    glowHaloBackground: `radial-gradient(closest-side circle at center, transparent 0%, transparent 52%, ${rgb(mid, 0.55)} 64%, ${rgb(mid, 0.95)} 74%, ${rgb(outer, 0.75)} 86%, transparent 100%)`,
    glowOpacity: lerp(lo.glowOpacity, hi.glowOpacity),
    sunCore: mixHex(lo.sunCore, hi.sunCore),
    sunCorona: mixHex(lo.sunCorona, hi.sunCorona),
    sunStreak: mixHex(lo.sunStreak, hi.sunStreak),
    pathColor: `rgb(${mid[0]},${mid[1]},${mid[2]})`,
    horizonFill: `rgb(${mid[0]},${mid[1]},${mid[2]})`,
    /* Outer keyframe is the sky tone (blue by day); mid is for sun flare / horizon. */
    skyColor: `rgb(${outer[0]},${outer[1]},${outer[2]})`,
    skyLight: rgb(
      [
        Math.round(outer[0] + (220 - outer[0]) * 0.35),
        Math.round(outer[1] + (235 - outer[1]) * 0.4),
        Math.round(outer[2] + (255 - outer[2]) * 0.25),
      ],
      1
    ),
    streakOpacity: lerp(lo.streakOpacity, hi.streakOpacity),
    rayOpacity: lerp(lo.rayOpacity, hi.rayOpacity),
    ghostOpacity: lerp(lo.ghostOpacity, hi.ghostOpacity),
  };
}

function darkenedRgb(sample) {
  const t = sample[1] / 100;
  return `rgb(${Math.round(sample[2] * t)},${Math.round(sample[3] * t)},${Math.round(sample[4] * t)})`;
}

function conicGradientFromSamples(samples) {
  if (!samples.length) {
    return "var(--divider-color)";
  }
  const stops = samples.map((sample) => {
    const offset = (sample[0] / SECONDS_PER_DAY) * 100;
    return `${darkenedRgb(sample)} ${offset.toFixed(2)}%`;
  });
  // Close dusk→dawn at midnight so the ring has no seam gap.
  stops.push(`${darkenedRgb(samples[0])} 100%`);
  // from 180deg: midnight (0%) at bottom, noon at top — matches _clockAngleDeg.
  return `conic-gradient(from 180deg, ${stops.join(", ")})`;
}

function interpolateLightSample(samples, seconds) {
  if (!samples.length) {
    return { brightness: 0, rgb: [0, 0, 0] };
  }
  const at = (row) => ({
    brightness: row[1],
    rgb: [row[2], row[3], row[4]],
  });
  if (seconds <= samples[0][0]) {
    return at(samples[0]);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const right = samples[index];
    if (seconds <= right[0]) {
      const left = samples[index - 1];
      const span = right[0] - left[0] || 1;
      const ratio = (seconds - left[0]) / span;
      return {
        brightness: left[1] + (right[1] - left[1]) * ratio,
        rgb: [
          Math.round(left[2] + (right[2] - left[2]) * ratio),
          Math.round(left[3] + (right[3] - left[3]) * ratio),
          Math.round(left[4] + (right[4] - left[4]) * ratio),
        ],
      };
    }
  }
  return at(samples[samples.length - 1]);
}

function easeOutCubic(u) {
  return 1 - (1 - u) ** 3;
}

function lerpSampleSeries(from, to, t) {
  if (!to?.length) {
    return from || [];
  }
  if (!from?.length) {
    return to;
  }
  return to.map((row) => {
    const seconds = row[0];
    const a = interpolateLightSample(from, seconds);
    const b = interpolateLightSample(to, seconds);
    return [
      seconds,
      a.brightness + (b.brightness - a.brightness) * t,
      Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
      Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
      Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
    ];
  });
}

function lerpCurve(from, to, t) {
  if (!to?.length) {
    return from || [];
  }
  if (!from?.length) {
    return to;
  }
  return to.map((row) => {
    const seconds = row[0];
    const a = interpolateElevation(from, seconds);
    const b = interpolateElevation(to, seconds);
    return [seconds, a + (b - a) * t];
  });
}

function lerpSunPath(from, to, t) {
  const events = (to.events || []).map((event) => {
    const prev = (from.events || []).find((item) => item.id === event.id) || event;
    const fromBtn = prev.seconds;
    const toBtn = event.seconds;
    const fromSolar = prev.solar_seconds ?? prev.seconds;
    const toSolar = event.solar_seconds ?? event.seconds;
    const seconds = fromBtn + (toBtn - fromBtn) * t;
    const solarSeconds = fromSolar + (toSolar - fromSolar) * t;
    // Ghost while button and solar differ (covers clamp appearing/disappearing).
    const overridden = Math.abs(seconds - solarSeconds) > 30;
    return {
      ...event,
      seconds,
      time: formatClockHm(seconds),
      elevation:
        (prev.elevation ?? event.elevation) +
        ((event.elevation ?? 0) - (prev.elevation ?? 0)) * t,
      overridden,
      solar_seconds: overridden ? solarSeconds : null,
      solar_time: overridden ? formatClockHm(solarSeconds) : undefined,
    };
  });
  const lights = (to.lights || []).map((light) => {
    const prev = (from.lights || []).find(
      (item) => item.entity_id === light.entity_id
    );
    if (!prev?.samples?.length || !light.samples?.length) {
      return light;
    }
    return { ...light, samples: lerpSampleSeries(prev.samples, light.samples, t) };
  });
  return {
    ...to,
    curve: lerpCurve(from.curve, to.curve, t),
    events,
    lights,
  };
}

export {
  sunStrokePaths,
  sunStrokeSegments,
  sunStrokePathRuns,
  interpolateElevation,
  skyLookFromElevation,
  darkenedRgb,
  conicGradientFromSamples,
  interpolateLightSample,
  easeOutCubic,
  lerpSampleSeries,
  lerpCurve,
  lerpSunPath,
};

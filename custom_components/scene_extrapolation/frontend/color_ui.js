/* Color wheel, draft RGB/HS/temp helpers, and Helland kelvin→RGB.
   Extracted from panel.js (no bundler; HA loads as ES modules). */

const HUE_WHEEL_RENDER = 600;
const HUE_COLOR_PRESETS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#5ac8fa",
  "#007aff",
  "#5856d6",
  "#af52de",
];
const HUE_TEMP_PRESETS = [2200, 2700, 3000, 4000, 5000, 6500];
const HUE_PIN_PATH =
  "M 24,0 C 10.745166,0 0,10.575951 0,23.622046 0,39.566928 21,57.578739 22.05,58.346457 L 24,60 25.95,58.346457 C 27,57.578739 48,39.566928 48,23.622046 48,10.575951 37.254834,0 24,0 Z";
const HUE_DOT_PATH = "M6 0A6 6 0 006 12 6 6 0 006 0Z";
const HUE_DOT_OUTLINE_PATH = "M8 0A8 8 0 008 16 8 8 0 008 0Z";
const HUE_PATH_STEPS = 24;
const _hueWheelImageCache = new Map();

function hueLinearScale(t, min, max) {
  return (max - min) * t + min;
}

function hueCurveScale(t, min, max) {
  let addon = 0;
  const coef = max / min / 65;
  if (t <= 0.1) {
    addon = hueLinearScale(t * 10, 0, coef);
  } else if (t <= 0.97) {
    addon = coef - hueLinearScale((t - 0.1) / 0.9, 0, 2 * coef);
  } else {
    addon = -coef + hueLinearScale((t - 0.97) / 0.03, 0, coef);
  }
  return (Math.pow(max / min, Math.pow(t, 1.55)) + addon) * min;
}

function inverseHueCurveScale(targetValue, min, max) {
  const epsilon = 0.0001;
  let low = 0;
  let high = 1;
  let t = 0.5;
  while (high - low > epsilon) {
    const midValue = hueCurveScale(t, min, max);
    if (midValue < targetValue) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return t;
}

function xy2polar(x, y) {
  return [Math.sqrt(x * x + y * y), Math.atan2(y, x)];
}

function polar2xy(r, phi) {
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

function rad2deg(rad) {
  return ((rad + Math.PI) / (2 * Math.PI)) * 360;
}

function deg2rad(deg) {
  return (deg / 360) * 2 * Math.PI - Math.PI;
}

function hueFromDeg(deg) {
  deg -= 70;
  if (deg < 0) {
    deg += 360;
  }
  return deg;
}

function degFromHue(hue) {
  hue += 70;
  if (hue > 360) {
    hue -= 360;
  }
  return hue;
}

function saturationFromR(r, radius) {
  const exp = 1.9;
  const saturation = Math.pow(r, exp) / Math.pow(radius, exp);
  return saturation > 1 ? 1 : saturation;
}

function rFromSaturation(saturation, radius) {
  const exp = 1.9;
  return Math.pow(saturation * Math.pow(radius, exp), 1 / exp);
}

function fixHSValue(value, r, radius, hue, fixPoint, lower, maxOffset = 5) {
  const precondition = lower
    ? r > radius / 2
    : r < (3 * radius) / 4 && r > radius / 4;
  if (
    precondition &&
    hue >= fixPoint - maxOffset &&
    hue <= fixPoint + maxOffset
  ) {
    let offset = fixPoint - hue;
    if (offset < 0) {
      offset = -offset;
    }
    offset = maxOffset - offset;
    value += lower ? -offset / 360 : offset / 360;
  }
  return value;
}

function hsValue(hue, r, radius) {
  let value = 0.95;
  value = fixHSValue(value, r, radius, hue, 60, true);
  value = fixHSValue(value, r, radius, hue, 180, true);
  value = fixHSValue(value, r, radius, hue, 240, false);
  value = fixHSValue(value, r, radius, hue, 300, true);
  return value > 1 ? 1 : value;
}

function hsv2rgb(hue, saturation, value) {
  const chroma = value * saturation;
  const hue1 = hue / 60;
  const x = chroma * (1 - Math.abs((hue1 % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hue1 >= 0 && hue1 <= 1) {
    [r1, g1, b1] = [chroma, x, 0];
  } else if (hue1 >= 1 && hue1 <= 2) {
    [r1, g1, b1] = [x, chroma, 0];
  } else if (hue1 >= 2 && hue1 <= 3) {
    [r1, g1, b1] = [0, chroma, x];
  } else if (hue1 >= 3 && hue1 <= 4) {
    [r1, g1, b1] = [0, x, chroma];
  } else if (hue1 >= 4 && hue1 <= 5) {
    [r1, g1, b1] = [x, 0, chroma];
  } else if (hue1 >= 5 && hue1 <= 6) {
    [r1, g1, b1] = [chroma, 0, x];
  }
  const m = value - chroma;
  return [
    Math.round(255 * (r1 + m)),
    Math.round(255 * (g1 + m)),
    Math.round(255 * (b1 + m)),
  ];
}

function rgb2hsv(r, g, b) {
  const rabs = r / 255;
  const gabs = g / 255;
  const babs = b / 255;
  const v = Math.max(rabs, gabs, babs);
  const diff = v - Math.min(rabs, gabs, babs);
  const diffc = (c) => (v - c) / 6 / diff + 1 / 2;
  let h = 0;
  let s = 0;
  if (diff !== 0) {
    s = diff / v;
    const rr = diffc(rabs);
    const gg = diffc(gabs);
    const bb = diffc(babs);
    if (rabs === v) {
      h = bb - gg;
    } else if (gabs === v) {
      h = 1 / 3 + rr - bb;
    } else {
      h = 2 / 3 + gg - rr;
    }
    if (h < 0) {
      h += 1;
    } else if (h > 1) {
      h -= 1;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100) / 100, Math.round(v * 100) / 100];
}

function hueTempToRgb(kelvin) {
  const start = 2000;
  const tres = 4200;
  const end = 6500;
  const startRgb = [255, 180, 55];
  const tresRgb = [255, 255, 255];
  const endRgb = [190, 228, 243];
  let k = kelvin;
  if (k < start) {
    k = start;
  }
  if (k > end) {
    k = end;
  }
  if (k < tres) {
    const t = (k - start) / (tres - start);
    return [
      Math.round(hueLinearScale(t, startRgb[0], tresRgb[0])),
      Math.round(hueLinearScale(t, startRgb[1], tresRgb[1])),
      Math.round(hueLinearScale(t, startRgb[2], tresRgb[2])),
    ];
  }
  const t = (k - tres) / (end - tres);
  return [
    Math.round(hueLinearScale(t, tresRgb[0], endRgb[0])),
    Math.round(hueLinearScale(t, tresRgb[1], endRgb[1])),
    Math.round(hueLinearScale(t, tresRgb[2], endRgb[2])),
  ];
}

/** Tanner Helland daylight curve — same as color_math.kelvin_to_rgb. */
function kelvinToRgb(kelvin) {
  const temp = Math.max(1000, Math.min(Number(kelvin) || 0, 40000)) / 100;
  let red;
  let green;
  let blue;
  if (temp <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    red = 329.698727446 * (temp - 60) ** -0.1332047592;
    green = 288.1221695283 * (temp - 60) ** -0.0755148492;
  }
  if (temp >= 66) {
    blue = 255;
  } else if (temp <= 19) {
    blue = 0;
  } else {
    blue = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  }
  return [
    Math.max(0, Math.min(255, Math.round(red))),
    Math.max(0, Math.min(255, Math.round(green))),
    Math.max(0, Math.min(255, Math.round(blue))),
  ];
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function pinForeground(rgb) {
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 192 ? "rgba(0,0,0,0.7)" : "#fff";
}

function draftWheelMode(draft, hasColor, hasTemp) {
  if (
    draft?.rgb_color ||
    draft?.hs_color ||
    draft?.rgbw_color ||
    draft?.rgbww_color
  ) {
    return hasColor ? "color" : "temp";
  }
  if (draft?.color_temp_kelvin != null) {
    return hasTemp ? "temp" : "color";
  }
  return hasColor ? "color" : "temp";
}

function rgbwToRgb(rgbw) {
  const r = Number(rgbw[0]) || 0;
  const g = Number(rgbw[1]) || 0;
  const b = Number(rgbw[2]) || 0;
  const white = Number(rgbw[3]) || 0;
  return [
    Math.round(Math.max(0, Math.min(255, r + white))),
    Math.round(Math.max(0, Math.min(255, g + white))),
    Math.round(Math.max(0, Math.min(255, b + white))),
  ];
}

function rgbwwToRgb(rgbww) {
  const r = Number(rgbww[0]) || 0;
  const g = Number(rgbww[1]) || 0;
  const b = Number(rgbww[2]) || 0;
  const cold = Number(rgbww[3]) || 0;
  const warm = Number(rgbww[4]) || 0;
  return [
    Math.round(Math.max(0, Math.min(255, r + cold * 0.86 + warm))),
    Math.round(Math.max(0, Math.min(255, g + cold * 0.9 + warm * 0.7))),
    Math.round(Math.max(0, Math.min(255, b + cold + warm * 0.35))),
  ];
}

function scaleRgbChannels(rgb, brightness) {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (max <= 0) {
    return [brightness, brightness, brightness];
  }
  const t = brightness / max;
  return [
    Math.round(rgb[0] * t),
    Math.round(rgb[1] * t),
    Math.round(rgb[2] * t),
  ];
}

function chromaticRgbFromDraft(draft) {
  let rgb;
  if (draft?.rgbww_color) {
    rgb = draft.rgbww_color.slice(0, 3);
  } else if (draft?.rgbw_color) {
    rgb = draft.rgbw_color.slice(0, 3);
  } else if (draft?.rgb_color) {
    rgb = draft.rgb_color;
  } else if (draft?.hs_color) {
    return hsv2rgb(draft.hs_color[0], draft.hs_color[1] / 100, 1);
  } else {
    return null;
  }
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (max <= 0) {
    return [0, 0, 0];
  }
  return [
    Math.round((rgb[0] * 255) / max),
    Math.round((rgb[1] * 255) / max),
    Math.round((rgb[2] * 255) / max),
  ];
}

function colorBrightnessFromDraft(draft) {
  if (draft?.state === "off") {
    return 0;
  }
  if (draft?.rgbww_color) {
    return Math.max(draft.rgbww_color[0], draft.rgbww_color[1], draft.rgbww_color[2]);
  }
  if (draft?.rgbw_color) {
    return Math.max(draft.rgbw_color[0], draft.rgbw_color[1], draft.rgbw_color[2]);
  }
  if (draft?.rgb_color) {
    return Math.max(draft.rgb_color[0], draft.rgb_color[1], draft.rgb_color[2]);
  }
  if (draft?.hs_color) {
    return 255;
  }
  return 0;
}

function whiteBrightnessFromDraft(draft) {
  if (draft?.state === "off") {
    return 0;
  }
  if (draft?.rgbww_color) {
    return Math.max(draft.rgbww_color[3], draft.rgbww_color[4]);
  }
  if (draft?.rgbw_color) {
    return draft.rgbw_color[3] || 0;
  }
  return 0;
}

function setColorBrightnessOnDraft(draft, brightness, whiteKind) {
  const value = Math.round(Math.max(0, Math.min(255, brightness)));
  if (whiteKind === "rgbww") {
    const current = draft.rgbww_color || [
      ...(chromaticRgbFromDraft(draft) || draftRgb(draft)),
      0,
      0,
    ];
    const rgb = scaleRgbChannels(current.slice(0, 3), value);
    draft.rgbww_color = [rgb[0], rgb[1], rgb[2], current[3] || 0, current[4] || 0];
    draft.rgb_color = undefined;
    draft.rgbw_color = undefined;
    draft.hs_color = undefined;
    draft.color_temp_kelvin = undefined;
  } else if (whiteKind === "rgbw") {
    const current = draft.rgbw_color || [
      ...(chromaticRgbFromDraft(draft) || draftRgb(draft)),
      0,
    ];
    const rgb = scaleRgbChannels(current.slice(0, 3), value);
    draft.rgbw_color = [rgb[0], rgb[1], rgb[2], current[3] || 0];
    draft.rgb_color = undefined;
    draft.rgbww_color = undefined;
    draft.hs_color = undefined;
    draft.color_temp_kelvin = undefined;
  }
  if (value > 0 || whiteBrightnessFromDraft(draft) > 0) {
    draft.state = "on";
  }
}

function setWhiteBrightnessOnDraft(draft, brightness, whiteKind) {
  const value = Math.round(Math.max(0, Math.min(255, brightness)));
  if (whiteKind === "rgbww") {
    const current = draft.rgbww_color || [0, 0, 0, 0, 0];
    const max = Math.max(current[3] || 0, current[4] || 0);
    let cw;
    let ww;
    if (max <= 0) {
      cw = value;
      ww = value;
    } else {
      cw = Math.round(((current[3] || 0) * value) / max);
      ww = Math.round(((current[4] || 0) * value) / max);
    }
    draft.rgbww_color = [current[0], current[1], current[2], cw, ww];
    draft.rgb_color = undefined;
    draft.rgbw_color = undefined;
    draft.hs_color = undefined;
    draft.color_temp_kelvin = undefined;
  } else if (whiteKind === "rgbw") {
    const current = draft.rgbw_color || [0, 0, 0, 0];
    draft.rgbw_color = [current[0], current[1], current[2], value];
    draft.rgb_color = undefined;
    draft.rgbww_color = undefined;
    draft.hs_color = undefined;
    draft.color_temp_kelvin = undefined;
  }
  if (value > 0 || colorBrightnessFromDraft(draft) > 0) {
    draft.state = "on";
  }
}

function draftRgb(draft) {
  if (draft?.rgbww_color) {
    return rgbwwToRgb(draft.rgbww_color);
  }
  if (draft?.rgbw_color) {
    return rgbwToRgb(draft.rgbw_color);
  }
  if (draft?.rgb_color) {
    return draft.rgb_color;
  }
  if (draft?.hs_color) {
    return hsv2rgb(draft.hs_color[0], draft.hs_color[1] / 100, 1);
  }
  if (draft?.color_temp_kelvin != null) {
    // Match Python kelvin_to_rgb (Helland) so scrub/morph rings match Astral.
    // hueTempToRgb stays for the temp wheel chrome only.
    return kelvinToRgb(draft.color_temp_kelvin);
  }
  return [255, 214, 170];
}

function applyColorToDraft(draft, rgb, hsv) {
  draft.hs_color = [hsv[0], Math.round(hsv[1] * 100)];
  draft.color_temp_kelvin = undefined;
  draft.state = "on";
  if (draft.rgbww_color) {
    const colorBri =
      Math.max(draft.rgbww_color[0], draft.rgbww_color[1], draft.rgbww_color[2]) ||
      255;
    const scaled = scaleRgbChannels(rgb, colorBri);
    draft.rgbww_color = [
      scaled[0],
      scaled[1],
      scaled[2],
      draft.rgbww_color[3],
      draft.rgbww_color[4],
    ];
    draft.rgb_color = undefined;
    draft.rgbw_color = undefined;
    return;
  }
  if (draft.rgbw_color) {
    const colorBri =
      Math.max(draft.rgbw_color[0], draft.rgbw_color[1], draft.rgbw_color[2]) ||
      255;
    const scaled = scaleRgbChannels(rgb, colorBri);
    draft.rgbw_color = [scaled[0], scaled[1], scaled[2], draft.rgbw_color[3]];
    draft.rgb_color = undefined;
    draft.rgbww_color = undefined;
    return;
  }
  draft.rgb_color = rgb;
  draft.rgbw_color = undefined;
  draft.rgbww_color = undefined;
}

function applyTempToDraft(draft, kelvin) {
  draft.color_temp_kelvin = kelvin;
  draft.rgb_color = undefined;
  draft.hs_color = undefined;
  draft.rgbw_color = undefined;
  draft.rgbww_color = undefined;
  draft.state = "on";
}

function inferDraftColorKind(draft) {
  if (draft?.rgbww_color) {
    return "rgbww";
  }
  if (draft?.rgbw_color) {
    return "rgbw";
  }
  if (draft?.rgb_color) {
    return "rgb";
  }
  if (draft?.hs_color) {
    return "hs";
  }
  if (draft?.color_temp_kelvin != null) {
    return "temp";
  }
  return null;
}

function collapseSceneCycle(sequence) {
  const ids = [];
  for (const id of sequence || []) {
    if (!id) {
      continue;
    }
    if (!ids.length || ids[ids.length - 1] !== id) {
      ids.push(id);
    }
  }
  if (ids.length > 1 && ids[0] === ids[ids.length - 1]) {
    ids.pop();
  }
  return ids;
}

function lerpNumber(from, to, t) {
  return from + (to - from) * t;
}

function interpolateDraftSample(fromDraft, toDraft, t) {
  const fromKind = inferDraftColorKind(fromDraft);
  const toKind = inferDraftColorKind(toDraft);
  // Same kind: channel-native lerp. Different kinds: RGB-lerp endpoints so the
  // wheel path / preview does not snap at the old 50% mode switch.
  if (fromKind && toKind && fromKind === toKind) {
    if (fromKind === "temp") {
      const fromK = fromDraft?.color_temp_kelvin;
      const toK = toDraft?.color_temp_kelvin;
      const start = fromK != null ? fromK : toK;
      const end = toK != null ? toK : fromK;
      if (start == null || end == null) {
        return { rgb: draftRgb(t < 0.5 ? fromDraft : toDraft) };
      }
      const kelvin = lerpNumber(start, end, t);
      return { kelvin, rgb: hueTempToRgb(kelvin) };
    }
    if (fromKind === "hs") {
      const start = fromDraft?.hs_color || toDraft?.hs_color;
      const end = toDraft?.hs_color || fromDraft?.hs_color;
      if (!start || !end) {
        return { rgb: draftRgb(t < 0.5 ? fromDraft : toDraft) };
      }
      const hs = [lerpNumber(start[0], end[0], t), lerpNumber(start[1], end[1], t)];
      return { hs, rgb: hsv2rgb(hs[0], hs[1] / 100, 1) };
    }
    if (fromKind === "rgbw" && fromDraft?.rgbw_color && toDraft?.rgbw_color) {
      const rgbw = fromDraft.rgbw_color.map((value, index) =>
        lerpNumber(value, toDraft.rgbw_color[index], t)
      );
      return { rgb: rgbwToRgb(rgbw) };
    }
    if (fromKind === "rgbww" && fromDraft?.rgbww_color && toDraft?.rgbww_color) {
      const rgbww = fromDraft.rgbww_color.map((value, index) =>
        lerpNumber(value, toDraft.rgbww_color[index], t)
      );
      return { rgb: rgbwwToRgb(rgbww) };
    }
  }
  const start = draftRgb(fromDraft);
  const end = draftRgb(toDraft);
  return {
    rgb: [
      lerpNumber(start[0], end[0], t),
      lerpNumber(start[1], end[1], t),
      lerpNumber(start[2], end[2], t),
    ],
  };
}

function colorWheelXY(hue, saturation, radius) {
  const phi = deg2rad(degFromHue(hue));
  const r = rFromSaturation(saturation, radius);
  const [x, y] = polar2xy(r, phi);
  return { x, y };
}

function wheelPointForSample(sample, wheelMode, radius, tempMin, tempMax) {
  if (wheelMode === "temp") {
    if (sample.kelvin == null) {
      return null;
    }
    const coords = coordinatesForTemp(sample.kelvin, radius, tempMin, tempMax);
    return { x: coords.x + radius, y: coords.y + radius, rgb: sample.rgb };
  }
  let hue;
  let saturation;
  if (sample.hs) {
    hue = sample.hs[0];
    saturation = sample.hs[1] / 100;
  } else {
    const hsv = rgb2hsv(sample.rgb[0], sample.rgb[1], sample.rgb[2]);
    hue = hsv[0];
    saturation = hsv[1];
  }
  const coords = colorWheelXY(hue, saturation, radius);
  return { x: coords.x + radius, y: coords.y + radius, rgb: sample.rgb };
}

function hueColorAt(x, y, radius) {
  const [r, phi] = xy2polar(x, y);
  if (r - 2 > radius) {
    return null;
  }
  const hue = hueFromDeg(rad2deg(phi));
  const saturation = saturationFromR(r, radius);
  const value = hsValue(hue, r, radius);
  return { rgb: hsv2rgb(hue, saturation, value), hsv: [hue, saturation, value] };
}

function hueTempAt(x, y, radius, tempMin, tempMax) {
  const [r] = xy2polar(x, y);
  if (r - 2 > radius) {
    return null;
  }
  const rowLength = 2 * radius;
  const n = (y + radius) / rowLength;
  const kelvin = Math.round(hueCurveScale(n, tempMin, tempMax));
  return { rgb: hueTempToRgb(kelvin), kelvin };
}

function coordinatesForColor(hue, saturation, radius) {
  const phi = deg2rad(degFromHue(hue));
  const r = rFromSaturation(saturation, radius);
  const [x, y] = polar2xy(r, phi);
  return { x: Math.round(x), y: Math.round(y) };
}

function coordinatesForTemp(kelvin, radius, tempMin, tempMax) {
  let k = kelvin;
  if (k < tempMin) {
    k = tempMin;
  } else if (k > tempMax) {
    k = tempMax;
  }
  const n = inverseHueCurveScale(k, tempMin, tempMax);
  const y = Math.round(n * 2 * radius - radius);
  const maxX = Math.ceil(Math.sqrt(Math.max(0, radius * radius - y * y)));
  return { x: 0, y, maxX };
}

function limitToWheel(x, y, radius) {
  const dx = x - radius;
  const dy = y - radius;
  const dist = Math.hypot(dx, dy);
  if (dist <= radius || dist === 0) {
    return { x, y };
  }
  const scale = radius / dist;
  return { x: radius + dx * scale, y: radius + dy * scale };
}

function drawHueWheelImage(mode, tempMin, tempMax) {
  const key =
    mode === "temp"
      ? `temp:${HUE_WHEEL_RENDER}:${tempMin}:${tempMax}`
      : `color:${HUE_WHEEL_RENDER}`;
  const cached = _hueWheelImageCache.get(key);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = HUE_WHEEL_RENDER;
  canvas.height = HUE_WHEEL_RENDER;
  const ctx = canvas.getContext("2d");
  const radius = HUE_WHEEL_RENDER / 2;
  const image = ctx.createImageData(HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
  const data = image.data;
  for (let x = -radius; x < radius; x++) {
    for (let y = -radius; y < radius; y++) {
      const sample =
        mode === "color"
          ? hueColorAt(x, y, radius)
          : hueTempAt(x, y, radius, tempMin, tempMax);
      if (!sample) {
        continue;
      }
      const adjustedX = x + radius;
      const adjustedY = y + radius;
      const index = (adjustedX + adjustedY * HUE_WHEEL_RENDER) * 4;
      data[index] = sample.rgb[0];
      data[index + 1] = sample.rgb[1];
      data[index + 2] = sample.rgb[2];
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  _hueWheelImageCache.set(key, url);
  return url;
}

function createLightBrightnessGraph({
  title: headingText = "Brightness",
  subtitle = "0–100% by solar event",
  getPoints,
  onSelect,
  onAdd,
  onBrightness,
  onDragEnd,
}) {
  // Full-bleed plot — 0/100% live in the heading subtext, not axis labels.
  // Height stays fixed in CSS (120px); viewBox width tracks the element so
  // circles stay round when the sidebar grows (no aspect-ratio lock).
  const HEIGHT = 120;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 14;
  const PAD_B = 22;
  const PLOT_H = HEIGHT - PAD_T - PAD_B;
  let plotW = 300 - PAD_L - PAD_R;
  let viewW = 300;

  const el = document.createElement("div");
  el.className = "light-brightness-graph";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Brightness by solar event, 0 to 100 percent");

  const heading = document.createElement("div");
  heading.className = "light-brightness-graph-heading";
  const title = document.createElement("div");
  title.className = "light-brightness-graph-title";
  title.textContent = headingText;
  const sub = document.createElement("div");
  sub.className = "light-brightness-graph-sub";
  sub.textContent = subtitle;
  heading.append(title, sub);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${viewW} ${HEIGHT}`);
  svg.setAttribute("preserveAspectRatio", "xMinYMin meet");

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "linearGradient"
  );
  const gradientId = `light-bri-grad-${Math.random().toString(36).slice(2, 9)}`;
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("x1", String(PAD_L));
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", String(PAD_L + plotW));
  gradient.setAttribute("y2", "0");
  defs.appendChild(gradient);

  const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  frame.setAttribute("class", "bg-frame");
  frame.setAttribute("x", String(PAD_L));
  frame.setAttribute("y", String(PAD_T));
  frame.setAttribute("width", String(plotW));
  frame.setAttribute("height", String(PLOT_H));
  frame.setAttribute("rx", "6");

  const fillArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fillArea.setAttribute("class", "fill-area");
  fillArea.setAttribute("fill", `url(#${gradientId})`);

  const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
  curve.setAttribute("class", "curve");

  const handlesLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  handlesLayer.setAttribute("class", "handles");

  svg.append(defs, frame, fillArea, curve, handlesLayer);
  el.append(heading, svg);

  let drag = null;
  let dragNode = null;

  const applyLayout = (widthPx) => {
    viewW = Math.max(Math.round(widthPx) || 300, 120);
    plotW = Math.max(viewW - PAD_L - PAD_R, 40);
    svg.setAttribute("viewBox", `0 0 ${viewW} ${HEIGHT}`);
    frame.setAttribute("width", String(plotW));
    gradient.setAttribute("x2", String(PAD_L + plotW));
  };

  const xOf = (seconds, minS, maxS) => {
    const span = maxS - minS || 1;
    return PAD_L + ((seconds - minS) / span) * plotW;
  };
  const yOf = (brightness) =>
    PAD_T + PLOT_H * (1 - Math.max(0, Math.min(255, brightness)) / 255);
  const brightnessFromY = (clientY) => {
    const rect = svg.getBoundingClientRect();
    const scaleY = HEIGHT / (rect.height || HEIGHT);
    const y = (clientY - rect.top) * scaleY;
    const t = 1 - (y - PAD_T) / PLOT_H;
    return Math.round(Math.max(0, Math.min(1, t)) * 255);
  };

  const unbindWindowDrag = () => {
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerUp);
  };

  const onWindowPointerMove = (ev) => {
    if (!drag || drag.pointerId !== ev.pointerId) {
      return;
    }
    onBrightness(drag.sceneId, brightnessFromY(ev.clientY));
  };

  const onWindowPointerUp = (ev) => {
    endDrag(ev);
  };

  const paintGeometry = (points) => {
    gradient.replaceChildren();
    const members = points.filter((point) => point.member);
    if (!points.length) {
      fillArea.setAttribute("d", "");
      curve.setAttribute("d", "");
      return [];
    }
    const minS = points[0].seconds;
    const maxS = points[points.length - 1].seconds;
    const span = Math.max(maxS - minS, 1);
    for (const point of members) {
      const stop = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      const offset = ((point.seconds - minS) / span) * 100;
      const [r, g, b] = point.rgb;
      stop.setAttribute("offset", `${offset.toFixed(2)}%`);
      stop.setAttribute("stop-color", `rgb(${r},${g},${b})`);
      gradient.appendChild(stop);
    }
    if (members.length === 1) {
      const [r, g, b] = members[0].rgb;
      const end = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "stop"
      );
      end.setAttribute("offset", "100%");
      end.setAttribute("stop-color", `rgb(${r},${g},${b})`);
      gradient.appendChild(end);
    }
    if (members.length) {
      const memberCoords = members.map((point) => ({
        x: xOf(point.seconds, minS, maxS),
        y: yOf(point.brightness),
      }));
      const top = memberCoords
        .map(
          (c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`
        )
        .join(" ");
      const area = `${top} L${memberCoords[memberCoords.length - 1].x.toFixed(
        1
      )},${(PAD_T + PLOT_H).toFixed(1)} L${memberCoords[0].x.toFixed(1)},${(
        PAD_T + PLOT_H
      ).toFixed(1)} Z`;
      fillArea.setAttribute("d", area);
      curve.setAttribute("d", top);
    } else {
      fillArea.setAttribute("d", "");
      curve.setAttribute("d", "");
    }
    return points.map((point) => ({
      x: xOf(point.seconds, minS, maxS),
      y: point.member ? yOf(point.brightness) : PAD_T + PLOT_H,
      point,
    }));
  };

  const syncDragVisual = () => {
    const points = [...getPoints()].sort((a, b) => a.seconds - b.seconds);
    const coords = paintGeometry(points);
    for (const node of handlesLayer.querySelectorAll(".handle")) {
      const match = coords.find((c) => c.point.eventId === node.dataset.eventId);
      if (!match) {
        continue;
      }
      node.classList.toggle("active", Boolean(match.point.active));
      node.classList.toggle("add", !match.point.member);
      for (const circle of node.querySelectorAll("circle")) {
        circle.setAttribute("cx", match.x.toFixed(1));
        circle.setAttribute("cy", match.y.toFixed(1));
      }
      const plus = node.querySelector(".handle-plus");
      if (plus) {
        plus.setAttribute("x", match.x.toFixed(1));
        plus.setAttribute("y", match.y.toFixed(1));
      }
      const fill = node.querySelector(".handle-fill");
      if (fill) {
        const [r, g, b] = match.point.rgb;
        fill.setAttribute("fill", `rgb(${r},${g},${b})`);
        fill.style.display = match.point.member ? "" : "none";
      }
    }
  };

  const endDrag = (ev) => {
    if (!drag || (ev && drag.pointerId !== ev.pointerId)) {
      return;
    }
    const node = dragNode;
    const pointerId = drag.pointerId;
    drag = null;
    dragNode = null;
    unbindWindowDrag();
    if (ev && node) {
      try {
        node.releasePointerCapture(pointerId);
      } catch (_err) {
        /* already released */
      }
    }
    sync();
    onDragEnd?.();
  };

  const sync = () => {
    if (drag) {
      syncDragVisual();
      return;
    }
    const points = [...getPoints()].sort((a, b) => a.seconds - b.seconds);
    handlesLayer.replaceChildren();
    const coords = paintGeometry(points);
    if (!points.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    for (const c of coords) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const classes = ["handle"];
      if (c.point.active) {
        classes.push("active");
      }
      if (!c.point.member) {
        classes.push("add");
      }
      group.setAttribute("class", classes.join(" "));
      group.dataset.eventId = c.point.eventId;
      group.dataset.sceneId = c.point.sceneId;
      const hit = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      hit.setAttribute("class", "handle-hit");
      hit.setAttribute("cx", c.x.toFixed(1));
      hit.setAttribute("cy", c.y.toFixed(1));
      hit.setAttribute("r", "14");
      const fill = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      fill.setAttribute("class", "handle-fill");
      fill.setAttribute("cx", c.x.toFixed(1));
      fill.setAttribute("cy", c.y.toFixed(1));
      fill.setAttribute("r", "5");
      const [r, gCh, b] = c.point.rgb;
      fill.setAttribute("fill", `rgb(${r},${gCh},${b})`);
      if (!c.point.member) {
        fill.style.display = "none";
      }
      const dot = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      dot.setAttribute("class", "handle-dot");
      dot.setAttribute("cx", c.x.toFixed(1));
      dot.setAttribute("cy", c.y.toFixed(1));
      dot.setAttribute("r", "7");
      const label = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "text"
      );
      label.setAttribute("class", "handle-label");
      label.setAttribute("x", c.x.toFixed(1));
      label.setAttribute("y", String(HEIGHT - 6));
      label.textContent = c.point.name;
      group.append(hit, dot, fill);
      if (!c.point.member) {
        const plus = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text"
        );
        plus.setAttribute("class", "handle-plus");
        plus.setAttribute("x", c.x.toFixed(1));
        plus.setAttribute("y", c.y.toFixed(1));
        plus.textContent = "+";
        group.appendChild(plus);
        group.setAttribute(
          "aria-label",
          `Add to ${c.point.name}`
        );
        group.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onAdd?.(c.point.sceneId, c.point.eventId);
        });
      } else {
        group.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // Window listeners so release outside the SVG still ends the drag
          // (SVG setPointerCapture alone is flaky across the sidebar chrome).
          unbindWindowDrag();
          try {
            group.setPointerCapture(ev.pointerId);
          } catch (_err) {
            /* capture optional when window listeners are bound */
          }
          dragNode = group;
          drag = {
            sceneId: c.point.sceneId,
            eventId: c.point.eventId,
            pointerId: ev.pointerId,
          };
          window.addEventListener("pointermove", onWindowPointerMove);
          window.addEventListener("pointerup", onWindowPointerUp);
          window.addEventListener("pointercancel", onWindowPointerUp);
          onSelect(c.point.eventId);
          onBrightness(c.point.sceneId, brightnessFromY(ev.clientY));
        });
      }
      group.appendChild(label);
      handlesLayer.appendChild(group);
    }
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect?.width;
          if (!(width > 0)) {
            return;
          }
          applyLayout(width);
          sync();
        })
      : null;
  resizeObserver?.observe(el);
  // First paint before layout may be 0 — sync again after mount.
  requestAnimationFrame(() => {
    applyLayout(el.clientWidth || 300);
    sync();
  });

  sync();
  return {
    el,
    sync,
    disconnect: () => {
      resizeObserver?.disconnect();
      unbindWindowDrag();
      drag = null;
      dragNode = null;
    },
  };
}

function createSceneColorWheel({
  hasColor,
  hasTemp,
  tempMin,
  tempMax,
  getState,
  onSelect,
  onChange,
}) {
  // Polar HSV + kelvin disk, pin/dot markers, and presets match etokheim/huemane-light-card.
  let mode = hasColor ? "color" : "temp";
  const stage = document.createElement("div");
  stage.className = "hue-wheel-stage";
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "hue-wheel-canvas";
  const glow = document.createElement("canvas");
  glow.className = "hue-wheel-glow";
  glow.setAttribute("aria-hidden", "true");
  glow.width = HUE_WHEEL_RENDER;
  glow.height = HUE_WHEEL_RENDER;
  const bg = document.createElement("canvas");
  bg.className = "hue-wheel-bg";
  bg.width = HUE_WHEEL_RENDER;
  bg.height = HUE_WHEEL_RENDER;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "hue-wheel-svg");
  svg.innerHTML = `
    <defs>
      <filter id="se-dot-shadow">
        <feDropShadow dx="0" dy="0.5" stdDeviation="1" flood-opacity="1"></feDropShadow>
      </filter>
      <filter id="se-active-shadow">
        <feOffset dx="0" dy="-10" />
        <feGaussianBlur stdDeviation="7" result="offset-blur"/>
        <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
        <feFlood flood-color="#0005" flood-opacity=".95" result="color"/>
        <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
        <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
        <feDropShadow dx="0" dy="1.0" stdDeviation="2.0" flood-opacity="1"></feDropShadow>
      </filter>
    </defs>
  `;
  const pathLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  pathLayer.setAttribute("class", "hue-wheel-paths");
  svg.appendChild(pathLayer);
  canvasWrap.append(glow, svg, bg);
  const chrome = document.createElement("div");
  chrome.className = "hue-wheel-chrome";
  const pill = document.createElement("div");
  pill.className = "hue-mode-pill";
  const presets = document.createElement("div");
  presets.className = "hue-presets";
  const presetTrack = document.createElement("div");
  presetTrack.className = "hue-presets-track";
  presetTrack.setAttribute("role", "list");
  presets.appendChild(presetTrack);
  chrome.append(pill, presets);
  stage.append(canvasWrap, chrome);

  const markers = new Map();
  let drag = null;
  let glideTimer;

  const radiusPx = () => canvasWrap.clientWidth / 2;

  const paintWheel = () => {
    const url = drawHueWheelImage(mode, tempMin, tempMax);
    const img = new Image();
    img.onload = () => {
      const bgCtx = bg.getContext("2d");
      bgCtx.clearRect(0, 0, HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
      bgCtx.drawImage(img, 0, 0);
      const glowCtx = glow.getContext("2d");
      glowCtx.clearRect(0, 0, HUE_WHEEL_RENDER, HUE_WHEEL_RENDER);
      glowCtx.drawImage(img, 0, 0);
    };
    img.src = url;
  };

  const markerOffset = (active) =>
    active ? { x: 24, y: 60 } : { x: 6, y: 6 };

  const placeMarker = (marker, x, y, active) => {
    const offset = markerOffset(active);
    marker.g.style.transform = `translate(${x - offset.x}px, ${y - offset.y}px)`;
    marker.g.style.transformOrigin = `${x}px ${y}px`;
    marker.x = x;
    marker.y = y;
  };

  const positionForDraft = (draft, markerMode, radius) => {
    if (markerMode === "color") {
      const mixed = draftRgb(draft);
      const chromatic = chromaticRgbFromDraft(draft) || mixed;
      const hsv = rgb2hsv(chromatic[0], chromatic[1], chromatic[2]);
      const coords = coordinatesForColor(hsv[0], hsv[1], radius);
      return { x: coords.x + radius, y: coords.y + radius, rgb: mixed };
    }
    const kelvin = draft.color_temp_kelvin ?? 2700;
    const coords = coordinatesForTemp(kelvin, radius, tempMin, tempMax);
    const rgb = hueTempToRgb(kelvin);
    return { x: coords.x + radius, y: coords.y + radius, rgb };
  };

  const applyAtPoint = (draft, x, y, radius) => {
    const limited = limitToWheel(x, y, radius);
    const cx = limited.x - radius;
    const cy = limited.y - radius;
    if (mode === "color") {
      const sample = hueColorAt(cx, cy, radius);
      if (!sample) {
        return limited;
      }
      applyColorToDraft(draft, sample.rgb, sample.hsv);
    } else {
      const sample = hueTempAt(cx, cy, radius, tempMin, tempMax);
      if (!sample) {
        return limited;
      }
      applyTempToDraft(draft, sample.kelvin);
    }
    return limited;
  };

  const updatePresetOverflow = () => {
    const maxScroll = presetTrack.scrollWidth - presetTrack.clientWidth;
    presets.classList.toggle(
      "can-scroll-end",
      maxScroll > 1 && presetTrack.scrollLeft < maxScroll - 1
    );
  };

  const syncPresets = () => {
    presetTrack.replaceChildren();
    const { scenes, activeId } = getState();
    const active = scenes.find((item) => item.id === activeId);
    const list = mode === "color" ? HUE_COLOR_PRESETS : HUE_TEMP_PRESETS;
    presetTrack.setAttribute(
      "aria-label",
      mode === "color" ? "Colors" : "Color temperature"
    );
    for (const item of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hue-preset";
      btn.setAttribute("role", "listitem");
      if (mode === "color") {
        btn.style.backgroundColor = item;
        const rgb = hexToRgb(item);
        const current = active ? draftRgb(active.draft) : null;
        if (
          current &&
          current[0] === rgb[0] &&
          current[1] === rgb[1] &&
          current[2] === rgb[2]
        ) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          if (!active) {
            return;
          }
          const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
          applyColorToDraft(active.draft, rgb, hsv);
          const marker = markers.get(active.id);
          if (marker) {
            marker.g.classList.add("glide");
            clearTimeout(glideTimer);
            glideTimer = setTimeout(() => marker.g.classList.remove("glide"), 450);
          }
          onChange();
          sync();
        });
      } else {
        const rgb = hueTempToRgb(item);
        btn.style.backgroundColor = rgbCss(rgb);
        if (active?.draft?.color_temp_kelvin === item) {
          btn.classList.add("active");
        }
        btn.addEventListener("click", () => {
          if (!active) {
            return;
          }
          applyTempToDraft(active.draft, item);
          const marker = markers.get(active.id);
          if (marker) {
            marker.g.classList.add("glide");
            clearTimeout(glideTimer);
            glideTimer = setTimeout(() => marker.g.classList.remove("glide"), 450);
          }
          onChange();
          sync();
        });
      }
      presetTrack.appendChild(btn);
    }
    requestAnimationFrame(updatePresetOverflow);
  };

  const paintPill = () => {
    pill.replaceChildren();
    if (!(hasColor && hasTemp)) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    for (const option of ["color", "temp"]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hue-mode-btn";
      if (option === mode) {
        btn.classList.add("active");
      }
      btn.setAttribute(
        "aria-label",
        option === "color" ? "Color" : "Color temperature"
      );
      const swatch = document.createElement("span");
      swatch.className = `hue-mode-swatch ${option}`;
      btn.appendChild(swatch);
      btn.addEventListener("click", () => setMode(option, { convertDraft: true }));
      pill.appendChild(btn);
    }
  };

  const sync = () => {
    const radius = radiusPx();
    const { scenes, activeId } = getState();
    const seen = new Set();
    for (const scene of scenes) {
      seen.add(scene.id);
      let marker = markers.get(scene.id);
      if (!marker) {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "gm");
        const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
        outline.setAttribute("class", "marker-outline");
        outline.setAttribute("d", HUE_DOT_OUTLINE_PATH);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "marker");
        const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hit.setAttribute("cx", "6");
        hit.setAttribute("cy", "6");
        hit.setAttribute("r", "12");
        hit.setAttribute("fill", "transparent");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "text");
        icon.setAttribute("class", "icon text");
        icon.setAttribute("x", "24");
        icon.setAttribute("y", "24");
        icon.setAttribute("text-anchor", "middle");
        icon.setAttribute("dominant-baseline", "middle");
        g.append(outline, path, hit, icon);
        marker = { g, path, outline, hit, icon, sceneId: scene.id };
        markers.set(scene.id, marker);
        g.addEventListener("pointerdown", (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const { scenes: now, activeId: current } = getState();
          const item = now.find((row) => row.id === scene.id);
          if (!item) {
            return;
          }
          if (scene.id !== current) {
            onSelect(scene.id);
          }
          const markerMode = draftWheelMode(item.draft, hasColor, hasTemp);
          if (markerMode !== mode) {
            setMode(markerMode, { convertDraft: false });
          }
          const pt = pointFromEvent(ev);
          startDrag(
            ev,
            scene.id,
            pt.x - (marker.x ?? radiusPx()),
            pt.y - (marker.y ?? radiusPx())
          );
          g.classList.add("drag");
        });
        svg.appendChild(g);
      }
      const active = scene.id === activeId;
      const markerMode = draftWheelMode(scene.draft, hasColor, hasTemp);
      marker.path.setAttribute("d", active ? HUE_PIN_PATH : HUE_DOT_PATH);
      marker.g.classList.toggle("active", active);
      marker.g.classList.toggle("off-mode", markerMode !== mode);
      marker.icon.textContent = String(scene.index);
      marker.hit.style.display = active ? "none" : "";
      if (!radius) {
        continue;
      }
      const pos = positionForDraft(scene.draft, markerMode, radius);
      marker.g.style.color = rgbCss(pos.rgb);
      marker.icon.style.fill = pinForeground(pos.rgb);
      placeMarker(marker, pos.x, pos.y, active);
      if (active) {
        svg.appendChild(marker.g);
      }
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.g.remove();
        markers.delete(id);
      }
    }
    syncPath();
    syncPresets();
  };

  const syncPath = () => {
    pathLayer.replaceChildren();
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const { scenes, sequence } = getState();
    const byId = new Map(scenes.map((item) => [item.id, item]));
    const cycle = collapseSceneCycle(sequence || scenes.map((item) => item.id));
    if (cycle.length < 2) {
      return;
    }
    const edgeCount = cycle.length === 2 ? 1 : cycle.length;
    const edges = [];
    for (let index = 0; index < edgeCount; index += 1) {
      const from = byId.get(cycle[index]);
      const to = byId.get(cycle[(index + 1) % cycle.length]);
      if (!from || !to) {
        continue;
      }
      const pts = [];
      for (let step = 0; step <= HUE_PATH_STEPS; step += 1) {
        const sample = interpolateDraftSample(
          from.draft,
          to.draft,
          step / HUE_PATH_STEPS
        );
        const point = wheelPointForSample(
          sample,
          mode,
          radius,
          tempMin,
          tempMax
        );
        if (point) {
          pts.push(point);
        }
      }
      if (pts.length >= 2) {
        edges.push(pts);
      }
    }
    const ns = "http://www.w3.org/2000/svg";
    for (const pts of edges) {
      const under = document.createElementNS(ns, "path");
      under.setAttribute("class", "hue-path-under");
      under.setAttribute(
        "d",
        pts
          .map(
            (pt, index) =>
              `${index ? "L" : "M"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
          )
          .join(" ")
      );
      pathLayer.appendChild(under);
    }
    for (const pts of edges) {
      const mid = document.createElementNS(ns, "path");
      mid.setAttribute("class", "hue-path-mid");
      mid.setAttribute(
        "d",
        pts
          .map(
            (pt, index) =>
              `${index ? "L" : "M"}${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
          )
          .join(" ")
      );
      pathLayer.appendChild(mid);
    }
    for (const pts of edges) {
      for (let index = 1; index < pts.length; index += 1) {
        const start = pts[index - 1];
        const end = pts[index];
        const seg = document.createElementNS(ns, "path");
        seg.setAttribute("class", "hue-path-seg");
        seg.setAttribute(
          "d",
          `M${start.x.toFixed(2)} ${start.y.toFixed(2)} L${end.x.toFixed(2)} ${end.y.toFixed(2)}`
        );
        seg.setAttribute(
          "stroke",
          rgbCss([
            Math.round((start.rgb[0] + end.rgb[0]) / 2),
            Math.round((start.rgb[1] + end.rgb[1]) / 2),
            Math.round((start.rgb[2] + end.rgb[2]) / 2),
          ])
        );
        pathLayer.appendChild(seg);
      }
    }
  };

  const pointFromEvent = (ev) => {
    const rect = canvasWrap.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };

  const onPointerMove = (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) {
      return;
    }
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const { scenes, activeId } = getState();
    const item = scenes.find((row) => row.id === (drag.sceneId || activeId));
    if (!item) {
      return;
    }
    const pt = pointFromEvent(ev);
    const limited = applyAtPoint(
      item.draft,
      pt.x - drag.grabX,
      pt.y - drag.grabY,
      radius
    );
    const marker = markers.get(item.id);
    if (marker) {
      marker.g.style.color = rgbCss(draftRgb(item.draft));
      marker.icon.style.fill = pinForeground(draftRgb(item.draft));
      placeMarker(marker, limited.x, limited.y, true);
    }
    syncPath();
    onChange();
  };

  const onPointerUp = (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) {
      return;
    }
    const marker = markers.get(drag.sceneId);
    marker?.g.classList.remove("drag");
    marker?.g.classList.add("boing");
    setTimeout(() => marker?.g.classList.remove("boing"), 200);
    drag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    sync();
  };

  const startDrag = (ev, sceneId, grabX = 0, grabY = 0) => {
    drag = { sceneId, pointerId: ev.pointerId, grabX, grabY };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  svg.addEventListener("pointerdown", (ev) => {
    const radius = radiusPx();
    if (!radius) {
      return;
    }
    const pt = pointFromEvent(ev);
    const dist = Math.hypot(pt.x - radius, pt.y - radius);
    if (dist > radius) {
      return;
    }
    const { scenes, activeId } = getState();
    const item = scenes.find((row) => row.id === activeId);
    if (!item) {
      return;
    }
    ev.preventDefault();
    startDrag(ev, item.id);
    const limited = applyAtPoint(item.draft, pt.x, pt.y, radius);
    const marker = markers.get(item.id);
    marker?.g.classList.add("drag", "active");
    if (marker) {
      placeMarker(marker, limited.x, limited.y, true);
    }
    syncPath();
    onChange();
  });

  const setMode = (next, { convertDraft = false } = {}) => {
    if (next === "color" && !hasColor) {
      return;
    }
    if (next === "temp" && !hasTemp) {
      return;
    }
    const { scenes, activeId } = getState();
    const active = scenes.find((item) => item.id === activeId);
    if (convertDraft && active && draftWheelMode(active.draft, hasColor, hasTemp) !== next) {
      if (next === "color") {
        const rgb = draftRgb(active.draft);
        const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
        applyColorToDraft(active.draft, rgb, hsv);
      } else {
        applyTempToDraft(
          active.draft,
          active.draft.color_temp_kelvin ?? Math.round((tempMin + tempMax) / 2)
        );
      }
      onChange();
    }
    if (mode !== next) {
      mode = next;
      paintWheel();
    }
    paintPill();
    sync();
  };

  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    sync();
    updatePresetOverflow();
  });
  ro?.observe(canvasWrap);
  ro?.observe(presets);
  presetTrack.addEventListener("scroll", updatePresetOverflow, { passive: true });
  paintWheel();
  paintPill();

  const disconnect = () => {
    ro?.disconnect();
    clearTimeout(glideTimer);
    if (drag) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      drag = null;
    }
  };

  return { el: stage, setMode, sync, syncPresets, disconnect };
}

function medianNumber(values) {
  const sorted = values
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number)
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function circularMeanHue(hues) {
  let x = 0;
  let y = 0;
  for (const hue of hues) {
    const rad = (Number(hue) * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const deg = (Math.atan2(y / hues.length, x / hues.length) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function lightDraftFingerprint(draft) {
  return JSON.stringify({
    state: draft?.state || "off",
    brightness: draft?.brightness ?? null,
    color_temp_kelvin: draft?.color_temp_kelvin ?? null,
    rgb_color: draft?.rgb_color ?? null,
    hs_color: draft?.hs_color ?? null,
    rgbw_color: draft?.rgbw_color ?? null,
    rgbww_color: draft?.rgbww_color ?? null,
  });
}

export {
  hueLinearScale,
  hueCurveScale,
  inverseHueCurveScale,
  xy2polar,
  polar2xy,
  rad2deg,
  deg2rad,
  hueFromDeg,
  degFromHue,
  saturationFromR,
  rFromSaturation,
  fixHSValue,
  hsValue,
  hsv2rgb,
  rgb2hsv,
  hueTempToRgb,
  kelvinToRgb,
  hexToRgb,
  rgbCss,
  pinForeground,
  draftWheelMode,
  rgbwToRgb,
  rgbwwToRgb,
  scaleRgbChannels,
  chromaticRgbFromDraft,
  colorBrightnessFromDraft,
  whiteBrightnessFromDraft,
  setColorBrightnessOnDraft,
  setWhiteBrightnessOnDraft,
  draftRgb,
  applyColorToDraft,
  applyTempToDraft,
  inferDraftColorKind,
  collapseSceneCycle,
  lerpNumber,
  interpolateDraftSample,
  colorWheelXY,
  wheelPointForSample,
  hueColorAt,
  hueTempAt,
  coordinatesForColor,
  coordinatesForTemp,
  limitToWheel,
  drawHueWheelImage,
  createLightBrightnessGraph,
  createSceneColorWheel,
  medianNumber,
  circularMeanHue,
  lightDraftFingerprint,
  HUE_WHEEL_RENDER,
  HUE_COLOR_PRESETS,
  HUE_TEMP_PRESETS,
  HUE_PIN_PATH,
  HUE_DOT_PATH,
  HUE_DOT_OUTLINE_PATH,
  HUE_PATH_STEPS,
};

/* Editor session helpers: form defaults, clock/date formatting, and ISO day math.
   Draft localStorage load/save/persist still live as SceneExtrapolationPanel methods
   in panel.js (key building + serialization are class-bound today). Revisit when
   those can be free functions without changing behavior. */

const SECONDS_PER_DAY = 24 * 3600;

function isoYear(iso) {
  return Number(iso.slice(0, 4));
}

function daysInYear(year) {
  return new Date(year, 1, 29).getDate() === 29 ? 366 : 365;
}

function dayOfYear(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
}

function isoFromDayOfYear(year, dayIndex) {
  const date = new Date(Date.UTC(year, 0, 1 + dayIndex));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPreviewDayMonth(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shiftIsoDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/** Signed whole-day distance from→to (local calendar dates). */
function diffIsoDays(fromIso, toIso) {
  const [y0, m0, d0] = fromIso.split("-").map(Number);
  const [y1, m1, d1] = toIso.split("-").map(Number);
  const from = Date.UTC(y0, m0 - 1, d0);
  const to = Date.UTC(y1, m1 - 1, d1);
  return Math.round((to - from) / 86400000);
}

function formatClockHm(seconds) {
  const sec = ((Math.round(Number(seconds) || 0) % SECONDS_PER_DAY) + SECONDS_PER_DAY) %
    SECONDS_PER_DAY;
  if (sec === 0) {
    return "00:00";
  }
  if (sec >= SECONDS_PER_DAY) {
    return "24:00";
  }
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function emptyFormData() {
  return {
    scene_name: "Circadian",
    description: "",
    labels: [],
    category: null,
    area: null,
    display_scenes_combined: true,
    scene_dawn_sunrise_sunset: null,
    scene_dawn: null,
    scene_sunrise: null,
    scene_noon: null,
    scene_sunset: null,
    scene_dusk: null,
    scene_dusk_minimum_time_of_day: "22:00:00",
  };
}

function timeToSeconds(value) {
  if (value == null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const parts = String(value).split(":").map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

function nowSecondsSinceMidnight() {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function formatClock(seconds) {
  const hours = Math.floor(seconds / 3600) % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export {
  isoYear,
  daysInYear,
  dayOfYear,
  isoFromDayOfYear,
  todayIso,
  formatPreviewDayMonth,
  shiftIsoDate,
  diffIsoDays,
  formatClockHm,
  emptyFormData,
  timeToSeconds,
  nowSecondsSinceMidnight,
  formatClock,
};

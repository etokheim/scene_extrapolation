/* Client-side sun geometry for dial year-scrub only.
   Scene activation and settled preview stay on HA Astral (solar.py).
   SunCalc (c) 2011-2015 Vladimir Agafonkin — https://github.com/mourner/suncalc
*/

const SECONDS_PER_DAY = 24 * 3600;
const CURVE_STEP_MINUTES = 5;
const AXIAL_TILT_DEG = 23.44;

const EVENT_META = [
  ["dawn", "Dawn", "mdi:weather-sunset", "dawn"],
  ["sunrise", "Sunrise", "mdi:weather-sunset-up", "sunrise"],
  ["noon", "Noon", "mdi:weather-sunny", "solarNoon"],
  ["sunset", "Sunset", "mdi:weather-sunset-down", "sunset"],
  ["dusk", "Dusk", "mdi:weather-night", "dusk"],
];

const PREVIOUS_EVENTS = {
  sunrise: "dawn",
  noon: "sunrise",
  sunset: "noon",
  dusk: "sunset",
};

const WINTER_FALLBACK = {
  dawn: [8, 45],
  sunrise: [10, 30],
  noon: [12, 0],
  sunset: [13, 0],
  dusk: [22, 0],
};
const SUMMER_FALLBACK = {
  dawn: [2, 15],
  sunrise: [4, 0],
  noon: [13, 0],
  sunset: [22, 0],
  dusk: [23, 55],
};


const SunCalc = (() => {
'use strict';


// shortcuts for easier to read formulas

var PI   = Math.PI,
    sin  = Math.sin,
    cos  = Math.cos,
    tan  = Math.tan,
    asin = Math.asin,
    atan = Math.atan2,
    acos = Math.acos,
    rad  = PI / 180;

// sun calculations are based on http://aa.quae.nl/en/reken/zonpositie.html formulas


// date/time constants and conversions

var dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545;

function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j)  { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date)   { return toJulian(date) - J2000; }


// general calculations for position

var e = rad * 23.4397; // obliquity of the Earth

function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b)    { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }

function azimuth(H, phi, dec)  { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }

function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }

function astroRefraction(h) {
    if (h < 0) // the following formula works for positive altitudes only.
        h = 0; // if h = -0.08901179 a div/0 would occur.

    // formula 16.4 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
    // 1.02 / tan(h + 10.26 / (h + 5.10)) h in degrees, result in arc minutes -> converted to rad:
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// general sun calculations

function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }

function eclipticLongitude(M) {

    var C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), // equation of center
        P = rad * 102.9372; // perihelion of the Earth

    return M + C + P + PI;
}

function sunCoords(d) {

    var M = solarMeanAnomaly(d),
        L = eclipticLongitude(M);

    return {
        dec: declination(L, 0),
        ra: rightAscension(L, 0)
    };
}


var SunCalc = {};


// calculates sun position for a given date and latitude/longitude

SunCalc.getPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c  = sunCoords(d),
        H  = siderealTime(d, lw) - c.ra;

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: altitude(H, phi, c.dec)
    };
};


// sun times configuration (angle, morning name, evening name)

var times = SunCalc.times = [
    [-0.833, 'sunrise',       'sunset'      ],
    [  -0.3, 'sunriseEnd',    'sunsetStart' ],
    [    -6, 'dawn',          'dusk'        ],
    [   -12, 'nauticalDawn',  'nauticalDusk'],
    [   -18, 'nightEnd',      'night'       ],
    [     6, 'goldenHourEnd', 'goldenHour'  ]
];

// adds a custom time to the times config

SunCalc.addTime = function (angle, riseName, setName) {
    times.push([angle, riseName, setName]);
};


// calculations for sun times

var J0 = 0.0009;

function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }

function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds, M, L)  { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }

function hourAngle(h, phi, d) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height) { return -2.076 * Math.sqrt(height) / 60; }

// returns set time for the given sun altitude
function getSetJ(h, lw, phi, dec, n, M, L) {

    var w = hourAngle(h, phi, dec),
        a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}


// calculates sun times for a given date, latitude/longitude, and, optionally,
// the observer height (in meters) relative to the horizon

SunCalc.getTimes = function (date, lat, lng, height) {

    height = height || 0;

    var lw = rad * -lng,
        phi = rad * lat,

        dh = observerAngle(height),

        d = toDays(date),
        n = julianCycle(d, lw),
        ds = approxTransit(0, lw, n),

        M = solarMeanAnomaly(ds),
        L = eclipticLongitude(M),
        dec = declination(L, 0),

        Jnoon = solarTransitJ(ds, M, L),

        i, len, time, h0, Jset, Jrise;


    var result = {
        solarNoon: fromJulian(Jnoon),
        nadir: fromJulian(Jnoon - 0.5)
    };

    for (i = 0, len = times.length; i < len; i += 1) {
        time = times[i];
        h0 = (time[0] + dh) * rad;

        Jset = getSetJ(h0, lw, phi, dec, n, M, L);
        Jrise = Jnoon - (Jset - Jnoon);

        result[time[1]] = fromJulian(Jrise);
        result[time[2]] = fromJulian(Jset);
    }

    return result;
};


// moon calculations, based on http://aa.quae.nl/en/reken/hemelpositie.html formulas

function moonCoords(d) { // geocentric ecliptic coordinates of the moon

    var L = rad * (218.316 + 13.176396 * d), // ecliptic longitude
        M = rad * (134.963 + 13.064993 * d), // mean anomaly
        F = rad * (93.272 + 13.229350 * d),  // mean distance

        l  = L + rad * 6.289 * sin(M), // longitude
        b  = rad * 5.128 * sin(F),     // latitude
        dt = 385001 - 20905 * cos(M);  // distance to the moon in km

    return {
        ra: rightAscension(l, b),
        dec: declination(l, b),
        dist: dt
    };
}

SunCalc.getMoonPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c = moonCoords(d),
        H = siderealTime(d, lw) - c.ra,
        h = altitude(H, phi, c.dec),
        // formula 14.1 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
        pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));

    h = h + astroRefraction(h); // altitude correction for refraction

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: h,
        distance: c.dist,
        parallacticAngle: pa
    };
};


// calculations for illumination parameters of the moon,
// based on http://idlastro.gsfc.nasa.gov/ftp/pro/astro/mphase.pro formulas and
// Chapter 48 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.

SunCalc.getMoonIllumination = function (date) {

    var d = toDays(date || new Date()),
        s = sunCoords(d),
        m = moonCoords(d),

        sdist = 149598000, // distance from Earth to Sun in km

        phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)),
        inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)),
        angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) -
                cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

    return {
        fraction: (1 + cos(inc)) / 2,
        phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
        angle: angle
    };
};


function hoursLater(date, h) {
    return new Date(date.valueOf() + h * dayMs / 24);
}

// calculations for moon rise/set times are based on http://www.stargazing.net/kepler/moonrise.html article

SunCalc.getMoonTimes = function (date, lat, lng, inUTC) {
    var t = new Date(date);
    if (inUTC) t.setUTCHours(0, 0, 0, 0);
    else t.setHours(0, 0, 0, 0);

    var hc = 0.133 * rad,
        h0 = SunCalc.getMoonPosition(t, lat, lng).altitude - hc,
        h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;

    // go in 2-hour chunks, each time seeing if a 3-point quadratic curve crosses zero (which means rise or set)
    for (var i = 1; i <= 24; i += 2) {
        h1 = SunCalc.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
        h2 = SunCalc.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;

        a = (h0 + h2) / 2 - h1;
        b = (h2 - h0) / 2;
        xe = -b / (2 * a);
        ye = (a * xe + b) * xe + h1;
        d = b * b - 4 * a * h1;
        roots = 0;

        if (d >= 0) {
            dx = Math.sqrt(d) / (Math.abs(a) * 2);
            x1 = xe - dx;
            x2 = xe + dx;
            if (Math.abs(x1) <= 1) roots++;
            if (Math.abs(x2) <= 1) roots++;
            if (x1 < -1) x1 = x2;
        }

        if (roots === 1) {
            if (h0 < 0) rise = i + x1;
            else set = i + x1;

        } else if (roots === 2) {
            rise = i + (ye < 0 ? x2 : x1);
            set = i + (ye < 0 ? x1 : x2);
        }

        if (rise && set) break;

        h0 = h2;
    }

    var result = {};

    if (rise) result.rise = hoursLater(t, rise);
    if (set) result.set = hoursLater(t, set);

    if (!rise && !set) result[ye > 0 ? 'alwaysUp' : 'alwaysDown'] = true;

    return result;
};

return SunCalc;

})();

export function maxSolarElevation(latitude) {
  return 90.0 - Math.max(0.0, Math.abs(latitude) - AXIAL_TILT_DEG);
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.min(Math.round(seconds), SECONDS_PER_DAY));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 24) {
    return "24:00";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function duskStartSeconds(solarSeconds, duskMinimum) {
  if (solarSeconds >= SECONDS_PER_DAY) {
    return { seconds: SECONDS_PER_DAY, overridden: false, solarSeconds: null };
  }
  solarSeconds = Math.max(0, solarSeconds);
  if (duskMinimum != null && Number(duskMinimum) > solarSeconds) {
    return {
      seconds: Number(duskMinimum),
      overridden: true,
      solarSeconds,
    };
  }
  return { seconds: solarSeconds, overridden: false, solarSeconds: null };
}

function fallbackClock(latitude, month) {
  const northern = latitude >= 0;
  const isWinter = northern
    ? month >= 10 || month <= 3
    : month >= 4 && month <= 9;
  return isWinter ? WINTER_FALLBACK : SUMMER_FALLBACK;
}

function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** UTC Date for local noon on isoDate in timeZone (stable day for SunCalc). */
function zonedNoonDate(isoDate, timeZone) {
  const [y, m, d] = isoDate.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const desired = Date.UTC(y, m - 1, d, 12, 0, 0);
    guess += desired - asUtc;
  }
  return new Date(guess);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function secondsSinceMidnightInZone(date, timeZone, isoDate) {
  const p = zonedParts(date, timeZone);
  const dateStr = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
  const tod = p.hour * 3600 + p.minute * 60 + p.second;
  // Astral/SunCalc dusk can land on the next calendar day near solstice.
  if (isoDate && dateStr > isoDate) {
    return SECONDS_PER_DAY + tod;
  }
  return tod;
}

function todayIsoInZone(timeZone) {
  const p = zonedParts(new Date(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Approximate HA sun_path geometry for one calendar day (scrub preview).
 * Polar fallbacks mirror solar.py seasonal clocks when SunCalc has no rise/set.
 */
export function buildClientSunDay({
  isoDate,
  latitude,
  longitude,
  timeZone = "UTC",
  duskMinimum = null,
}) {
  const noon = zonedNoonDate(isoDate, timeZone);
  const [y, m, d] = isoDate.split("-").map(Number);
  const times = SunCalc.getTimes(noon, latitude, longitude);
  const fallbacks = new Set();
  const fallbackTimes = fallbackClock(latitude, m);
  const rawById = {};

  for (const [id, , , sunKey] of EVENT_META) {
    const raw = times[sunKey];
    if (isValidDate(raw)) {
      rawById[id] = raw;
    }
  }

  const eventsById = {};
  for (const [id] of EVENT_META) {
    if (rawById[id]) {
      eventsById[id] = rawById[id];
      continue;
    }
    const [hour, minute] = fallbackTimes[id];
    let seasonal = zonedNoonDate(isoDate, timeZone);
    // Rebuild as local wall time on that day via offset from noon parts.
    const noonParts = zonedParts(seasonal, timeZone);
    const deltaSec =
      (hour - noonParts.hour) * 3600 +
      (minute - noonParts.minute) * 60 -
      noonParts.second;
    seasonal = new Date(seasonal.getTime() + deltaSec * 1000);
    let fallbackTime = seasonal;
    const prevName = PREVIOUS_EVENTS[id];
    if (prevName && eventsById[prevName]) {
      const previousPlus = new Date(
        eventsById[prevName].getTime() + 30 * 60 * 1000
      );
      if (previousPlus > seasonal) {
        fallbackTime = previousPlus;
      }
    }
    eventsById[id] = fallbackTime;
    fallbacks.add(id);
  }

  const events = [];
  for (const [id, name, icon] of EVENT_META) {
    const eventTime = eventsById[id];
    let seconds = secondsSinceMidnightInZone(eventTime, timeZone, isoDate);
    let overridden = false;
    let solarTime = null;
    let solarSeconds = null;
    if (id === "dusk") {
      const dusk = duskStartSeconds(seconds, duskMinimum);
      seconds = dusk.seconds;
      overridden = dusk.overridden;
      if (dusk.solarSeconds != null) {
        solarSeconds = dusk.solarSeconds;
        solarTime = formatTime(dusk.solarSeconds);
      }
    }
    const elevRad = SunCalc.getPosition(eventTime, latitude, longitude).altitude;
    events.push({
      id,
      name,
      icon,
      seconds,
      time: formatTime(seconds),
      elevation: Math.round(elevRad * (180 / Math.PI) * 100) / 100,
      overridden,
      fallback: fallbacks.has(id),
      solar_time: solarTime,
      solar_seconds: solarSeconds,
    });
  }

  const curve = [];
  let dayPeak = -Infinity;
  for (let minute = 0; minute <= 24 * 60; minute += CURVE_STEP_MINUTES) {
    const seconds = minute * 60;
    const sampleAt = new Date(noon.getTime() + (minute - 12 * 60) * 60 * 1000);
    const elev =
      SunCalc.getPosition(sampleAt, latitude, longitude).altitude * (180 / Math.PI);
    const rounded = Math.round(elev * 100) / 100;
    dayPeak = Math.max(dayPeak, rounded);
    curve.push([seconds, rounded]);
  }

  const today = isoDate === todayIsoInZone(timeZone);
  const nowParts = zonedParts(new Date(), timeZone);
  const nowSeconds =
    nowParts.hour * 3600 + nowParts.minute * 60 + nowParts.second;
  const nowElev =
    SunCalc.getPosition(new Date(), latitude, longitude).altitude * (180 / Math.PI);

  return {
    date: isoDate,
    today,
    now: {
      seconds: nowSeconds,
      time: formatTime(nowSeconds),
      elevation: Math.round(nowElev * 100) / 100,
    },
    events,
    curve,
    max_elevation: Math.round(maxSolarElevation(latitude) * 100) / 100,
    _client: true,
    _dayPeak: dayPeak,
  };
}

function currentEventIndex(starts, seconds) {
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] > seconds) {
      return index ? index - 1 : starts.length - 1;
    }
  }
  return starts.length - 1;
}

function transitionProgress(currentStart, nextStart, seconds) {
  seconds = ((seconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const crossing = currentStart > nextStart;
  let span;
  let remaining;
  if (crossing) {
    span = SECONDS_PER_DAY - currentStart + nextStart;
    if (seconds <= nextStart) {
      remaining = nextStart - seconds;
    } else {
      remaining = SECONDS_PER_DAY - seconds + nextStart;
    }
  } else {
    span = nextStart - currentStart;
    remaining = nextStart - seconds;
  }
  if (!(span > 0)) {
    return 0;
  }
  const percent = ((span - remaining) / span) * 100;
  return Math.max(0, Math.min(100, percent));
}

function knotFromEventState(row, draftRgbFn) {
  if (!row?.present || !row.state || row.state.state !== "on") {
    return { brightness: 0, rgb: [0, 0, 0] };
  }
  const st = row.state;
  const brightness =
    st.brightness != null
      ? Math.max(0, Math.min(100, Math.round((st.brightness * 100) / 255)))
      : 100;
  const rgb = draftRgbFn(st) || [255, 214, 170];
  return { brightness, rgb: [rgb[0], rgb[1], rgb[2]] };
}

/** Rebuild light.samples for dial scrub from event_states + day's event times. */
export function resampleLightsForEvents(lights, events, draftRgbFn) {
  const starts = events.map((event) => event.seconds);
  return (lights || []).map((light) => {
    if (light.suggested || !(light.event_states || []).length) {
      return light;
    }
    const knots = events.map((event) => {
      const row = (light.event_states || []).find(
        (item) => item.event === event.id
      );
      return {
        seconds: event.seconds,
        ...knotFromEventState(row, draftRgbFn),
      };
    });
    const samples = [];
    for (let minute = 0; minute <= 24 * 60; minute += CURVE_STEP_MINUTES) {
      const seconds = minute * 60;
      const index = currentEventIndex(starts, seconds);
      const current = knots[index];
      const next = knots[(index + 1) % knots.length];
      const percent = transitionProgress(current.seconds, next.seconds, seconds);
      const t = percent / 100;
      samples.push([
        seconds,
        Math.round(current.brightness + (next.brightness - current.brightness) * t),
        Math.round(current.rgb[0] + (next.rgb[0] - current.rgb[0]) * t),
        Math.round(current.rgb[1] + (next.rgb[1] - current.rgb[1]) * t),
        Math.round(current.rgb[2] + (next.rgb[2] - current.rgb[2]) * t),
      ]);
    }
    return { ...light, samples };
  });
}

export { SunCalc, CURVE_STEP_MINUTES };

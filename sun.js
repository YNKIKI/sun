// 해 위치·시각 계산
// 위치: Meeus 「Astronomical Algorithms」 25장(겉보기 황경 · 장동 · 광행차) + 시차 + 대기 굴절.
// NASA JPL Horizons 겉보기 값과 견줘 방위 · 고도 0.01° 안쪽(해 지름 0.53°의 1/50).
const PI = Math.PI, rad = PI / 180, dayMs = 864e5;
const norm = d => ((d % 360) + 360) % 360;

// 지구 자전 보정(ΔT, 초): 2005~2050년 근사(Espenak · Meeus)
const deltaT = y => { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; };

// 굴절을 넣지 않은 해(방위: 북 0° 시계 방향, 고도: 지평선 0°, 시차 포함)
function sunRaw(date, lat, lng) {
  const JD = date.valueOf() / dayMs + 2440587.5, year = 2000 + (JD - 2451545) / 365.25;
  const T = (JD + deltaT(year) / 86400 - 2451545) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * rad;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  const ecc = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const nu = M + C * rad, R = 1.000001018 * (1 - ecc * ecc) / (1 + ecc * Math.cos(nu));
  const om = (125.04452 - 1934.136261 * T) * rad, Lm = (218.3165 + 481267.8813 * T) * rad;
  const dPsi = (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * L0 * rad) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * om)) / 3600;
  const dEps = (9.20 * Math.cos(om) + 0.57 * Math.cos(2 * L0 * rad) + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * om)) / 3600;
  const lam = (L0 + C + dPsi - 20.4898 / 3600 / R) * rad;
  const eps = (23 + 26 / 60 + (21.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T) / 3600 + dEps) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const Tu = (JD - 2451545) / 36525;
  const gast = 280.46061837 + 360.98564736629 * (JD - 2451545) + 0.000387933 * Tu * Tu - Tu * Tu * Tu / 38710000 + dPsi * Math.cos(eps);
  const H = norm(gast + lng) * rad - ra, phi = lat * rad;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / rad + 180;
  let alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  alt -= 8.794 / 3600 / R * Math.cos(alt * rad); // 시차
  return { azimuth: norm(az), altitude: alt, H: ((H / rad + 540) % 360) - 180 };
}

// 대기 굴절(표준 대기 10℃ · 1010hPa, Sæmundsson)
const refraction = alt => alt > -1.5 ? 1.02 / Math.tan(rad * (alt + 10.3 / (alt + 5.11))) / 60 : 0;

// 눈에 보이는 해: 굴절 포함
export function sunPosition(date, lat, lng) {
  const s = sunRaw(date, lat, lng);
  return { azimuth: s.azimuth, altitude: s.altitude + refraction(s.altitude) };
}

// 골든아워 = 해 중심 고도 -4°~6°, 블루아워 = -6°~-4°, 일출 · 일몰 = -0.833°(굴절 + 해 반지름)
export function sunTimes(day, lat, lng) {
  const base = new Date(day); base.setHours(12, 0, 0, 0);
  const t0 = base.getTime();
  // 남중: 시간각 0
  let tn = t0;
  for (let i = 0; i < 4; i++) tn -= sunRaw(new Date(tn), lat, lng).H / 360 * 86164000 * (365.2422 / 366.2422);
  const altAt = t => sunRaw(new Date(t), lat, lng).altitude;
  // 고도 h를 지나는 시각: 남중 앞(오르는 쪽) · 뒤(지는 쪽)를 이분법으로
  const cross = (h, dir) => {
    let a = tn, b = tn + dir * 12 * 3600e3;
    if (altAt(a) < h || altAt(b) > h) return null;
    for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (altAt(m) > h) a = m; else b = m; }
    return new Date((a + b) / 2);
  };
  const at = h => [cross(h, -1), cross(h, 1)];
  const [sunrise, sunset] = at(-0.833);
  const [blueStartAm, blueEndPm] = at(-6);
  const [goldenStartAm, goldenEndPm] = at(-4);
  const [goldenEndAm, goldenStartPm] = at(6);
  return { noon: new Date(tn), sunrise, sunset, blueStartAm, blueEndPm, goldenStartAm, goldenEndPm, goldenEndAm, goldenStartPm };
}

export const compassName = az => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(az / 45) % 8];

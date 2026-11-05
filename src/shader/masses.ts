/*
 * `masses@1`: items with a hue and a value (SPEC.md §2, fourth pass), as
 * three kinds of pass the renderer chains:
 *
 *   FIELD   base + masses composited in OKLab (mixing toward each mass by
 *           its falloff × opacity, darkest first), the depth stack in order
 *           (Swirl warps the space; Curve bows it; Parallax; the masses,
 *           Curve, Relief and Strokes make a height field that Light
 *           shades; Haze; Strokes as paint; Shadow), the caption mask,
 *           and the alpha: base alpha where nothing covers, rising to 1
 *           with coverage. Written to a texture as encoded OKLab + alpha.
 *   BLUR    the Finish stage: motion blur (taps along an angle, per-pixel
 *           jittered so banding hides under the grain) or one direction of
 *           a separable Gaussian, each mixed with the unblurred field by
 *           its intensity. Run only when a blur is on.
 *   FINAL   grain on lightness (static from the seed by default), the tonal
 *           clamp, OKLab → sRGB with gamut mapping by chroma reduction,
 *           premultiplied by alpha.
 *
 * Motion is periodic by construction: every mass drifts on a circle with
 * the loop phase plus a seeded offset; the swirl's noise samples the same
 * circle. Raw time reaches the shader only as a frame index for the grain
 * hash, and only when grain is animated.
 *
 * Uniform names match src/shader/massesManifest.ts exactly. The 4D simplex
 * noise is Ashima Arts' webgl-noise (MIT). No GLSL ES reserved words as
 * identifiers (half, filter, ...); compile a change headlessly before it
 * lands (see README).
 */
export const MASSES_ID = 'masses@1' as const

export const VERT = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

/** OKLab packed into a texture's 0..1 range: a and b scaled and offset. */
const ENCODE = /* glsl */ `
vec3 encodeLab(vec3 lab) { return vec3(lab.x, lab.y * 1.25 + 0.5, lab.z * 1.25 + 0.5); }
vec3 decodeLab(vec3 enc) { return vec3(enc.x, (enc.y - 0.5) * 0.8, (enc.z - 0.5) * 0.8); }
`

export const FIELD_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_time;          // seconds, wrapped into the loop
uniform float u_loopSeconds;

uniform vec3  u_base;          // OKLab
uniform float u_baseAlpha;
uniform int   u_massCount;
uniform vec3  u_massLab[4];    // OKLab
uniform vec2  u_massPos[4];    // card units: x 0..aspect, y 0..1, y up
uniform vec4  u_massParams[4]; // size (height units), softness, distance, phase offset
uniform float u_massOpacity[4];
uniform float u_massKind[4];      // 0 blob, 1 ridge
uniform vec2  u_massStart[4];     // a ridge's cubic Bezier: start, two controls, end
uniform vec2  u_massCtrl1[4];
uniform vec2  u_massCtrl2[4];
uniform vec2  u_massEnd[4];
uniform vec3  u_massLabStart[4];  // a ridge's ramp ends; u_massLab is its middle
uniform vec3  u_massLabEnd[4];
uniform float u_massFieldMix[4];  // a ridge's ramp as the field across its chord

uniform float u_light;         // the card's height, 0..1; below zero means off
uniform float u_lightAngle;    // degrees, the light's direction in the plane
uniform float u_lightElevation;// degrees above the surface
uniform float u_lightAmount;   // how far the shade moves L
uniform float u_curve;         // depth amounts; below zero means off
uniform float u_parallax;
uniform float u_haze;
uniform float u_swirl;
uniform float u_swirlScale;    // warp wavelength, card widths (0.6 marbling, 1.2 one fold)
uniform float u_relief;
uniform float u_reliefFreq;    // cycles per card width
uniform float u_reliefTwist;   // degrees
uniform float u_strokes;       // ±L amount; below zero means off
uniform float u_strokesAngle;  // degrees
uniform float u_strokesSize;   // a mark's length, card widths
uniform float u_strokesDensity;// cells per card width
uniform float u_strokesTaper;  // fraction of the length that fades at each end
uniform float u_strokesChaos;  // 0 all one way, 1 up to ±90°
uniform float u_strokesFollow; // lean along the masses' slope
uniform float u_strokesMotion; // 0..1: drift, sway and breathing over the loop
uniform float u_shadow;
uniform vec4  u_shadowRect;    // x, y, w, h as fractions of the card, y from the bottom
uniform float u_shadowOffset;
uniform float u_shadowSpread;

uniform float u_captionMask;   // 0 or 1
uniform float u_captionZone;
uniform float u_driftRadius;
uniform float u_speed;         // revolutions per loop, an integer
uniform float u_angle;         // the family's direction, degrees
uniform float u_exposure;      // added to every mass's L
uniform float u_contrast;      // multiplies every mass's chroma
uniform float u_grainSeed;     // the seed, for the mark grid's hashes

// The Photo stage (SPEC.md §4): the photo's blur pyramid (σ W/6, W/16,
// W/40, W/80), the fractional level the composite samples, how far the
// base leans to the photo, how much the masses still composite, and how
// much the W/16 luminance shapes the height field.
uniform sampler2D u_photoL0;
uniform sampler2D u_photoL1;
uniform sampler2D u_photoL2;
uniform sampler2D u_photoL3;
uniform float u_photoOn;
uniform float u_photoLevel;
uniform float u_photoMix;
uniform float u_photoMassWeight;
uniform float u_photoHeight;
uniform float u_photoChromaCap; // the family's mass chroma cap
uniform vec4  u_photoLo;        // P5 of L per level, after the blur
uniform vec4  u_photoHi;        // P95 of L per level
uniform vec2  u_photoSrc;       // P5 and P95 of the source's L

const float TAU = 6.28318530718;
${ENCODE}

// ---- 4D simplex noise (Ashima Arts, MIT), for the swirl ----------------------
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
float permute(float x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

float snoise(vec4 v) {
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  const float F4 = 0.309016994374947451;
  vec4 i = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
            i.w + vec4(i1.w, i2.w, i3.w, 1.0))
          + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
          + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
          + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));
  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
               + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}

// ---- Helpers ------------------------------------------------------------------
// One pyramid level, 0..3, as OKLab: decoded, its L levelled back to the
// source's P5–P95 (every blur compresses contrast; this is global, so no
// halo), its chroma restored by the boost and capped by the family.
vec3 photoLevel(int i, vec2 uv) {
  vec3 enc;
  float lo, hi;
  if (i <= 0) { enc = texture(u_photoL0, uv).rgb; lo = u_photoLo.x; hi = u_photoHi.x; }
  else if (i == 1) { enc = texture(u_photoL1, uv).rgb; lo = u_photoLo.y; hi = u_photoHi.y; }
  else if (i == 2) { enc = texture(u_photoL2, uv).rgb; lo = u_photoLo.z; hi = u_photoHi.z; }
  else { enc = texture(u_photoL3, uv).rgb; lo = u_photoLo.w; hi = u_photoHi.w; }
  vec3 lab = decodeLab(enc);
  lab.x = u_photoSrc.x + (lab.x - lo) / max(hi - lo, 0.01) * (u_photoSrc.y - u_photoSrc.x);
  float C = length(lab.yz);
  if (C > 1e-5) lab.yz *= min(C * 1.3, u_photoChromaCap) / C;
  return lab;
}
vec3 photoAt(float level, vec2 uv) {
  float lv = clamp(level, 0.0, 3.0);
  int lo = int(floor(lv));
  float t = lv - float(lo);
  vec3 a = photoLevel(lo, uv);
  if (t < 0.001) return a;
  return mix(a, photoLevel(lo + 1, uv), t);
}

vec2 rotate(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * v;
}

// Swirl: two octaves of low-frequency noise on the loop's circle, as a
// vector field the mass coordinates are dragged along. k sets the
// wavelength: 1.1 is the marbling; smaller, one slow fold.
vec2 swirlOffset(vec2 p, vec2 loop, float k) {
  float a = snoise(vec4(p * k, loop)) + 0.5 * snoise(vec4(p * k * 2.0 + 7.0, loop * 1.5));
  float b = snoise(vec4(p * k + 31.0, loop)) + 0.5 * snoise(vec4(p * k * 2.0 + 53.0, loop * 1.5));
  return vec2(a, b) / 1.5;
}

// Relief: two wavefronts a few degrees apart; their beat is the pleats,
// which ridge the height field (the Light layer shades them).
float pleat(vec2 p, float phase, float aspect) {
  float k = u_reliefFreq * TAU / aspect;
  float a0 = radians(u_angle);
  vec2 d1 = vec2(cos(a0), sin(a0));
  vec2 d2 = rotate(d1, radians(u_reliefTwist));
  return sin(dot(p, d1) * k + phase) * sin(dot(p, d2) * k * 1.07 - phase);
}

vec2 pleatGrad(vec2 p, float phase, float aspect) {
  float eps = 0.001;
  float dx = (pleat(p + vec2(eps, 0.0), phase, aspect) - pleat(p - vec2(eps, 0.0), phase, aspect)) / (2.0 * eps);
  float dy = (pleat(p + vec2(0.0, eps), phase, aspect) - pleat(p - vec2(0.0, eps), phase, aspect)) / (2.0 * eps);
  return vec2(dx, dy);
}

// Strokes ("painted grass"): fine noise stretched hard along one
// direction, the way a dry brush or a long exposure draws fibres. The
// warp is a low-frequency wave, sampled once and shared by the taps that
// take the gradient, so the fibres undulate together.
// Brush grain inside a mark: fine noise stretched along the mark's axis,
// in the mark's own frame. The along axis runs round a circle in two noise
// dimensions, so a drift of whole periods per loop lands where it began.
const float STROKE_PERIOD = 0.5;
float strokeFibres(float along, float across, float width) {
  // Six or so fibres across a mark, stretched ~30:1.
  float acrossK = 6.0 / max(width, 1e-3);
  float alongK = acrossK / 30.0;
  float theta = along * TAU / STROKE_PERIOD;
  float r1 = STROKE_PERIOD * alongK / TAU;
  vec2 c = vec2(cos(theta), sin(theta));
  float n = snoise(vec4(c * r1, across * acrossK, 9.0))
          + 0.35 * snoise(vec4(c * r1 * 2.1 + 7.0, across * acrossK * 2.1, 13.0));
  return n / 1.35;
}

// Hashes for the mark grid: four numbers in 0..1 per cell, stable per seed.
vec4 hash4(vec2 cell) {
  vec4 p = fract(vec4(cell.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099) + u_grainSeed * 0.001);
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw) * p.zywx);
}


vec2 cubicAt(vec2 P0, vec2 C1, vec2 C2, vec2 P3, float t) {
  float u = 1.0 - t;
  return u * u * u * P0 + 3.0 * u * u * t * C1 + 3.0 * u * t * t * C2 + t * t * t * P3;
}

float roundedBox(vec2 q, vec2 halfSize, float r) {
  vec2 d = abs(q) - halfSize + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = v_uv * vec2(aspect, 1.0);
  float phase = TAU * u_time / u_loopSeconds * u_speed;
  vec2 circle = vec2(cos(phase), sin(phase));

  // Swirl: the space the masses live in, dragged a little.
  vec2 q = p;
  // Its noise samples the same loop circle, with a radius that grows with
  // the drift, so the marbling moves with the masses rather than hanging.
  // The scale sets the wavelength, and the drag grows with it: a long
  // slow wave at the marbling's amplitude would be no fold at all.
  if (u_swirl >= 0.0) {
    vec2 loop = circle * (0.3 + 3.0 * u_driftRadius) + 3.0;
    float scale = max(u_swirlScale, 0.1);
    q += swirlOffset(p, loop, 0.66 / scale) * u_swirl * scale;
  }

  // Curve: a gently bowed sheet. The metric stretches toward the edges, so
  // a mass's falloff tightens there. The sheet's fall-away is in the
  // height field now, where the Light shades it; the old darkening of the
  // edges fades out as the height rises, so a flat card still looks as
  // it did and a tall one is lit instead of dimmed.
  vec2 fromCentre = q - vec2(aspect * 0.5, 0.5);
  float edge = dot(fromCentre, fromCentre);
  float curve = max(u_curve, 0.0);
  float bow = 1.0 + curve * edge * 1.2;
  float height = clamp(u_light, 0.0, 2.0);
  float tilt = 1.0 - curve * 0.35 * clamp(edge, 0.0, 1.0) * (1.0 - min(height, 1.0));

  // The height field h: light masses rise, dark ones sink, Curve bows it,
  // Relief and Strokes ridge it. Only its gradient is needed; the masses'
  // comes from the falloff's own derivative, the ridges' from taps. The
  // bow is a dome that is flat at the centre and falls away at the
  // edges (h = -curve * edge^2 / 2), so it never reads as one tilt
  // across the whole card.
  vec2 gradMass = -curve * 2.0 * edge * fromCentre;

  // The photo under everything: its colour at the sampled level leans the
  // base toward it; its W/16 luminance adds to the height field; its
  // gradient is what strokes follow. The sample is static over the loop.
  vec3 base = u_base;
  vec2 gradPhoto = vec2(0.0);
  if (u_photoOn > 0.5) {
    vec3 photoLab = photoAt(u_photoLevel, v_uv);
    base = mix(u_base, photoLab, u_photoMix);
    // The luminance that shapes the field: W/10 at low fidelity, W/22 above.
    int hl = u_photoLevel < 0.5 ? 0 : 1;
    vec2 eps = vec2(2.0 / u_resolution.x, 2.0 / u_resolution.y);
    float lx1 = photoLevel(hl, v_uv + vec2(eps.x, 0.0)).x;
    float lx0 = photoLevel(hl, v_uv - vec2(eps.x, 0.0)).x;
    float ly1 = photoLevel(hl, v_uv + vec2(0.0, eps.y)).x;
    float ly0 = photoLevel(hl, v_uv - vec2(0.0, eps.y)).x;
    // Per unit of p: uv.x spans aspect units, uv.y one.
    gradPhoto = vec2((lx1 - lx0) / (2.0 * eps.x * aspect), (ly1 - ly0) / (2.0 * eps.y));
    gradMass += gradPhoto * u_photoHeight;
  }

  vec3 lab = base;
  vec3 labLow = base;     // the field without the pleats, for the caption mask
  float uncovered = 1.0;  // what no mass has reached, for the alpha
  float nearestLight = 1e9;
  float nearestF = 0.0;
  // The nearest mass of any kind: on a light base no mass is "light", and
  // the pleats still need an edge to live on.
  float nearestAny = 1e9;
  float nearestAnyF = 0.0;

  for (int i = 0; i < 4; i++) {
    if (i >= u_massCount) break;
    vec4 prm = u_massParams[i];   // size, softness, distance, phase offset

    // Parallax: nearer masses drift more. Off, every mass drifts the same.
    float r = u_driftRadius * (u_parallax >= 0.0 ? u_parallax * (1.0 - prm.z) : 1.0);
    vec2 c = u_massPos[i] + r * vec2(cos(phase + prm.w), sin(phase + prm.w));

    vec2 d;
    float dist;
    vec3 M;
    if (u_massKind[i] > 0.5) {
      // A ridge: the nearest point on the cubic Bezier (32 samples of t,
      // then a ternary refinement so neither the distance nor the ramp
      // steps from sample to sample), and the ramp's colour there. The
      // whole curve drifts with the mass's anchor.
      vec2 drift = c - u_massPos[i];
      vec2 P0 = u_massStart[i] + drift;
      vec2 C1 = u_massCtrl1[i] + drift;
      vec2 C2 = u_massCtrl2[i] + drift;
      vec2 P3 = u_massEnd[i] + drift;
      float best = 1e9;
      float bestT = 0.0;
      vec2 bestP = c;
      for (int s = 0; s <= 32; s++) {
        float t = float(s) / 32.0;
        vec2 B = cubicAt(P0, C1, C2, P3, t);
        vec2 dd = (q - B) * bow;
        float dl = dot(dd, dd);
        if (dl < best) { best = dl; bestT = t; bestP = B; }
      }
      float lo = max(bestT - 1.0 / 32.0, 0.0), hi = min(bestT + 1.0 / 32.0, 1.0);
      for (int s = 0; s < 8; s++) {
        float t1 = mix(lo, hi, 1.0 / 3.0), t2 = mix(lo, hi, 2.0 / 3.0);
        vec2 d1 = (q - cubicAt(P0, C1, C2, P3, t1)) * bow, d2 = (q - cubicAt(P0, C1, C2, P3, t2)) * bow;
        if (dot(d1, d1) < dot(d2, d2)) hi = t2; else lo = t1;
      }
      bestT = 0.5 * (lo + hi);
      bestP = cubicAt(P0, C1, C2, P3, bestT);
      d = (q - bestP) * bow;
      dist = max(length(d), 1e-6);
      // The ramp as the field (the reference's gold fills one side and
      // indigo the other, the crest where they meet): the base leans
      // toward the ramp sampled along the start→end chord.
      float fm = u_massFieldMix[i];
      if (fm > 0.0) {
        vec2 chord = P3 - P0;
        float tc = clamp(dot(q - P0, chord) / max(dot(chord, chord), 1e-6), 0.0, 1.0);
        vec3 F = tc < 0.5 ? mix(u_massLabStart[i], u_massLab[i], tc * 2.0)
                          : mix(u_massLab[i], u_massLabEnd[i], (tc - 0.5) * 2.0);
        F.x += u_exposure;
        F.yz *= u_contrast;
        lab = mix(lab, F, fm);
        labLow = mix(labLow, F, fm);
      }
      M = bestT < 0.5 ? mix(u_massLabStart[i], u_massLab[i], bestT * 2.0)
                      : mix(u_massLab[i], u_massLabEnd[i], (bestT - 0.5) * 2.0);
    } else {
      d = (q - c) * bow;
      dist = length(d);
      M = u_massLab[i];
    }
    // A plateau, not a point: the mass holds its own colour over a core a
    // quarter of its size, then falls off with an exponent the softness
    // shapes (0.4 is a firm block, 0.9 a long tail).
    float k = mix(4.0, 1.6, clamp((prm.y - 0.4) / 0.5, 0.0, 1.0));
    float u = max(dist - 0.25 * prm.x, 0.0) / prm.x;
    float f0 = exp(-0.5 * pow(u, k)) * u_massOpacity[i];
    float f = f0 * tilt * u_photoMassWeight;

    M.x += u_exposure;
    M.yz *= u_contrast;
    bool light = M.x > base.x;

    // The height has its own profile: a wide, smooth bell with no plateau
    // (the colour's mesa, lit, read as an embossed button with a dark rim;
    // the references' hills are domes). Its slope is gentle, continuous,
    // and strongest part way out. Analytic, pointing away from the centre.
    if (dist > 1e-5) {
      float w = prm.x * 1.1;
      float bell = exp(-(dist * dist) / (w * w)) * u_massOpacity[i];
      float dhdd = bell * (-2.0 * dist / (w * w)) * bow;
      // A ridge is a fold: it always rises, whatever its colour, so the
      // light finds a crest with a lit upper edge and a shadowed underside.
      bool lifts = light || u_massKind[i] > 0.5;
      gradMass += (lifts ? 1.0 : -1.0) * dhdd * (d / dist);
    }

    // Composite by mixing toward the mass, in order: a dark mass over a
    // light one reads as shadow, not as a brighter blob.
    lab = mix(lab, M, f);
    labLow = mix(labLow, M, f);
    uncovered *= 1.0 - f;

    if (light && dist / prm.x < nearestLight) {
      nearestLight = dist / prm.x;
      nearestF = f;
    }
    if (dist / prm.x < nearestAny) {
      nearestAny = dist / prm.x;
      nearestAnyF = f;
    }
  }

  // Strokes (painted, not dragged): a jittered grid of finite brush marks,
  // one per cell, each a tapered capsule with its own angle (direction,
  // scattered by chaos, leaned along the masses by follow), length, width
  // and lightness, with the fibre grain running along its own axis. The
  // 3×3 neighbouring cells overlap; a soft-max toward the nearest mark
  // reads as paint on paint. Motion is periodic: each mark drifts on a
  // small circle with its own phase, breathes, and sways a little.
  float marks = 0.0;           // ±L from the marks, already weighted
  float markCover = 0.0;       // how much the strongest mark covers here
  float markAngle = 0.0;       // the strongest mark's angle, for the Finish blur
  vec2 gradStrokes = vec2(0.0);
  if (u_strokes >= 0.0) {
    float sa = radians(u_strokesAngle);
    vec2 dirA = vec2(cos(sa), sin(sa));
    // The masses' slope, for marks that follow the form.
    vec2 alongField = dirA;
    float followW = 0.0;
    // With a photo, marks follow the photo's own luminance gradient
    // instead of the masses' slope.
    vec2 slope = u_photoOn > 0.5 ? gradPhoto : gradMass;
    float gl = length(slope);
    if (u_strokesFollow > 0.0 && gl > 1e-4) {
      alongField = vec2(-slope.y, slope.x) / gl;
      if (dot(alongField, dirA) < 0.0) alongField = -alongField;
      followW = u_strokesFollow * smoothstep(0.0, 0.3, gl);
    }
    float mo = u_strokesMotion;
    float loopT = u_time / u_loopSeconds;
    float cell = aspect / max(u_strokesDensity, 1.0);
    float sizeU = u_strokesSize * aspect;
    vec2 gi = floor(q / cell);
    float sumW = 0.0;
    float sumV = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 id = gi + vec2(float(dx), float(dy));
        vec4 h = hash4(id);
        vec4 h2 = hash4(id + 17.0);
        float phase = loopT * TAU + h2.w * TAU;
        vec2 centre = (id + 0.5 + (h.xy - 0.5) * 0.8) * cell
                    + mo * 0.12 * cell * vec2(cos(phase), sin(phase));
        float ang = sa + u_strokesChaos * 1.5707963 * (h.z * 2.0 - 1.0) + mo * 0.08 * sin(phase);
        vec2 dir = vec2(cos(ang), sin(ang));
        dir = normalize(mix(dir, alongField, followW));
        vec2 perp = vec2(-dir.y, dir.x);
        float len = sizeU * (0.7 + 0.6 * h.w);
        float wid = sizeU * 0.12 * (0.8 + 0.4 * h2.x);
        vec2 rel = q - centre;
        float a = dot(rel, dir);
        float b = dot(rel, perp);
        float alongN = abs(a) / (0.5 * len);
        float acrossN = abs(b) / (0.5 * wid);
        if (alongN > 1.0 || acrossN > 1.0) continue;
        // A capsule: smooth taper over the last part of the length, soft
        // edge across the width.
        float taper = 1.0 - smoothstep(1.0 - max(u_strokesTaper, 0.01), 1.0, alongN);
        float edge = 1.0 - smoothstep(0.55, 1.0, acrossN);
        float cover = taper * edge;
        if (cover < 0.01) continue;
        // The grain, only inside the mark (the cost), along its axis.
        float drift = loopT * STROKE_PERIOD * floor(mo * 2.0 + 0.5);
        float fib = strokeFibres(a + drift + h2.y * 3.0, b, wid);
        float breathe = 1.0 - 0.25 * mo * (0.5 + 0.5 * cos(phase));
        float tone = (h2.z * 2.0 - 1.0 + 0.15) * breathe;
        float v = (tone * (0.75 + 0.25 * fib) + 0.5 * fib) * cover;
        float w = cover * cover * cover;
        sumV += v * w;
        sumW += w;
        if (cover > markCover) {
          markCover = cover;
          markAngle = atan(dir.y, dir.x);
          // The mark's edge as a ridge: the across edge's slope, outward.
          float t = clamp((acrossN - 0.55) / 0.45, 0.0, 1.0);
          float dEdge = -6.0 * t * (1.0 - t) / 0.45 / (0.5 * wid);
          gradStrokes = perp * sign(b) * dEdge * taper * 0.0025 * (u_strokes / 0.018);
        }
      }
    }
    if (sumW > 0.0) marks = sumV / sumW;
  }

  // Relief: the pleats live at the edge of the nearest light mass, where
  // 4f(1−f) peaks, and vanish in its core and in the flat (Polar). With no
  // light mass (a light base), the nearest mass of any kind gives the edge.
  vec2 gradRelief = vec2(0.0);
  if (u_relief >= 0.0 && nearestAny < 1e8) {
    float fEdge = nearestLight < 1e8 ? nearestF : nearestAnyF;
    float edgeWeight = 4.0 * fEdge * (1.0 - fEdge);
    float ridge = aspect / max(u_reliefFreq * TAU, 1.0);
    gradRelief = pleatGrad(q, phase, aspect) * ridge * edgeWeight * u_relief * 2.5;
  }

  // Light: one directional light shades the field's normal, with a
  // wrapped Lambert so the far side dims rather than blacks out. A flat
  // surface shades to exactly nothing, so height 0 is the card as it was.
  if (u_light >= 0.0) {
    float H = height * 1.5;
    // Over a photo the light's angle breathes ±2° on the loop (the photo
    // itself never moves).
    float az = radians(u_lightAngle + (u_photoOn > 0.5 ? 2.0 * sin(phase) : 0.0)), el = radians(u_lightElevation);
    vec3 L = vec3(cos(az) * cos(el), sin(az) * cos(el), sin(el));
    float level = 0.5 + 0.5 * sin(el);   // what a flat surface shades to
    vec3 n = normalize(vec3(-(gradMass + gradRelief - gradStrokes) * H, 1.0));
    vec3 nLow = normalize(vec3(-gradMass * H, 1.0));
    // The underside goes a tenth deeper than the lip goes brighter.
    float shade = 0.5 + 0.5 * dot(n, L) - level;
    float shadeLow = 0.5 + 0.5 * dot(nLow, L) - level;
    lab.x += shade * u_lightAmount * (shade < 0.0 ? 1.1 : 1.0);
    labLow.x += shadeLow * u_lightAmount * (shadeLow < 0.0 ? 1.1 : 1.0);
  }

  // Haze: the side far from any light mass sinks toward the base.
  if (u_haze >= 0.0 && nearestLight < 1e8) {
    float h = u_haze * clamp((nearestLight - 1.0) * 0.5, 0.0, 1.0);
    lab = mix(lab, base, h);
    labLow = mix(labLow, base, h);
  }

  // Strokes as paint: each mark's own tone and grain, a little more lighten
  // than darken, as a loaded brush leaves.
  if (u_strokes >= 0.0) lab.x += marks * u_strokes * 2.0 * (marks > 0.0 ? 1.15 : 0.85);

  // Shadow: a pooled soft shadow where the UI layer will sit, offset down.
  if (u_shadow >= 0.0) {
    vec4 rc = u_shadowRect * vec4(aspect, 1.0, aspect, 1.0);
    vec2 halfSize = rc.zw * 0.5;
    vec2 centre = rc.xy + halfSize - vec2(0.0, u_shadowOffset);
    float sd = roundedBox(p - centre, halfSize, 0.04);
    float s = 1.0 - smoothstep(-u_shadowSpread * 0.5, u_shadowSpread, sd);
    vec3 pool = vec3(lab.x * 0.75, lab.yz);
    lab = mix(lab, pool, u_shadow * s);
    labLow = mix(labLow, vec3(labLow.x * 0.75, labLow.yz), u_shadow * s);
  }

  // Caption mask: the bottom band leans, weakly, toward the pleat-free field.
  float band = 1.0 - smoothstep(u_captionZone - 0.18, u_captionZone + 0.18, v_uv.y);
  lab = mix(lab, labLow, u_captionMask * band * 0.5);

  // Alpha: the base's own where nothing covers, full under the masses.
  float alpha = mix(1.0, u_baseAlpha, uncovered);
  // With marks on, the alpha carries the local mark angle for the Finish
  // blur (every card is opaque; the Final pass knows to read it as 1).
  if (u_strokes >= 0.0) alpha = markAngle / TAU + 0.5;
  fragColor = vec4(encodeLab(lab), alpha);
}`

export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;       // the image to blur
uniform sampler2D u_orig;      // the unblurred image the result mixes with
uniform vec2  u_texel;         // 1 / size of u_src
uniform vec2  u_dir;           // unit direction of this pass
uniform float u_lengthPx;      // motion: total streak length in pixels
uniform float u_sigmaPx;       // gaussian: sigma in pixels
uniform int   u_mode;          // 0 motion, 1 gaussian
uniform float u_intensity;
uniform float u_seed;
uniform float u_strokesOn;     // 1: u_src's alpha is each pixel's mark angle

const int MOTION_TAPS = 20;
const int GAUSS_TAPS = 24;     // each side

float hash(vec2 p, float seed) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + seed * 0.013);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec4 orig = texture(u_orig, v_uv);
  vec4 sum = vec4(0.0);
  if (u_mode == 0) {
    // Taps spread along the streak, each pixel's set shifted by a random
    // fraction of a step so the banding of a short tap count hides under
    // the grain instead of reading as ghost edges.
    float jitter = hash(gl_FragCoord.xy, u_seed) - 0.5;
    // Along the mark under this pixel when marks are on, so each blade is
    // smeared along itself.
    vec2 dir = u_dir;
    if (u_strokesOn > 0.5) {
      float ang = (orig.a - 0.5) * 6.28318530718;
      dir = vec2(cos(ang), sin(ang));
    }
    for (int i = 0; i < MOTION_TAPS; i++) {
      float t = (float(i) + 0.5 + jitter) / float(MOTION_TAPS) - 0.5;
      sum += texture(u_src, v_uv + dir * u_texel * u_lengthPx * t);
    }
    sum /= float(MOTION_TAPS);
  } else {
    // One direction of a separable Gaussian, out to three sigma, strided
    // so a wide radius still fits the tap budget.
    float stride = max(3.0 * u_sigmaPx / float(GAUSS_TAPS), 1.0);
    float norm = 0.0;
    for (int i = -GAUSS_TAPS; i <= GAUSS_TAPS; i++) {
      float x = float(i) * stride;
      float w = exp(-0.5 * x * x / max(u_sigmaPx * u_sigmaPx, 1e-4));
      sum += texture(u_src, v_uv + u_dir * u_texel * x) * w;
      norm += w;
    }
    sum /= norm;
  }
  fragColor = mix(orig, sum, u_intensity);
}`

export const FINAL_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;       // encoded OKLab + alpha
uniform float u_frame;         // floor(u_time * fps), for animated grain
uniform float u_grain;
uniform float u_grainSeed;
uniform float u_grainAnimate;
uniform float u_strokesOn;     // 1: the alpha channel carried a mark angle, not alpha

const float L_MIN = 0.12;
const float L_MAX = 0.97;
${ENCODE}

vec3 labToLinear(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

bool inGamut(vec3 c) {
  return all(greaterThanEqual(c, vec3(-0.0005))) && all(lessThanEqual(c, vec3(1.0005)));
}

vec3 toGamma(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

// Chroma is pulled in until the colour fits, holding lightness and hue.
vec3 labToSrgb(vec3 lab) {
  vec3 rgb = labToLinear(lab);
  if (!inGamut(rgb)) {
    float lo = 0.0, hi = 1.0;
    for (int i = 0; i < 8; i++) {
      float mid = 0.5 * (lo + hi);
      if (inGamut(labToLinear(vec3(lab.x, lab.yz * mid)))) lo = mid; else hi = mid;
    }
    rgb = labToLinear(vec3(lab.x, lab.yz * lo));
  }
  return toGamma(clamp(rgb, 0.0, 1.0));
}

float hash(vec2 p, float frame) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + frame * 0.013);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  vec3 lab = decodeLab(src.rgb);

  // Grain: film, peaking in the mids. Static by default (the seed fixes
  // it, which also compresses far better on export); animated grain is
  // held for two frames so it reads as film rather than sparkle.
  float frame = u_grainAnimate > 0.5 ? floor(u_frame / 2.0) : u_grainSeed;
  float g = hash(gl_FragCoord.xy, frame) - 0.5;
  float Lc = clamp(lab.x, 0.0, 1.0);
  lab.x += g * u_grain * 4.0 * Lc * (1.0 - Lc);

  // Tonal rules: neither black holes nor blown whites.
  lab.x = clamp(lab.x, L_MIN, L_MAX);

  float alpha = u_strokesOn > 0.5 ? 1.0 : clamp(src.a, 0.0, 1.0);
  fragColor = vec4(labToSrgb(lab) * alpha, alpha);
}`

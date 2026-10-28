/*
 * `masses@1`: items with a hue and a value (SPEC.md §2, fourth pass), as
 * three kinds of pass the renderer chains:
 *
 *   FIELD   base + masses composited in OKLab (mixing toward each mass by
 *           its falloff × opacity, darkest first), the depth stack in order
 *           (Curve, Parallax, Haze, Swirl, Relief, Grid, Shadow), the
 *           caption mask, and the alpha: base alpha where nothing covers,
 *           rising to 1 with coverage. Written to a texture as encoded
 *           OKLab + alpha.
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

uniform float u_curve;         // depth amounts; below zero means off
uniform float u_parallax;
uniform float u_haze;
uniform float u_swirl;
uniform float u_relief;
uniform float u_reliefFreq;    // cycles per card width
uniform float u_reliefTwist;   // degrees
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
vec2 rotate(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * v;
}

// Swirl: two octaves of low-frequency noise on the loop's circle, as a
// vector field the mass coordinates are dragged along.
vec2 swirlOffset(vec2 p, vec2 loop) {
  float a = snoise(vec4(p * 1.1, loop)) + 0.5 * snoise(vec4(p * 2.2 + 7.0, loop * 1.5));
  float b = snoise(vec4(p * 1.1 + 31.0, loop)) + 0.5 * snoise(vec4(p * 2.2 + 53.0, loop * 1.5));
  return vec2(a, b) / 1.5;
}

// Relief: two wavefronts a few degrees apart; their beat is the pleats.
float pleat(vec2 p, float phase, float aspect) {
  float k = u_reliefFreq * TAU / aspect;
  float a0 = radians(u_angle);
  vec2 d1 = vec2(cos(a0), sin(a0));
  vec2 d2 = rotate(d1, radians(u_reliefTwist));
  return sin(dot(p, d1) * k + phase) * sin(dot(p, d2) * k * 1.07 - phase);
}

vec3 pleatNormal(vec2 p, float phase, float aspect) {
  float eps = 0.001;
  float height = 0.6 * aspect / max(u_reliefFreq * TAU, 1.0);
  float dx = (pleat(p + vec2(eps, 0.0), phase, aspect) - pleat(p - vec2(eps, 0.0), phase, aspect)) / (2.0 * eps);
  float dy = (pleat(p + vec2(0.0, eps), phase, aspect) - pleat(p - vec2(0.0, eps), phase, aspect)) / (2.0 * eps);
  return normalize(vec3(-dx * height, -dy * height, 1.0));
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
  if (u_swirl >= 0.0) {
    vec2 loop = circle * 0.6 + 3.0;
    q += swirlOffset(p, loop) * u_swirl * 0.6;
  }

  // Curve: a gently bowed sheet. The metric stretches toward the edges, so
  // a mass's falloff tightens there, and the sheet turns away from it.
  vec2 fromCentre = q - vec2(aspect * 0.5, 0.5);
  float edge = dot(fromCentre, fromCentre);
  float curve = max(u_curve, 0.0);
  float bow = 1.0 + curve * edge * 1.2;
  float tilt = 1.0 - curve * 0.35 * clamp(edge, 0.0, 1.0);

  vec3 n = u_relief >= 0.0 ? pleatNormal(q, phase, aspect) : vec3(0.0, 0.0, 1.0);

  vec3 lab = u_base;
  vec3 labLow = u_base;   // the field without the pleats, for the caption mask
  float uncovered = 1.0;  // what no mass has reached, for the alpha
  float nearestLight = 1e9;
  float nearestF = 0.0;
  vec2 nearestDir = vec2(0.0, 1.0);
  // The nearest mass of any kind: on a light base no mass is "light", and
  // the pleats still need something to be lit by.
  float nearestAny = 1e9;
  float nearestAnyF = 0.0;
  vec2 nearestAnyDir = vec2(0.0, 1.0);

  for (int i = 0; i < 4; i++) {
    if (i >= u_massCount) break;
    vec4 prm = u_massParams[i];   // size, softness, distance, phase offset

    // Parallax: nearer masses drift more. Off, every mass drifts the same.
    float r = u_driftRadius * (u_parallax >= 0.0 ? u_parallax * (1.0 - prm.z) : 1.0);
    vec2 c = u_massPos[i] + r * vec2(cos(phase + prm.w), sin(phase + prm.w));

    vec2 d = (q - c) * bow;
    float dist = length(d);
    // A plateau, not a point: the mass holds its own colour over a core a
    // quarter of its size, then falls off with an exponent the softness
    // shapes (0.4 is a firm block, 0.9 a long tail).
    float k = mix(4.0, 1.6, clamp((prm.y - 0.4) / 0.5, 0.0, 1.0));
    float f = exp(-0.5 * pow(max(dist - 0.25 * prm.x, 0.0) / prm.x, k)) * tilt * u_massOpacity[i];

    vec3 M = u_massLab[i];
    M.x += u_exposure;
    M.yz *= u_contrast;
    bool light = M.x > u_base.x;

    // Composite by mixing toward the mass, in order: a dark mass over a
    // light one reads as shadow, not as a brighter blob.
    lab = mix(lab, M, f);
    labLow = mix(labLow, M, f);
    uncovered *= 1.0 - f;

    if (light && dist / prm.x < nearestLight) {
      nearestLight = dist / prm.x;
      nearestF = f;
      nearestDir = normalize(c - q);
    }
    if (dist / prm.x < nearestAny) {
      nearestAny = dist / prm.x;
      nearestAnyF = f;
      nearestAnyDir = normalize(c - q);
    }
  }

  // Haze: the side far from any light mass sinks toward the base.
  if (u_haze >= 0.0 && nearestLight < 1e8) {
    float h = u_haze * clamp((nearestLight - 1.0) * 0.5, 0.0, 1.0);
    lab = mix(lab, u_base, h);
    labLow = mix(labLow, u_base, h);
  }

  // Relief: the pleats live at the edge of the nearest light mass, where
  // 4f(1−f) peaks, and vanish in its core and in the flat (Polar). With no
  // light mass (a light base), the nearest mass of any kind lights them.
  if (u_relief >= 0.0 && nearestAny < 1e8) {
    bool haveLight = nearestLight < 1e8;
    float fEdge = haveLight ? nearestF : nearestAnyF;
    vec2 dir = haveLight ? nearestDir : nearestAnyDir;
    float edgeWeight = 4.0 * fEdge * (1.0 - fEdge);
    lab.x += dot(n.xy, dir) * edgeWeight * u_relief * 0.8;
  }

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
    for (int i = 0; i < MOTION_TAPS; i++) {
      float t = (float(i) + 0.5 + jitter) / float(MOTION_TAPS) - 0.5;
      sum += texture(u_src, v_uv + u_dir * u_texel * u_lengthPx * t);
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

  float alpha = clamp(src.a, 0.0, 1.0);
  fragColor = vec4(labToSrgb(lab) * alpha, alpha);
}`

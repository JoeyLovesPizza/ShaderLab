import { labToOklch, srgbToOklab } from '../palette/ramp'
import { L_MAX, L_MIN, blobMass, type BaseColor, type Family, type Mass } from './types'

/*
 * Extraction (SPEC.md §4, Photo stage; the Critic's numbers): a starting
 * palette and layout pulled from the photo. k-means with k = 5 in OKLab
 * over a small, soft downsample (the W/22 level, near enough). The
 * cluster with the most area and the least lightness becomes the base;
 * of the rest, up to three are kept by contrast with what is already
 * chosen (pickMasses, below), each a mass at its region's
 * centroid, sized by its area, chroma ×1.4 capped at 0.18, L in 0.2–0.9.
 * An editable starting point the caller dirty-marks, so a shuffle does
 * not roll it away.
 */

const K = 5
const KEEP = 3
const ITERATIONS = 20
const MASS_CHROMA_BOOST = 1.4
const MASS_CHROMA_CAP = 0.18
const MASS_L = [0.2, 0.9] as const

export interface Extraction {
  base: BaseColor
  masses: Mass[]
}

interface Cluster {
  lab: [number, number, number]
  count: number
  cx: number
  cy: number
  /** Mean squared distance from the centroid, in frame-height units. */
  spread: number
}

/** `pixels` is RGBA, `width` × `height`, already small and soft. */
export function extractPalette(pixels: Uint8ClampedArray, width: number, height: number, family: Family, aspect: number): Extraction {
  const labs: [number, number, number][] = []
  for (let i = 0; i < pixels.length; i += 4) {
    labs.push(srgbToOklab([pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255]))
  }
  // Seeds spread over lightness, so the five start apart.
  const sorted = [...labs].sort((a, b) => a[0] - b[0])
  let centres: [number, number, number][] = [0.1, 0.3, 0.5, 0.7, 0.9].map((q) => [...sorted[Math.floor(q * (sorted.length - 1))]])
  let assign = new Int32Array(labs.length)
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < labs.length; i++) {
      let best = 0
      let bestD = Infinity
      for (let k = 0; k < K; k++) {
        const c = centres[k]
        const d = (labs[i][0] - c[0]) ** 2 + (labs[i][1] - c[1]) ** 2 + (labs[i][2] - c[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = k
        }
      }
      assign[i] = best
    }
    const sums = centres.map(() => [0, 0, 0, 0])
    for (let i = 0; i < labs.length; i++) {
      const s = sums[assign[i]]
      s[0] += labs[i][0]
      s[1] += labs[i][1]
      s[2] += labs[i][2]
      s[3] += 1
    }
    centres = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[k]))
  }
  const clusters: Cluster[] = centres.map((lab) => ({ lab, count: 0, cx: 0, cy: 0, spread: 0 }))
  for (let i = 0; i < labs.length; i++) {
    const c = clusters[assign[i]]
    c.count += 1
    c.cx += i % width
    c.cy += Math.floor(i / width)
  }
  for (const c of clusters) {
    if (c.count) {
      c.cx /= c.count
      c.cy /= c.count
    }
  }
  for (let i = 0; i < labs.length; i++) {
    const c = clusters[assign[i]]
    c.spread += ((i % width) - c.cx) ** 2 + (Math.floor(i / width) - c.cy) ** 2
  }
  for (const c of clusters) {
    if (c.count) c.spread /= c.count * height * height
  }
  const total = labs.length
  const live = clusters.filter((c) => c.count > 0)
  // The base: the most area and the least light, in one score, among the
  // clusters that cover a real share of the photo (a sliver of black at
  // an edge must not become the base).
  const broad = live.filter((c) => c.count / total >= 0.1)
  const baseCluster = (broad.length ? broad : live).reduce((a, b) => (score(a, total) >= score(b, total) ? a : b))
  const others = pickMasses(
    live.filter((c) => c !== baseCluster),
    baseCluster,
    total,
  )

  const colour = (lab: [number, number, number], chromaMax: number, boost = 1, L = [L_MIN, L_MAX] as readonly [number, number]) => {
    const [hue, Lx, C] = labToOklch(lab)
    return { hue: Math.round(hue * 10) / 10, value: clamp(Lx, L[0], L[1]), chroma: Number(Math.min(C * boost, chromaMax).toFixed(4)) }
  }
  const base: BaseColor = { ...colour(baseCluster.lab, family.base.chromaMax), locked: false }
  const masses = others.map((c, i) => {
    const area = c.count / total
    return blobMass({
      ...colour(c.lab, Math.min(MASS_CHROMA_CAP, family.masses.chromaMax), MASS_CHROMA_BOOST, MASS_L),
      x: round2((c.cx / width) * aspect),
      y: round2(1 - c.cy / height),
      size: round2(clamp(Math.sqrt(area) * 0.9 * compactness(c, area, aspect) ** 2, 0.2, 1.2)),
      softness: 0.7,
      distance: i === 0 ? 0.4 : 0.7,
      locked: false,
    })
  })
  return { base, masses }
}

/*
 * Masses are picked one at a time. Each candidate scores √area × its OKLab
 * distance to the nearest colour already chosen (the base, then each kept
 * mass) × (0.3 + 4·C). Area alone let one white that covers most of the
 * frame split into three near-identical whites that buried the base (the
 * daisies at fidelity 0.2 and 0.5); measured against what is already on
 * the card, the second white is worth almost nothing and the yellow
 * centres win. A candidate closer than MIN_DISTANCE to a chosen colour is
 * dropped, so a flat photo gets fewer masses rather than repeats.
 */
const MIN_DISTANCE = 0.05

function pickMasses(candidates: Cluster[], base: Cluster, total: number): Cluster[] {
  const chosen = [base]
  const picked: Cluster[] = []
  const pool = [...candidates]
  while (picked.length < KEEP && pool.length) {
    let bestIndex = -1
    let bestScore = 0
    pool.forEach((c, i) => {
      const d = Math.min(...chosen.map((o) => distance(c.lab, o.lab)))
      if (d < MIN_DISTANCE) return
      const s = Math.sqrt(c.count / total) * d * (0.3 + 4 * labToOklch(c.lab)[2])
      if (s > bestScore) {
        bestScore = s
        bestIndex = i
      }
    })
    if (bestIndex < 0) break
    const [next] = pool.splice(bestIndex, 1)
    picked.push(next)
    chosen.push(next)
  }
  return picked
}

const distance = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v.toFixed(4))))
/*
 * How much a cluster is one form rather than a scatter: the spread a disc
 * of its area would have, over the spread it has (1 for a disc, toward 0
 * for petals strewn across the frame). A mass is one soft blob at the
 * centroid, so a scattered cluster sized by its whole area blankets the
 * card (the daisies' white, 40% of the frame in a hundred petals, turned
 * the sky to white at every fidelity). Squared in the size, so a scatter
 * shrinks to an accent; the photo pyramid already carries the texture.
 */
function compactness(c: Cluster, area: number, aspect: number): number {
  // A uniform disc of radius r has a mean squared distance of r²/2.
  const discSpread = (area * aspect) / Math.PI / 2
  return c.spread > 0 ? Math.min(1, Math.sqrt(discSpread / c.spread)) : 1
}

/** Area and darkness together: the base is what most of the photo sits on. */
const score = (c: Cluster, total: number) => (c.count / total) * (1 - c.lab[0])
const round2 = (v: number) => Number(v.toFixed(2))

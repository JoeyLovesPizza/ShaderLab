/*
 * The handoff manifest as a pure function, so a test can build it without a
 * browser. exportAll.ts feeds it the backgrounds that exported and the
 * projects they belong to. Additive on purpose: `backgrounds` keeps every
 * field a consumer that looks up by id already reads, and `projects` is the
 * new view for cards that ask for a project's primary or an alternate.
 */

export interface ManifestBackground {
  id: string
  name: string
  /** Id of the project this background follows. */
  project: string
  file: string
  preset: string
  shadowColor: string
  palette: string
  video?: string
  photo?: string
}

export interface ManifestProject {
  id: string
  name: string
  /** The background id that ships when a card asks for the project. */
  primary: string
}

export interface ManifestEntry extends ManifestBackground {
  /** True for the one background its project ships. */
  primary: boolean
}

export interface ManifestProjectEntry {
  id: string
  name: string
  primary: string
  /** Background ids, primary first, then the alternates in library order. */
  backgrounds: string[]
}

export function buildManifest<Seed extends object>(
  seed: Seed,
  backgrounds: ManifestBackground[],
  projects: ManifestProject[],
) {
  const byProject = new Map<string, ManifestBackground[]>()
  for (const b of backgrounds) byProject.set(b.project, [...(byProject.get(b.project) ?? []), b])

  // The primary is the project's own choice; if that background did not
  // export, the first one that did stands in so the project still resolves.
  const primaryOf = (projectId: string): string | undefined => {
    const list = byProject.get(projectId) ?? []
    const wanted = projects.find((p) => p.id === projectId)?.primary
    return list.find((b) => b.id === wanted)?.id ?? list[0]?.id
  }

  // Browse order: projects by their first background in the library.
  const order = [...byProject.keys()]
  const projectEntries: ManifestProjectEntry[] = order.map((id) => {
    const primary = primaryOf(id) as string
    const ids = (byProject.get(id) ?? []).map((b) => b.id)
    return {
      id,
      name: projects.find((p) => p.id === id)?.name ?? id,
      primary,
      backgrounds: [primary, ...ids.filter((x) => x !== primary)],
    }
  })

  const entries: ManifestEntry[] = backgrounds.map((b) => ({ ...b, primary: primaryOf(b.project) === b.id }))
  return { ...seed, backgrounds: entries, projects: projectEntries }
}

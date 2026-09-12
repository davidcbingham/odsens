/**
 * lib/jobs/syncModrinth.ts — hourly Modrinth sync (04 §3.1 steps 1–5 as amended by ADR-0037 D2;
 * §3 pipeline through `lib/jobs/runner.ts` `runJob` — SC-11/SC-13, SC-07 tags, J-F edge emission
 * (ADR-0030 D1); J-P/J-I/J-D; 01 INV-24/INV-71/INV-72; ADR-0002 #66/#77; ADR-0026; ADR-0034 D1/D4;
 * 05 T-ACT-45..51, T-ACT-70, T-ACT-74, T-ACT-78, T-ACT-82).
 *
 * Pipeline (the runner): lock (SC-13) → insert `sync_runs` → work → finalize (SC-11, try/finally)
 * → revalidate tags → J-F → return `JobSummary`. Idempotency keys: `projects (source='modrinth',
 * external_id)`, `project_versions.external_id` (a DB unique since ADR-0026 — duplicate upstream
 * `version_number`s are legal and become their own rows), `project_files (version_id, filename)`
 * for CDN-only rows — the files pair is matched in code only. J-I: every write is preceded by a
 * column compare, so a run with unchanged upstream data touches nothing but `synced_at` (and the
 * `set_updated_at` trigger's `updated_at`). Versions/files absent upstream are kept (ADR-0002 #66);
 * `project_overrides` is never touched (step 2). From S1.5 a failed run (`ok=false`) emits
 * `sync.failed` per J-F through the runner — edge-triggered, never twice for one failure episode
 * (05 T-ACT-74); `sync_runs.error` + `log.error` as before.
 *
 * S1.5a — "one project, many homes" (ADR-0037 D2). Per listed Modrinth project X the job resolves
 * THE TARGET ROW X syncs into: (i) a `project_links {platform:'modrinth', external_id: X.id}` row →
 * its `project_id` (the canonical odsens row — "linked"); else (ii) the `projects (source='modrinth',
 * external_id)` row (update) or a new one (insert).
 *   Step 2, linked: never inserts or updates a `projects` row's metadata — the canonical row's copy,
 *   icon, gallery, categories, loaders, game versions, license, links and status are Oliver's. The
 *   job writes only `project_links.downloads/url/synced_at` and `projects.downloads_modrinth`
 *   (J-I compare; the canonical `synced_at` is untouched).
 *   Step 2 (ii) slug collision: the effective slug is the mapped one (`normalizeSyncedSlug`,
 *   ADR-0034 D1) unless another row that is not this listing's own holds it (the primary
 *   cross-posting case — Oliver's odsens `foo` exists when Modrinth approves `foo`): then the stored
 *   slug is kept on update and the last-resort `p-<id lower>` is used on insert; no error is counted.
 *   A hosted icon wins on any row: `icon_url` is left alone (and never probed) while the stored value
 *   is a Storage path (`project-media/…`).
 *   Step 3 keys versions on `external_id` GLOBALLY: a matching row on another project is re-parented
 *   (`project_id` = the target — a version row follows its listing) and then treated as existing; no
 *   match → on the target row a version with `external_id IS NULL AND version_number = V.version_number`
 *   ADOPTS the Modrinth id and is sync-owned from then on (its hosted files stay); among same-numbered
 *   upstream candidates (ADR-0026 duplicates) the one carrying a file whose `sha512` equals a file of
 *   that hosted version adopts, else the first in adapter order; otherwise insert.
 *   Files: the `(version_id, filename)` match applies to CDN-only rows (`storage_path IS NULL`) only;
 *   before inserting, `sha512` is checked against EVERY file of the version — a match means the same
 *   bytes live in both homes: no new row, and the matching row gains `url` when it had none (the
 *   ADR-0002 #42 CDN link); a hosted row with the same filename but a different `sha512` is left
 *   alone and the upstream file lands as its own CDN row. `primary` is written on CDN-only rows only
 *   (`uploadProjectFile` manages it among hosted rows).
 *   Step 4 hides (never deletes) a `source='modrinth'` row when its `external_id` is absent from the
 *   list OR a `modrinth` link row points at a different project — computed from the list and the
 *   links, never from per-item success (J-P keeps a row that failed mid-item).
 *
 * Revalidate (04 §3.1): `projects`; `project:<slug>` for every upserted/hidden slug — none on a
 * no-change run (05 T-ACT-51). A slug whose versions/files changed revalidates too (the detail page
 * renders them). A linked X revalidates `project:<canonical slug>` (never its Modrinth slug) and
 * counts in `items` only when a link, count, version or file row changed; the slug of any project a
 * version was re-parented from revalidates as well.
 */
import 'server-only';
import { sleep } from '@/lib/adapters/http';
import {
  createModrinth,
  iconBase,
  isResizedIcon,
  mapProject,
  mapVersion,
  type ModrinthVersion,
  type ProjectRow,
  type VersionFileRow,
  type VersionRow,
} from '@/lib/adapters/modrinth';
import { env } from '@/lib/env';
import { PROJECT_MEDIA_BUCKET } from '@/lib/files';
import { modrinthListingUrl } from '@/lib/format/project';
import { MODRINTH_CALL_SPACING_MS } from '@/lib/jobs/constants';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import type { Database } from '@/lib/supabase/types';

const JOB = 'syncModrinth';
const SOURCE = 'modrinth' as const;

/** J-P: at most 20 entries in `summary.errors[]`; each clipped so no giant body lands in JSON. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

/** ADR-0037 D2/D5(a): an `icon_url` under the media bucket is Oliver's upload — the sync keeps it. */
const HOSTED_ICON_PREFIX = `${PROJECT_MEDIA_BUCKET}/`;

/**
 * The 04 §3.1 step-2 sync-owned columns (+ id/external_id for matching, status for step 4).
 * Single string literals: supabase-js types the result from the literal select string.
 */
const PROJECT_COLUMNS =
  'id, external_id, slug, project_type, title, description, body_md, icon_url, gallery, categories, loaders, game_versions, license, source_url, issues_url, discord_url, downloads_modrinth, followers, published_at, external_updated_at, status';

/** Every project (any source) — slug ownership (step 2 (ii)), linked-row counts and re-parent slugs. */
const PROJECT_INDEX_COLUMNS = 'id, slug, downloads_modrinth';

const VERSION_COLUMNS =
  'id, project_id, external_id, version_number, name, changelog_md, game_versions, loaders, version_type, date_published, downloads';

const FILE_COLUMNS = 'id, filename, size_bytes, sha512, url, primary, storage_path';

const LINK_COLUMNS = 'project_id, external_id, url, downloads';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Deep key-sort before stringify: jsonb re-orders object keys, so raw stringify would lie. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortKeysDeep(record[key]);
    return out;
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

/** True while the stored icon is Oliver's upload (a Storage path), never a Modrinth CDN URL. */
function isHostedIcon(iconUrl: string | null): boolean {
  return iconUrl !== null && iconUrl.startsWith(HOSTED_ICON_PREFIX);
}

/** `projects.slug` is citext — ownership is compared case-insensitively. */
function slugKey(slug: string): string {
  return slug.toLowerCase();
}

/** The step-2 write payload — sync-owned columns only (`project_overrides` untouched). */
function projectPayload(mapped: ProjectRow, slug: string) {
  return {
    slug,
    // step 2 imports only P1–P4 rows, so the type is never null here.
    project_type: mapped.project_type as NonNullable<ProjectRow['project_type']>,
    title: mapped.title,
    description: mapped.description,
    // `projects.body_md` is NOT NULL (data-model §2.2); a Modrinth project with no body maps to ''.
    body_md: mapped.body_md ?? '',
    icon_url: mapped.icon_url,
    gallery: mapped.gallery,
    categories: mapped.categories,
    loaders: mapped.loaders,
    game_versions: mapped.game_versions,
    license: mapped.license,
    source_url: mapped.source_url,
    issues_url: mapped.issues_url,
    discord_url: mapped.discord_url,
    downloads_modrinth: mapped.downloads_modrinth,
    followers: mapped.followers,
    published_at: isoOrNull(mapped.published_at),
    external_updated_at: isoOrNull(mapped.external_updated_at),
    status: 'published' as const,
  };
}

/** The `PROJECT_COLUMNS` row shape, from the generated types (typed selects, no casts). */
type ExistingProject = Pick<
  Database['public']['Tables']['projects']['Row'],
  | 'id'
  | 'external_id'
  | 'slug'
  | 'project_type'
  | 'title'
  | 'description'
  | 'body_md'
  | 'icon_url'
  | 'gallery'
  | 'categories'
  | 'loaders'
  | 'game_versions'
  | 'license'
  | 'source_url'
  | 'issues_url'
  | 'discord_url'
  | 'downloads_modrinth'
  | 'followers'
  | 'published_at'
  | 'external_updated_at'
  | 'status'
>;

/** The `VERSION_COLUMNS` row shape. */
type ExistingVersion = Pick<
  Database['public']['Tables']['project_versions']['Row'],
  | 'id'
  | 'project_id'
  | 'external_id'
  | 'version_number'
  | 'name'
  | 'changelog_md'
  | 'game_versions'
  | 'loaders'
  | 'version_type'
  | 'date_published'
  | 'downloads'
>;

/** The `FILE_COLUMNS` row shape. */
type ExistingFile = Pick<
  Database['public']['Tables']['project_files']['Row'],
  'id' | 'filename' | 'size_bytes' | 'sha512' | 'url' | 'primary' | 'storage_path'
>;

/** One entry of the all-projects index (any source). */
type ProjectIndexEntry = { slug: string; downloads_modrinth: number };

/** Same-shape view of a DB row for the change compare (timestamps normalized to ISO UTC). */
function projectFingerprint(row: ExistingProject): Record<string, unknown> {
  return {
    slug: row.slug,
    project_type: row.project_type,
    title: row.title,
    description: row.description,
    body_md: row.body_md,
    icon_url: row.icon_url,
    gallery: row.gallery,
    categories: row.categories,
    loaders: row.loaders,
    game_versions: row.game_versions,
    license: row.license,
    source_url: row.source_url,
    issues_url: row.issues_url,
    discord_url: row.discord_url,
    downloads_modrinth: row.downloads_modrinth,
    followers: row.followers,
    published_at: isoOrNull(row.published_at),
    external_updated_at: isoOrNull(row.external_updated_at),
    status: row.status,
  };
}

function versionPayload(version: VersionRow, fallbackDate: string | null) {
  return {
    external_id: version.external_id,
    version_number: version.version_number,
    name: version.name,
    changelog_md: version.changelog_md,
    game_versions: version.game_versions,
    loaders: version.loaders,
    version_type: version.version_type,
    // `date_published` is NOT NULL; a raw version without one keeps the stored date (or now).
    date_published:
      version.date_published?.toISOString() ?? fallbackDate ?? new Date().toISOString(),
    downloads: version.downloads,
  };
}

function versionFingerprint(row: ExistingVersion): Record<string, unknown> {
  return {
    external_id: row.external_id,
    version_number: row.version_number,
    name: row.name,
    changelog_md: row.changelog_md,
    game_versions: row.game_versions,
    loaders: row.loaders,
    version_type: row.version_type,
    date_published: isoOrNull(row.date_published),
    downloads: row.downloads,
  };
}

function filePayload(file: VersionFileRow) {
  return {
    filename: file.filename,
    size_bytes: file.size_bytes,
    sha512: file.sha512,
    url: file.url,
    primary: file.primary,
    storage_path: file.storage_path,
  };
}

type Db = JobDb;

async function readFiles(db: Db, versionId: string): Promise<ExistingFile[]> {
  const { data, error } = await db
    .from('project_files')
    .select(FILE_COLUMNS)
    .eq('version_id', versionId);
  if (error) throw new Error(`project_files read failed: ${error.message}`);
  return data;
}

/**
 * Step 3 — versions keyed on `external_id` GLOBALLY (ADR-0037 D2): the target's rows plus any row
 * elsewhere carrying one of the upstream ids (re-parented to the target — a version row follows its
 * listing). Upstream versions with no row anywhere may ADOPT a hosted row on the target (same
 * `version_number`, `external_id IS NULL`); the ADR-0026 tie-break among same-numbered candidates
 * prefers the one sharing a `sha512` with the hosted version's files, else adapter order. Absent-
 * upstream rows are kept (ADR-0002 #66); `download_count` is never written by sync. Returns
 * changed-row counts (unchanged rows get no write — J-I) and the ids of projects a row was
 * re-parented from (their detail pages revalidate).
 */
async function upsertVersions(
  db: Db,
  projectId: string,
  rawVersions: ModrinthVersion[],
): Promise<{ versions: number; files: number; reparentedFrom: Set<string> }> {
  const mappedVersions = rawVersions.map((raw) => mapVersion(raw));
  const upstreamIds = mappedVersions.map(({ version }) => version.external_id);

  const ownRead = await db
    .from('project_versions')
    .select(VERSION_COLUMNS)
    .eq('project_id', projectId);
  if (ownRead.error) throw new Error(`project_versions read failed: ${ownRead.error.message}`);
  const existing = new Map<string, ExistingVersion>(ownRead.data.map((row) => [row.id, row]));
  if (upstreamIds.length > 0) {
    const globalRead = await db
      .from('project_versions')
      .select(VERSION_COLUMNS)
      .in('external_id', upstreamIds);
    if (globalRead.error)
      throw new Error(`project_versions read failed: ${globalRead.error.message}`);
    for (const row of globalRead.data) existing.set(row.id, row);
  }

  const byExternalId = new Map<string, ExistingVersion>();
  const hostedByNumber = new Map<string, ExistingVersion>();
  for (const row of existing.values()) {
    if (row.external_id !== null) byExternalId.set(row.external_id, row);
    // The partial unique `project_versions_exclusive_version_key` guarantees one per number.
    else if (row.project_id === projectId) hostedByNumber.set(row.version_number, row);
  }

  // Adoption plan: for each hosted row on the target, the unmatched same-numbered upstream
  // candidates in adapter order; the sha512 tie-break needs the hosted files first.
  const adopter = new Map<string, string>(); // hosted row id → upstream external_id
  const hostedFiles = new Map<string, ExistingFile[]>();
  for (const [number, hosted] of hostedByNumber) {
    const candidates = mappedVersions.filter(
      ({ version }) => version.version_number === number && !byExternalId.has(version.external_id),
    );
    if (candidates.length === 0) continue;
    const files = await readFiles(db, hosted.id);
    hostedFiles.set(hosted.id, files);
    const hashes = new Set(files.map((file) => file.sha512).filter((sha) => sha !== null));
    const bySha = candidates.find((candidate) =>
      candidate.files.some((file) => file.sha512 !== null && hashes.has(file.sha512)),
    );
    const chosen = bySha ?? candidates[0];
    if (chosen !== undefined) adopter.set(hosted.id, chosen.version.external_id);
  }
  const adoptedBy = new Map<string, ExistingVersion>(); // upstream external_id → hosted row
  for (const [hostedId, externalId] of adopter) {
    const hosted = existing.get(hostedId);
    if (hosted !== undefined) adoptedBy.set(externalId, hosted);
  }

  let versionsChanged = 0;
  let filesChanged = 0;
  const reparentedFrom = new Set<string>();
  for (const { version, files } of mappedVersions) {
    const current = byExternalId.get(version.external_id) ?? adoptedBy.get(version.external_id);
    const payload = versionPayload(version, current?.date_published ?? null);

    let versionId: string;
    let knownFiles: ExistingFile[] | undefined;
    if (current === undefined) {
      const inserted = await db
        .from('project_versions')
        .insert({ project_id: projectId, ...payload })
        .select('id')
        .single();
      if (inserted.error) {
        throw new Error(`project_versions insert failed: ${inserted.error.message}`);
      }
      versionId = inserted.data.id;
      versionsChanged += 1;
      knownFiles = [];
    } else {
      versionId = current.id;
      knownFiles = hostedFiles.get(current.id);
      const reparent = current.project_id !== projectId;
      const changed =
        reparent ||
        !same(versionFingerprint(current), {
          ...payload,
          date_published: isoOrNull(payload.date_published),
        });
      if (changed) {
        const updated = await db
          .from('project_versions')
          .update(reparent ? { project_id: projectId, ...payload } : payload)
          .eq('id', versionId);
        if (updated.error) {
          throw new Error(`project_versions update failed: ${updated.error.message}`);
        }
        versionsChanged += 1;
        if (reparent) reparentedFrom.add(current.project_id);
      }
    }

    filesChanged += await upsertFiles(db, versionId, files, knownFiles);
  }
  return { versions: versionsChanged, files: filesChanged, reparentedFrom };
}

/**
 * Files of one version (ADR-0037 D2): `(version_id, filename)` matches a CDN-only row only; no
 * filename match → a `sha512` equal to ANY file of the version (hosted or CDN) means the same bytes
 * live in both homes — no new row, the matching row gains `url` when it had none; else insert a
 * CDN row. `primary` and every other sync-owned column are written on CDN-only rows only.
 */
async function upsertFiles(
  db: Db,
  versionId: string,
  files: VersionFileRow[],
  known?: ExistingFile[],
): Promise<number> {
  const existing = known ?? (await readFiles(db, versionId));

  let changed = 0;
  for (const file of files) {
    const payload = filePayload(file);
    const current = existing.find(
      (row) => row.storage_path === null && row.filename === file.filename,
    );
    if (current !== undefined) {
      const fingerprint = {
        filename: current.filename,
        size_bytes: current.size_bytes,
        sha512: current.sha512,
        url: current.url,
        primary: current.primary,
        storage_path: current.storage_path,
      };
      if (!same(fingerprint, payload)) {
        const updated = await db.from('project_files').update(payload).eq('id', current.id);
        if (updated.error) throw new Error(`project_files update failed: ${updated.error.message}`);
        changed += 1;
      }
      continue;
    }

    const sameBytes =
      file.sha512 === null ? undefined : existing.find((row) => row.sha512 === file.sha512);
    if (sameBytes !== undefined) {
      if (sameBytes.url === null) {
        const linked = await db
          .from('project_files')
          .update({ url: file.url })
          .eq('id', sameBytes.id);
        if (linked.error) throw new Error(`project_files update failed: ${linked.error.message}`);
        sameBytes.url = file.url;
        changed += 1;
      }
      continue;
    }

    const inserted = await db
      .from('project_files')
      .insert({ version_id: versionId, ...payload })
      .select('id')
      .single();
    if (inserted.error) throw new Error(`project_files insert failed: ${inserted.error.message}`);
    // Later upstream files of this version compare against the new row too (a repeated sha512
    // upstream lands once).
    existing.push({ id: inserted.data.id, ...payload });
    changed += 1;
  }
  return changed;
}

/**
 * 04 §3.1 — hourly Modrinth sync. `opts.full` is a youtube-only flag and is ignored here.
 * Lock, `sync_runs` row, revalidation, logging and J-F come from `runJob` (ADR-0030 D1).
 */
export async function syncModrinth(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db }) => {
      let ok = true;
      let errorText: string | null = null;
      let upserted = 0;
      let hidden = 0;
      let skipped = 0;
      let versions = 0;
      let files = 0;
      const errors: string[] = [];
      const changedSlugs = new Set<string>();

      try {
        const modrinth = createModrinth({ env });

        // Step 1 — one list call returns full Project objects (gallery, body, license included).
        let list: Awaited<ReturnType<typeof modrinth.listUserProjects>> | null = null;
        try {
          list = await modrinth.listUserProjects(env.MODRINTH_USER);
        } catch (error) {
          // J-P: a failed list call fails the run; steps 2–5 (including hiding) are skipped.
          ok = false;
          errorText = `list: ${message(error)}`;
          pushError(errors, errorText);
        }

        if (list !== null) {
          const existingRead = await db
            .from('projects')
            .select(PROJECT_COLUMNS)
            .eq('source', SOURCE);
          if (existingRead.error)
            throw new Error(`projects read failed: ${existingRead.error.message}`);
          const existingRows: ExistingProject[] = existingRead.data;
          const byExternalId = new Map<string, ExistingProject>();
          for (const row of existingRows) {
            if (row.external_id !== null) byExternalId.set(row.external_id, row);
          }

          // ADR-0037 D2: every project (any source) — who holds which slug (step 2 (ii)), the
          // linked canonical row's slug + count, and the slug of any re-parent source.
          const indexRead = await db.from('projects').select(PROJECT_INDEX_COLUMNS);
          if (indexRead.error) throw new Error(`projects read failed: ${indexRead.error.message}`);
          const projectIndex = new Map<string, ProjectIndexEntry>();
          for (const row of indexRead.data) {
            projectIndex.set(row.id, {
              slug: row.slug,
              downloads_modrinth: row.downloads_modrinth,
            });
          }
          /** The id of the project holding `slug` (citext), if any — the index is kept current. */
          const slugOwner = (slug: string): string | undefined => {
            const key = slugKey(slug);
            for (const [id, entry] of projectIndex) if (slugKey(entry.slug) === key) return id;
            return undefined;
          };

          // ADR-0037 D2 (i): a `modrinth` link routes its listing into the canonical odsens row.
          const linksRead = await db
            .from('project_links')
            .select(LINK_COLUMNS)
            .eq('platform', SOURCE);
          if (linksRead.error)
            throw new Error(`project_links read failed: ${linksRead.error.message}`);
          const linkByExternalId = new Map(linksRead.data.map((row) => [row.external_id, row]));

          let attempted = 0;
          let failedItems = 0;
          for (const raw of list) {
            // Step 2 — only the two publicly-listable Modrinth statuses are imported.
            if (raw.status !== 'approved' && raw.status !== 'archived') continue;
            const mapped = mapProject(raw);
            if (mapped.project_type === null) {
              // Step 5 / §5.2 P5 — modpack/shader/other: not imported, counted, not an error.
              skipped += 1;
              continue;
            }
            attempted += 1;
            try {
              const link = linkByExternalId.get(mapped.external_id);
              const canonical = link === undefined ? undefined : projectIndex.get(link.project_id);
              let projectId: string;
              let slug: string;
              let itemChanged = false;

              if (link !== undefined && canonical !== undefined) {
                // Step 2, linked (ADR-0037 D2): the canonical row's metadata is Oliver's — only
                // the link's numbers and `downloads_modrinth` follow Modrinth (J-I compare).
                projectId = link.project_id;
                slug = canonical.slug;
                const url = modrinthListingUrl(mapped.external_id);
                const linkChanged =
                  link.downloads !== mapped.downloads_modrinth || link.url !== url;
                const touched = await db
                  .from('project_links')
                  .update({
                    downloads: mapped.downloads_modrinth,
                    url,
                    synced_at: new Date().toISOString(),
                  })
                  .eq('project_id', projectId)
                  .eq('platform', SOURCE);
                if (touched.error)
                  throw new Error(`project_links update failed: ${touched.error.message}`);
                if (canonical.downloads_modrinth !== mapped.downloads_modrinth) {
                  const counted = await db
                    .from('projects')
                    .update({ downloads_modrinth: mapped.downloads_modrinth })
                    .eq('id', projectId);
                  if (counted.error)
                    throw new Error(`projects update failed: ${counted.error.message}`);
                  canonical.downloads_modrinth = mapped.downloads_modrinth;
                  itemChanged = true;
                }
                if (linkChanged) itemChanged = true;
              } else {
                // Step 2 (ii) — the listing's own `(source='modrinth', external_id)` row.
                const existing = byExternalId.get(mapped.external_id);
                if (existing !== undefined && isHostedIcon(existing.icon_url)) {
                  // ADR-0037 D2: a hosted icon wins on any row — kept, never probed.
                  mapped.icon_url = existing.icon_url;
                } else if (
                  existing !== undefined &&
                  iconBase(existing.icon_url) === iconBase(mapped.icon_url) &&
                  !isResizedIcon(existing.icon_url)
                ) {
                  // ADR-0034 D4: keep the stored full-size icon while the upstream icon is unchanged
                  // (same base) — unless the stored value is itself still a resized `_96.webp` (rows
                  // synced before this rule), which is upgraded once; otherwise probe for the original.
                  mapped.icon_url = existing.icon_url;
                } else {
                  mapped.icon_url = await modrinth.resolveIconUrl(mapped.icon_url);
                }

                // ADR-0037 D2 slug collision: the mapped slug unless another row holds it — then
                // the stored slug on update, `p-<id lower>` on insert; never an error.
                const owner = slugOwner(mapped.slug);
                const collides = owner !== undefined && owner !== existing?.id;
                slug = collides
                  ? (existing?.slug ?? `p-${mapped.external_id.toLowerCase()}`)
                  : mapped.slug;
                const payload = projectPayload(mapped, slug);
                const syncedAt = new Date().toISOString();
                if (existing === undefined) {
                  const inserted = await db
                    .from('projects')
                    .insert({
                      source: SOURCE,
                      external_id: mapped.external_id,
                      ...payload,
                      synced_at: syncedAt,
                    })
                    .select('id')
                    .single();
                  if (inserted.error)
                    throw new Error(`projects insert failed: ${inserted.error.message}`);
                  projectId = inserted.data.id;
                  projectIndex.set(projectId, {
                    slug,
                    downloads_modrinth: payload.downloads_modrinth,
                  });
                  upserted += 1;
                  changedSlugs.add(slug);
                } else {
                  projectId = existing.id;
                  if (same(projectFingerprint(existing), payload)) {
                    // J-I — unchanged upstream data: only `synced_at` moves.
                    const touched = await db
                      .from('projects')
                      .update({ synced_at: syncedAt })
                      .eq('id', projectId);
                    if (touched.error)
                      throw new Error(`projects touch failed: ${touched.error.message}`);
                  } else {
                    const updated = await db
                      .from('projects')
                      .update({ ...payload, synced_at: syncedAt })
                      .eq('id', projectId);
                    if (updated.error)
                      throw new Error(`projects update failed: ${updated.error.message}`);
                    upserted += 1;
                    changedSlugs.add(slug);
                    // A renamed slug invalidates the old detail page too.
                    if (existing.slug !== slug) {
                      changedSlugs.add(existing.slug);
                      projectIndex.set(projectId, {
                        slug,
                        downloads_modrinth: payload.downloads_modrinth,
                      });
                    }
                  }
                }
              }

              // Step 3 — sequential version calls with 100 ms spacing (04 §5.8); versions land on
              // the target row (the linked canonical or the listing's own row).
              await sleep(MODRINTH_CALL_SPACING_MS);
              const rawVersions = await modrinth.listVersions(raw.id);
              const counts = await upsertVersions(db, projectId, rawVersions);
              versions += counts.versions;
              files += counts.files;
              if (counts.versions > 0 || counts.files > 0) {
                changedSlugs.add(slug);
                itemChanged = true;
              }
              for (const fromId of counts.reparentedFrom) {
                const from = projectIndex.get(fromId);
                if (from !== undefined) changedSlugs.add(from.slug);
              }
              if (link !== undefined && itemChanged) {
                upserted += 1;
                changedSlugs.add(slug);
              }
            } catch (error) {
              // J-P: a per-item error keeps old data and is counted, never rethrown.
              failedItems += 1;
              pushError(errors, `${raw.slug}: ${message(error)}`);
            }
          }

          // Step 4 — rows absent from the list, or whose listing a `modrinth` link routes into a
          // different project (a duplicate the fold normally prevents), go hidden (never removed,
          // J-D) — computed from the list and the links, never per-item success. Already-hidden
          // rows stay untouched so a rerun changes nothing (T-ACT-49/T-ACT-51).
          const listedIds = new Set(list.map((project) => project.id));
          for (const row of existingRows) {
            if (row.external_id === null || row.status === 'hidden') continue;
            const linkedElsewhere = linkByExternalId.get(row.external_id)?.project_id;
            const listed = listedIds.has(row.external_id);
            if (listed && (linkedElsewhere === undefined || linkedElsewhere === row.id)) continue;
            const hid = await db.from('projects').update({ status: 'hidden' }).eq('id', row.id);
            if (hid.error) throw new Error(`projects hide failed: ${hid.error.message}`);
            hidden += 1;
            changedSlugs.add(row.slug);
          }

          // J-P: the run fails only when the list call failed or > 50 % of items failed.
          if (failedItems > attempted / 2) {
            ok = false;
            errorText = `${String(failedItems)}/${String(attempted)} items failed: ${errors.join('; ')}`;
          }
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      // 04 §3.1 revalidate (through the runner, after the row is final) — `projects` once +
      // `project:<slug>` per upserted/hidden slug; nothing on a no-change run.
      const tags =
        changedSlugs.size > 0
          ? ['projects', ...[...changedSlugs].map((slug) => `project:${slug}`)]
          : [];

      return {
        ok,
        items: upserted,
        error: ok ? null : (errorText ?? 'failed'),
        skipped,
        extra: { hidden, versions, files, errors },
        tags,
        logMeta: ok
          ? { hidden, skipped, versions, files, errors: errors.length }
          : { errors: errors.length },
      };
    },
  });
}

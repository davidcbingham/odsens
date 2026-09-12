import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, permanentRedirect } from 'next/navigation';
import { CommentThread } from '@/components/comments/CommentThread';
import { Breadcrumb } from '@/components/primitives/Breadcrumb';
import { Chip } from '@/components/primitives/Chip';
import { Markdown } from '@/components/primitives/Markdown';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { DetailsList, type DetailsListItem } from '@/components/projects/DetailsList';
import { ExclusiveBadge } from '@/components/primitives/ExclusiveBadge';
import { Gallery } from '@/components/projects/Gallery';
import { GetItPanel, type GetItPanelProps } from '@/components/projects/GetItPanel';
import { TipPanel } from '@/components/projects/TipPanel';
import { VersionsTable } from '@/components/projects/VersionsTable';
import { listPublicComments } from '@/lib/data/comments';
import {
  listPublishedProjects,
  resolveProjectPage,
  type ProjectDetail,
  type ProjectPageResolution,
} from '@/lib/data/projects';
import { getPublicSettings } from '@/lib/data/settings';
import { relativeTime } from '@/lib/format/date';
import { formatCountFull } from '@/lib/format/number';
import type { ProjectType } from '@/lib/format/project';
import styles from './page.module.css';

/**
 * `/projects/[slug]` — project detail (02 §1.1/§2.3; 00 S1.2 "Public routes"; DESIGN.md §6 #3,
 * §12.5; pass-3 "Project detail" mockup; ADR-0037 D4 redirects, D6 primary rule + "Also on"
 * rows + Source row, D7 `is_exclusive`).
 *
 * ISR(600; projects, project:<slug>, settings) — 01 INV-38, 02 §0.1/§5/RP-23: `revalidate = 600`
 * matches `lib/data/projects.ts` `getProjectDetail`, whose `unstable_cache` entry carries the two
 * project tags; `lib/data/settings.ts` adds `settings` and `lib/data/comments.ts` re-uses
 * `project:<slug>` (every comment action revalidates it — 02 §5). The page never touches a
 * Supabase client or `cookies()` (01 INV-09/INV-12, 02 RP-03); the data reads are
 * `resolveProjectPage(slug)`, `getPublicSettings()` and `listPublicComments(target)`. Unknown
 * slug, `status <> 'published'` or `overrides.hidden` → the view has no row → `notFound()`
 * (02 §2.3; 00 S1.2.AC9; SM-04) — unless `project_redirects` maps the slug to a visible
 * canonical project (a folded duplicate, ADR-0037 D4): then BOTH `generateMetadata` and the
 * page body issue `permanentRedirect('/projects/<canonical slug>')` before any `notFound()`
 * (metadata runs first — a redirect placed only in the body would never fire; ADR-0025: the
 * streamed ISR route may answer 200 + a client redirect instead of a 308). `generateStaticParams`
 * = all published non-hidden slugs, `dynamicParams = true` so new slugs render on demand
 * (02 §2.3 "Data (ISR shell)").
 *
 * Sections in DOM order per 02 §2.3: Breadcrumb (Projects › title) · header (104px icon well,
 * `h1` title, description, row = `ExclusiveBadge` first when `detail.exclusive` (the view's
 * `is_exclusive` — ADR-0037 D7; 00 S1.3.AC1/AC8, S1.5a.AC5) + `TypeBadge` + up to 4 `Chip`s +
 * `downloads_total`) · `Gallery`+`Lightbox` (renders nothing at 0 images) · ABOUT
 * (`Markdown(body_md)`, then `overrides.notes_md` under a `NoteCallout`) · VERSIONS & FILES
 * (`VersionsTable` — per-file Download hrefs + kinds computed by `lib/data/projects.ts`,
 * ADR-0037 D6 / ADR-0002 #42) ·
 * COMMENTS (`CommentThread`, the ADR-0002 C1 client seam — 02 §2.3 #6, 00 S1.4: the public
 * thread from `listPublicComments` is in the ISR HTML as props, the viewer's own rows merge in
 * after hydration; `commentsEnabled = overrides.comments_enabled ?? !comments_closed_default`;
 * the `<section id="comments">` is the `#comments` fragment target and points its
 * `aria-labelledby` at the `SectionTitle` heading the thread renders). Right rail (sticky ≥900px, plain sections on phone —
 * DESIGN.md §6 #3): `GetItPanel` (`getItProps` — the ADR-0037 D6 primary rule: a hosted
 * primary file on any source → "Download" + "Also on" rows; else the Modrinth home →
 * "Download on Modrinth" + bare platform rows; combined-count line — 02 §2.3 rail), DETAILS
 * panel (`DetailsList`: type, updated = `external_updated_at ?? updated_at`, licence, source —
 * 02 §2.3; D6 Source wording), `TipPanel` placeholder slab → `/support` (00 S1.2 until S1.9).
 * `TrackedLink download {project, source, from}` emitters live INSIDE `GetItPanel`
 * (`from:'get-it'`) and `VersionsTable` (`from:'versions'`) — 03 §2.2 emitters table; the page
 * passes no analytics props.
 *
 * Metadata per 02 RP-05/RP-06/RP-08: title = `title_override ?? title` (applied by the view),
 * OG image = the featured gallery image when one exists, else `/brand/og-default.png`.
 */
export const revalidate = 600;
export const dynamicParams = true;

type PageProps = { params: Promise<{ slug: string }> };

/** All published, non-hidden slugs at build (02 §2.3; slug source = the `projects`-tagged list read). */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const projects = await listPublishedProjects();
  return projects.map(({ slug }) => ({ slug }));
}

/**
 * ADR-0037 D4: a folded slug redirects (308) to its canonical page; nothing → `notFound()`.
 * Called from `generateMetadata` AND the page body — both throw, so the body never renders a
 * redirected or unknown slug.
 */
async function resolveOrLeave(slug: string): Promise<ProjectDetail> {
  const resolved: ProjectPageResolution = await resolveProjectPage(slug);
  if (resolved === null) notFound();
  if (resolved.kind === 'redirect') permanentRedirect(`/projects/${resolved.slug}`);
  return resolved.detail;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await resolveOrLeave(slug);
  return {
    title: detail.title,
    description: detail.description,
    alternates: { canonical: `/projects/${detail.slug}` },
    openGraph: {
      title: detail.title,
      description: detail.description,
      images: [detail.ogImage ?? '/brand/og-default.png'],
    },
  };
}

/** Header chip cap (ADR-0002 #54 / 03 V-05: 4 on the detail header, then `+N`). */
const HEADER_CHIP_CAP = 4;

/** DETAILS "Type" values — worded, not the SCREAMING badge form (pass-3 mockup "Mod"). */
const TYPE_LABELS: Record<ProjectType, string> = {
  mod: 'Mod',
  datapack: 'Datapack',
  resourcepack: 'Resource pack',
  plugin: 'Plugin',
};

/**
 * GET IT panel wiring (02 §2.3 rail as amended by ADR-0037 D6). Primary: `detail.primaryFile`
 * of `kind: 'direct'` (the hosted primary of the newest version with a hosted file — on any
 * source) → "Download" to `/api/download/<id>` with its file meta; otherwise the project's
 * Modrinth home → "Download on Modrinth" with the newest CDN file's meta when there is one;
 * neither → no panel (a broken publish invariant, 04 — never a dead button). Rows are
 * `detail.links` (`platformRows`: Modrinth from `source` or the link, CurseForge from the link,
 * counts from the project's per-platform columns so they always sum to `downloads_total` —
 * 00 S1.2.AC6 / S1.5a.AC6), worded "Also on <platform>" only under a hosted primary and the
 * bare platform word under "Download on Modrinth" (today's look); the direct row renders
 * inside the component from `combined.direct`, unchanged.
 */
function getItProps(detail: ProjectDetail): GetItPanelProps | null {
  const meta = detail.primaryFile;
  const fileMeta: NonNullable<GetItPanelProps['primary']['fileMeta']> | undefined =
    meta !== null
      ? {
          filename: meta.filename,
          sizeBytes: meta.sizeBytes,
          ...(meta.sha512 !== null ? { sha512: meta.sha512 } : {}),
          gameVersions: meta.gameVersions,
          loaders: meta.loaders,
        }
      : undefined;

  const hostedPrimary = meta !== null && fileMeta !== undefined && meta.kind === 'direct';
  const rows: GetItPanelProps['rows'] = detail.links.map((link) => ({
    platform: link.platform,
    href: link.url,
    downloads: link.downloads,
    ...(hostedPrimary ? { also: true } : {}),
  }));
  const shared = {
    rows,
    combined: { total: detail.downloads.total, direct: detail.downloads.direct },
    slug: detail.slug,
  };
  if (hostedPrimary) {
    return {
      primary: { kind: 'direct', href: meta.href, label: 'Download', fileMeta },
      ...shared,
    };
  }
  if (detail.modrinthUrl !== null) {
    return {
      primary: {
        kind: 'modrinth',
        href: detail.modrinthUrl,
        label: 'Download on Modrinth',
        ...(fileMeta !== undefined ? { fileMeta } : {}),
      },
      ...shared,
    };
  }
  return null;
}

/**
 * DETAILS "Source" value (02 §2.3 rail; ADR-0037 D6): `source='modrinth'` → a "Modrinth" link
 * to the listing; `odsens` with no link (`is_exclusive`) → "Only on odsens"; `odsens` with a
 * platform link → "odsens" (it lives here first, and elsewhere too — the GET IT rows say where).
 */
function sourceValue(detail: ProjectDetail) {
  if (detail.source === 'modrinth' && detail.modrinthUrl !== null) {
    return (
      <a href={detail.modrinthUrl} rel="noopener" className={styles['detail-source-link']}>
        Modrinth
      </a>
    );
  }
  return detail.exclusive ? 'Only on odsens' : 'odsens';
}

/** DETAILS list rows, exactly type · updated · licence · source (02 §2.3 rail; DESIGN.md §6 #3). */
function detailsItems(detail: ProjectDetail): DetailsListItem[] {
  const updated = detail.externalUpdatedAt ?? detail.updatedAt;
  return [
    { label: 'Type', value: TYPE_LABELS[detail.type] },
    { label: 'Updated', value: updated !== null ? relativeTime(updated) : '—' },
    { label: 'Licence', value: detail.license ?? '—' },
    {
      label: 'Source',
      value: (
        <>
          {sourceValue(detail)}
          {detail.sourceUrl !== null ? (
            <>
              {' · '}
              <a href={detail.sourceUrl} rel="noopener" className={styles['detail-source-link']}>
                Source code
              </a>
            </>
          ) : null}
        </>
      ),
    },
  ];
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const detail = await resolveOrLeave(slug);

  const target = { type: 'project' as const, id: detail.id, slug: detail.slug };
  const [settings, thread] = await Promise.all([getPublicSettings(), listPublicComments(target)]);
  // 02 §2.3 / 04 §1.2: coalesce(project_overrides.comments_enabled, not comments_closed_default).
  const commentsEnabled = detail.commentsEnabledOverride ?? !settings.commentsClosedDefault;

  const chips = detail.chips.slice(0, HEADER_CHIP_CAP);
  const extraChips = detail.chips.length - chips.length;
  const getIt = getItProps(detail);

  return (
    <div className={styles.detail}>
      <Breadcrumb
        items={[{ label: 'Projects', href: '/projects' }, { label: detail.title }]}
        className={styles['detail-breadcrumb']}
      />
      <div className={styles['detail-grid']}>
        <div className={styles['detail-main']}>
          <header className={styles['detail-header']}>
            <div
              className={styles['detail-icon']}
              {...(detail.iconUrl === null ? { 'aria-hidden': true } : {})}
            >
              {detail.iconUrl !== null ? (
                <Image
                  src={detail.iconUrl}
                  alt={`${detail.title} icon`}
                  width={104}
                  height={104}
                  quality={90}
                  className={styles['detail-icon-img']}
                />
              ) : null}
            </div>
            <div className={styles['detail-titles']}>
              <h1 className={styles['detail-title']}>{detail.title}</h1>
              {detail.description !== '' ? (
                <p className={styles['detail-description']}>{detail.description}</p>
              ) : null}
              <div className={styles['detail-meta-row']}>
                {detail.exclusive ? <ExclusiveBadge /> : null}
                <TypeBadge type={detail.type} />
                {chips.map((chip) => (
                  <Chip key={chip} label={chip} />
                ))}
                {extraChips > 0 ? <Chip label={`+${extraChips}`} /> : null}
                <PixelLabel
                  size={11}
                  informational
                  tone="emerald"
                  className={styles['detail-count']}
                >
                  {`${formatCountFull(detail.downloads.total)} DOWNLOADS`}
                </PixelLabel>
              </div>
            </div>
          </header>

          <Gallery images={detail.gallery} />

          <section aria-labelledby="about-title" className={styles['detail-section']}>
            <h2 id="about-title" className={styles['detail-h2']}>
              ABOUT
            </h2>
            <Markdown source={detail.bodyMd} variant="about" />
            {detail.notesMd !== null ? (
              <NoteCallout>
                <Markdown source={detail.notesMd} variant="note" />
              </NoteCallout>
            ) : null}
          </section>

          {detail.versions.length > 0 ? (
            <section aria-labelledby="versions-title" className={styles['detail-section']}>
              <h2 id="versions-title" className={styles['detail-h2']}>
                VERSIONS &amp; FILES
              </h2>
              <VersionsTable versions={detail.versions} projectId={detail.id} slug={detail.slug} />
            </section>
          ) : null}

          {/* COMMENTS (02 §2.3 #6; 00 S1.4): `#comments` is the fragment target; the heading is
              the `SectionTitle` inside `CommentThread` (`sectionTitleId('COMMENTS')`). */}
          <section
            id="comments"
            aria-labelledby={sectionTitleId('COMMENTS')}
            className={styles['detail-section']}
          >
            <CommentThread
              target={target}
              comments={thread.comments}
              total={thread.total}
              commentsEnabled={commentsEnabled}
              ownerProfileId={settings.ownerProfileId}
              moderationMode={settings.moderationMode}
            />
          </section>
        </div>

        <div className={styles['detail-rail']}>
          {getIt !== null ? <GetItPanel {...getIt} /> : null}
          <section aria-labelledby="details-title" className={styles['detail-panel']}>
            <div id="details-title" className={styles['detail-panel-eyebrow']}>
              <PixelLabel size={10} tone="mute-dim">
                DETAILS
              </PixelLabel>
            </div>
            <DetailsList items={detailsItems(detail)} />
          </section>
          <TipPanel />
        </div>
      </div>
    </div>
  );
}

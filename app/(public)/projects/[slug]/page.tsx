import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/primitives/Breadcrumb';
import { Chip } from '@/components/primitives/Chip';
import { Markdown } from '@/components/primitives/Markdown';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { DetailsList, type DetailsListItem } from '@/components/projects/DetailsList';
import { Gallery } from '@/components/projects/Gallery';
import { GetItPanel, type GetItPanelProps } from '@/components/projects/GetItPanel';
import { TipPanel } from '@/components/projects/TipPanel';
import { VersionsTable } from '@/components/projects/VersionsTable';
import { getProjectDetail, listPublishedProjects, type ProjectDetail } from '@/lib/data/projects';
import { relativeTime } from '@/lib/format/date';
import { formatCountFull } from '@/lib/format/number';
import type { ProjectType } from '@/lib/format/project';
import styles from './page.module.css';

/**
 * `/projects/[slug]` — project detail (02 §1.1/§2.3; 00 S1.2 "Public routes"; DESIGN.md §6 #3,
 * §12.5; pass-3 "Project detail" mockup).
 *
 * ISR(600; projects, project:<slug>) — 01 INV-38, 02 §0.1/§5/RP-23: `revalidate = 600` matches
 * `lib/data/projects.ts` `getProjectDetail`, whose `unstable_cache` entry carries the two tags.
 * The page never touches a Supabase client or `cookies()` (01 INV-09/INV-12, 02 RP-03); the one
 * data read is `getProjectDetail(slug)`. Unknown slug, `status <> 'published'` or
 * `overrides.hidden` → the view has no row → `notFound()` (02 §2.3; 00 S1.2.AC9; SM-04).
 * `generateStaticParams` = all published non-hidden slugs, `dynamicParams = true` so new slugs
 * render on demand (02 §2.3 "Data (ISR shell)").
 *
 * Sections in DOM order per 02 §2.3: Breadcrumb (Projects › title) · header (104px icon well,
 * `h1` title, description, row = `TypeBadge` + up to 4 `Chip`s + `downloads_total` — the
 * `ExclusiveBadge` component ships in S1.3 and is omitted here, matching `ProjectCard`/
 * `FeaturedHero`) · `Gallery`+`Lightbox` (renders nothing at 0 images) · ABOUT
 * (`Markdown(body_md)`, then `overrides.notes_md` under a `NoteCallout`) · VERSIONS & FILES
 * (`VersionsTable` — Download hrefs computed by `lib/data/projects.ts` per ADR-0002 #42) ·
 * COMMENTS (slot reserved; `CommentThread` mounts here in S1.4 — 00 S1.2 scope OUT; fragment
 * `#comments` target per 02 §2.3). Right rail (sticky ≥900px, plain sections on phone —
 * DESIGN.md §6 #3): `GetItPanel` (synced primary → the Modrinth page "Download on Modrinth",
 * exclusive → the latest version's primary file; rows + combined-count line — 02 §2.3 rail),
 * DETAILS panel (`DetailsList`: type, updated = `external_updated_at ?? updated_at`, licence,
 * source — 02 §2.3), `TipPanel` placeholder slab → `/support` (00 S1.2 until S1.9).
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getProjectDetail(slug);
  if (detail === null) notFound();
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
 * GET IT panel wiring (02 §2.3 rail): synced → primary is the Modrinth project page ("Download
 * on Modrinth"; ADR-0002 #42 — the rail keeps the project link, file cells keep the CDN URLs),
 * exclusive → the latest version's primary file (`/api/download/<id>`, route S1.3). Rows:
 * Modrinth count for synced, CurseForge count when `project_links` has one (count from
 * `downloads_curseforge` so the rows always sum to `downloads_total` — 00 S1.2.AC6); the direct
 * row renders inside the component from `combined.direct`. An exclusive with no file (broken
 * publish invariant, 04) renders no panel rather than a dead button.
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

  const rows: GetItPanelProps['rows'] = [];
  if (detail.modrinthUrl !== null) {
    rows.push({
      platform: 'modrinth',
      href: detail.modrinthUrl,
      downloads: detail.downloads.modrinth,
    });
  }
  const curseforge = detail.links.find((link) => link.platform === 'curseforge');
  if (curseforge !== undefined) {
    rows.push({
      platform: 'curseforge',
      href: curseforge.url,
      downloads: detail.downloads.curseforge,
    });
  }

  const shared = {
    rows,
    combined: { total: detail.downloads.total, direct: detail.downloads.direct },
    slug: detail.slug,
  };
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
  if (meta !== null && fileMeta !== undefined) {
    return {
      primary: { kind: 'direct', href: meta.href, label: 'Download', fileMeta },
      ...shared,
    };
  }
  return null;
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
          {detail.modrinthUrl !== null ? (
            <a href={detail.modrinthUrl} rel="noopener" className={styles['detail-source-link']}>
              Modrinth
            </a>
          ) : (
            'Only on odsens'
          )}
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
  const detail = await getProjectDetail(slug);
  if (detail === null) notFound();

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
              <VersionsTable
                versions={detail.versions}
                source={detail.source}
                projectId={detail.id}
                slug={detail.slug}
              />
            </section>
          ) : null}

          {/* Reserved COMMENTS slot (00 S1.2 scope OUT: thread arrives S1.4). The heading keeps
              SM-03's "COMMENTS" on the page and `#comments` is the 02 §2.3 fragment target. */}
          <section
            id="comments"
            aria-labelledby="comments-title"
            className={styles['detail-section']}
          >
            <h2 id="comments-title" className={styles['detail-h2']}>
              COMMENTS
            </h2>
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

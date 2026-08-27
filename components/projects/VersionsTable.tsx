import { Markdown } from '@/components/primitives/Markdown';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import { formatFileSize } from '@/lib/format/size';
import { hasChangelog, sortVersionsForTable } from '@/lib/versions';
import { ChangelogExpander, ChangelogExpanderSummary } from './ChangelogExpander';
import styles from './VersionsTable.module.css';

/**
 * VersionsTable — DESIGN.md §6 #3 VERSIONS & FILES ("file, Minecraft, loader, size, Download —
 * the word "Download", never "Get""), §12.5 changelog expander; 03 §2.3 `VersionsTable` row.
 * Server Component (03 C-16: not on the island list) rendering its OWN `<table>` — not the
 * `Table` primitive — because the changelog needs an extra full-width `<tr>` (03); the client
 * leaf is `ChangelogExpander` with server-rendered `Markdown variant="changelog"` children
 * (03 C-19). Ordering: versions `date_published` desc, files primary-first
 * (`lib/versions.ts` `sortVersionsForTable`, 05 T-UNIT-30); `hasChangelog` drives "Changes ▾".
 *
 * File hrefs: synced file → the Modrinth CDN URL (`project_files.url`, ADR-0002 #42);
 * direct (`source: 'odsens'`) → `/api/download/[fileId]` (S1.3). Every download link is a
 * `TrackedLink event="download"` `{ project: slug, source, from: 'versions' }` (03 §2.2
 * emitters; 04 §5.6 shapes) — the download route itself does no analytics (04 D7). The
 * newest version's primary file gets the primary-button look, other rows the outlined link
 * (pass-3 mockup; 03: "`Button primary size=sm` or link"). Accessible name of each link is
 * "Download <filename>" (visually-hidden filename — `TrackedLink` takes no `aria-label`).
 * The expanded `<tr>` is `hidden` until open (not just visually).
 */
export type VersionFile = {
  id: string;
  filename: string;
  sizeBytes: number;
  /** Synced → Modrinth CDN URL (`project_files.url`); direct → `/api/download/[fileId]`. */
  href: string;
  primary: boolean;
};

export type ProjectVersion = {
  id: string;
  versionNumber: string;
  name?: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  changelogMd: string | null;
  files: VersionFile[];
};

export type VersionsTableProps = {
  versions: ProjectVersion[];
  source: 'modrinth' | 'odsens';
  projectId: string;
  slug: string;
  className?: string;
};

export function VersionsTable({
  versions,
  source,
  projectId,
  slug,
  className,
}: VersionsTableProps) {
  if (versions.length === 0) return null; // page decides the empty layout (mirrors Gallery)

  const sorted = sortVersionsForTable(versions);
  const groupName = `changelog-${projectId}`; // 03: one open at a time per project
  const downloadSource = source === 'odsens' ? 'direct' : 'modrinth'; // 04 §5.6 values
  const classes = className
    ? `${styles['versions-table-wrap']} ${className}`
    : styles['versions-table-wrap'];

  const fileRow = (
    version: ProjectVersion,
    file: VersionFile,
    options: { firstFile: boolean; latest: boolean; summary: boolean; rowId: string },
  ) => (
    <tr key={file.id}>
      <td className={styles['versions-file']}>
        {options.firstFile ? (
          <span className={styles['versions-version']}>{version.versionNumber}</span>
        ) : (
          <span className={styles['versions-extra-file']}>{file.filename}</span>
        )}
        {options.summary ? (
          <ChangelogExpanderSummary groupName={groupName} id={options.rowId} />
        ) : null}
      </td>
      <td className={styles['versions-minecraft']}>{version.gameVersions.join(', ')}</td>
      <td className={styles['versions-loader']}>{version.loaders.join(', ')}</td>
      <td className={styles['versions-size']}>{formatFileSize(file.sizeBytes)}</td>
      <td className={styles['versions-download']}>
        <TrackedLink
          event="download"
          props={{ project: slug, source: downloadSource, from: 'versions' }}
          href={file.href}
          className={
            options.latest && options.firstFile
              ? styles['versions-download-primary']
              : styles['versions-download-link']
          }
        >
          Download
          <span className="visually-hidden">{` ${file.filename}`}</span>
        </TrackedLink>
      </td>
    </tr>
  );

  return (
    <div className={classes}>
      <table className={styles['versions-table']}>
        <caption className="visually-hidden">Versions and files</caption>
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Minecraft</th>
            <th scope="col">Loader</th>
            <th scope="col">Size</th>
            <th scope="col">
              <span className="visually-hidden">Download</span>
            </th>
          </tr>
        </thead>
        {sorted.map((version, vi) => {
          const [first, ...rest] = version.files;
          const changelog = first !== undefined && hasChangelog(version.changelogMd);
          const rowId = `changelog-${version.id}`;
          return (
            <tbody key={version.id}>
              {first !== undefined
                ? fileRow(version, first, {
                    firstFile: true,
                    latest: vi === 0,
                    summary: changelog,
                    rowId,
                  })
                : null}
              {changelog ? (
                <ChangelogExpander groupName={groupName} id={rowId}>
                  <PixelLabel size={10} tone="mute-dim">
                    {`Changes in ${version.versionNumber}`}
                  </PixelLabel>
                  <Markdown source={version.changelogMd ?? ''} variant="changelog" />
                </ChangelogExpander>
              ) : null}
              {rest.map((file) =>
                fileRow(version, file, {
                  firstFile: false,
                  latest: false,
                  summary: false,
                  rowId,
                }),
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

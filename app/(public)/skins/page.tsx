import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Markdown } from '@/components/primitives/Markdown';
import { SkinsStage, SkinsStageView } from '@/components/skins-art/SkinsStage';
import { listPublishedSkins } from '@/lib/data/skins';
import styles from './page.module.css';

/**
 * `/skins` — S1.7 replaces the S0 placeholder (02 route row `/skins`, RP-16; 00 S1.7.AC2–AC5,
 * AC8, AC10; DESIGN.md §6 #5, §11.7 empty; S1.7 D16 — ADR-0048). ISR(600; skins): one read
 * through `lib/data/skins.ts` `listPublishedSkins` on the cookie-less anon client (01 INV-09 /
 * INV-15; tag `skins` from the data cache — `createSkin` / `updateSkin` revalidate it, 02 RP-22).
 * The page tree never reads `searchParams`, `cookies()` or `headers()` (02 RP-02 / RP-03, 01
 * INV-38): the `?skin=` selection belongs to the `SkinsStage` client island inside the
 * `<Suspense>` boundary below, whose FALLBACK is the same view for the default selection — the
 * stage is in the ISR HTML and the resolved island changes nothing (the ADR-0043 D4 precedent).
 *
 * Composition (pass-3 "Skins" 1280): head — `h1` SKINS + the dry subline → `SkinsStage` (the live
 * `SkinViewer3D`, name / description / DOWNLOAD PNG / Slim toggle, the 4-up `SkinCard` grid).
 * Descriptions are Markdown (`skins.description_md`) and are rendered HERE by the server
 * `Markdown` component, then handed to the island as `descriptions: Record<slug, ReactNode>`
 * (03 C-19 server-rendered children) — the island never sees Markdown and `react-markdown`
 * never enters a client bundle (03 C-18). An empty description renders nothing. skinview3d is
 * lazy inside `SkinViewer3D` (03 C-18 / 01 INV-10 — AC5): nothing of it is in this route's
 * first-load JS.
 *
 * No published skin → the §11.7 empty state, strings verbatim (03 G-05; AC8), with the projects
 * link as its one action. Metadata per 02 RP-05 / RP-06: title `Skins` (renders `Skins — odsens`),
 * canonical `/skins`; description + OG default inherit from `app/layout.tsx`. Loading:
 * `loading.tsx` (viewer slab + 4 bust shells — 02 §6, RP-10). No comments here (ADR-0002 C21).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Skins',
  alternates: { canonical: '/skins' },
};

export default async function SkinsPage() {
  const skins = await listPublishedSkins();

  if (skins.length === 0) {
    return (
      <section className={styles.skins}>
        <h1 className={styles['skins-title']}>SKINS</h1>
        <EmptyState
          title="NO SKINS YET"
          line="Working on it. Check the projects meanwhile."
          action={{ label: 'See the projects', href: '/projects' }}
        />
      </section>
    );
  }

  // C-19: the Markdown is rendered on the server, once per skin, and travels as a prop.
  const descriptions: Record<string, ReactNode> = {};
  for (const skin of skins) {
    if (skin.descriptionMd !== null && skin.descriptionMd.trim() !== '') {
      descriptions[skin.slug] = <Markdown source={skin.descriptionMd} />;
    }
  }

  return (
    <section className={styles.skins}>
      <div className={styles['skins-head']}>
        <h1 className={styles['skins-title']}>SKINS</h1>
        <p className={styles['skins-line']}>Wear one. Or eight.</p>
      </div>

      {/* RP-02: the island reads the URL via useSearchParams — Suspense boundary required on an
          ISR page. The fallback is the SAME markup for the default selection (the first skin). */}
      <Suspense
        fallback={<SkinsStageView skins={skins} descriptions={descriptions} selectedSlug={null} />}
      >
        <SkinsStage skins={skins} descriptions={descriptions} />
      </Suspense>
    </section>
  );
}

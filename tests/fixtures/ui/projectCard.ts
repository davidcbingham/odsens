/**
 * tests/fixtures/ui/projectCard.ts — `ProjectCard` states for `/dev/components` (03 §2.3
 * `ProjectCard`; DESIGN.md §5 "Project card"; T-E2E-48). Rest · chips overflow (`+N` past the
 * 2-chip cap, ADR-0002 #54) · tight density · no icon · exclusive (gold outline; badge S1.3) ·
 * one-chip · single-download sr text. Icons are the local brand placeholder (no network).
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { ProjectCardProps } from '@/components/projects/ProjectCard';

export type ProjectCardFixture = { label: string; props: ProjectCardProps };

const ICON = '/brand/avatar-80.png';

export const projectCardFixtures: ProjectCardFixture[] = [
  {
    label: 'ProjectCard · rest',
    props: {
      project: {
        slug: 'metal-pipe-mace',
        title: 'Metal Pipe Mace',
        description: 'A mace made out of a metal pipe. It does the sound.',
        iconUrl: ICON,
        type: 'mod',
        chips: ['1.21.x', 'Fabric'],
        downloadsTotal: 1688,
        exclusive: false,
      },
    },
  },
  {
    label: 'ProjectCard · chips overflow',
    props: {
      project: {
        slug: 'heavy-spear',
        title: 'Heavy Spear',
        description: 'Long reach, real weight, no shield.',
        iconUrl: ICON,
        type: 'mod',
        chips: ['1.21.x', '1.20.x', 'Fabric', 'NeoForge'],
        downloadsTotal: 12431,
        exclusive: false,
      },
    },
  },
  {
    label: 'ProjectCard · tight',
    props: {
      density: 'tight',
      project: {
        slug: 'pixel-chameleon',
        title: 'Pixel Chameleon',
        description: 'It hides. Sometimes too well.',
        iconUrl: ICON,
        type: 'datapack',
        chips: ['1.21.x'],
        downloadsTotal: 2147,
        exclusive: false,
      },
    },
  },
  {
    label: 'ProjectCard · no icon',
    props: {
      project: {
        slug: 'duck-crosshair',
        title: 'Duck Crosshair',
        description: 'Your crosshair is a duck now.',
        iconUrl: null,
        type: 'resourcepack',
        chips: ['1.21.x', '1.20.x'],
        downloadsTotal: 999,
        exclusive: false,
      },
    },
  },
  {
    label: 'ProjectCard · exclusive',
    props: {
      project: {
        slug: 'troll-resources',
        title: 'Troll Resources',
        description: 'Everything looks slightly wrong.',
        iconUrl: ICON,
        type: 'resourcepack',
        chips: ['1.21.x', 'snapshots'],
        downloadsTotal: 3209,
        exclusive: true,
      },
    },
  },
  {
    label: 'ProjectCard · plugin single',
    props: {
      project: {
        slug: 'sound-check',
        title: 'Sound Check',
        description: 'Works on 1.21. Probably works on 1.20. Untested.',
        iconUrl: null,
        type: 'plugin',
        chips: ['1.21.x'],
        downloadsTotal: 1,
        exclusive: false,
      },
    },
  },
];

/**
 * lib/actions/uploads.schema.ts — the `<actionName>Input` zod schemas for `lib/actions/uploads.ts`
 * (04 SC-02; 04 §1.4.5 + `uploadProjectMedia` / `uploadProjectFile` input cells verbatim; ADR-0013).
 *
 * Both actions are phase-discriminated (04 §1.4.5): `begin` declares the upload (size cap +
 * extension allow-list checked here, on the DECLARED values — the commit phase re-validates the
 * actual bytes), `commit` names the stored object. Size copy carries the actual numbers via
 * `lib/validation/files.ts` `sizeLimitMessage` so the client pre-check prints identical words
 * (03 §2.10 `UploadWell`). Messages are plain words (DESIGN.md §7), never zod internals.
 */
import { z } from 'zod';
import {
  UPLOAD_KINDS,
  sanitizeFilename,
  sizeLimitMessage,
  typeMessage,
} from '@/lib/validation/files';

const projectIdSchema = z.uuid({ error: 'Pick a project.' });

/** A declared filename: non-empty, sane length (the stored name is `sanitizeFilename`d later). */
const filenameSchema = z
  .string({ error: 'Pick a file.' })
  .min(1, { error: 'Pick a file.' })
  .max(255, { error: 'That filename is too long.' });

/** A `begin`-returned path echoed back at commit (parsed strictly in the action, INV-53). */
const pathSchema = z
  .string({ error: 'Send the upload path back.' })
  .min(1, { error: 'Send the upload path back.' })
  .max(300, { error: "That path isn't one of ours." });

// ---------------------------------------------------------------------------------------------
// uploadProjectMedia — bucket `project-media` (icon | gallery), ≤ 5 MB, png/jpeg/webp
// ---------------------------------------------------------------------------------------------

const MEDIA_KIND = z.enum(['icon', 'gallery'], { error: 'Pick icon or gallery.' });

const mediaSizeSchema = z
  .number({ error: 'Say how big the file is.' })
  .int({ error: 'Size is a whole number of bytes.' })
  .min(1, { error: "That file is empty. There's nothing to upload." })
  .refine((size) => size <= UPLOAD_KINDS['project-media'].maxBytes, {
    error: (issue) => sizeLimitMessage(issue.input as number, 'project-media'),
  });

const mediaMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp'], {
  error: typeMessage(null, 'project-media'),
});

export const uploadProjectMediaInput = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('begin'),
    project_id: projectIdSchema,
    kind: MEDIA_KIND,
    filename: filenameSchema,
    size_bytes: mediaSizeSchema,
    mime: mediaMimeSchema,
  }),
  z.object({
    phase: z.literal('commit'),
    project_id: projectIdSchema,
    kind: MEDIA_KIND,
    path: pathSchema,
    title: z.string().max(120, { error: 'Too long. 120 characters maximum.' }).optional(),
    description: z.string().max(500, { error: 'Too long. 500 characters maximum.' }).optional(),
  }),
]);

export type UploadProjectMediaBeginInput = {
  phase: 'begin';
  project_id: string;
  kind: 'icon' | 'gallery';
  filename: string;
  size_bytes: number;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
};
export type UploadProjectMediaCommitInput = {
  phase: 'commit';
  project_id: string;
  kind: 'icon' | 'gallery';
  path: string;
  title?: string;
  description?: string;
};
export type UploadProjectMediaInput = UploadProjectMediaBeginInput | UploadProjectMediaCommitInput;

// ---------------------------------------------------------------------------------------------
// uploadProjectFile — bucket `project-files`, ≤ 100 MB, .jar .zip .mrpack (04 §1.4)
// ---------------------------------------------------------------------------------------------

/** 04 §1.4: `version_number` grammar. */
export const VERSION_NUMBER_RE = /^[0-9A-Za-z.\-+_]{1,32}$/;

const versionNumberSchema = z.string({ error: 'Type a version number.' }).regex(VERSION_NUMBER_RE, {
  error: 'Version numbers use letters, numbers and . - + _ (up to 32).',
});

const fileSizeSchema = z
  .number({ error: 'Say how big the file is.' })
  .int({ error: 'Size is a whole number of bytes.' })
  .min(1, { error: "That file is empty. There's nothing to upload." })
  .refine((size) => size <= UPLOAD_KINDS['project-file'].maxBytes, {
    error: (issue) => sizeLimitMessage(issue.input as number, 'project-file'),
  });

/** The declared filename must carry a .jar/.zip/.mrpack extension AFTER SC-20 normalisation. */
const projectFilenameSchema = filenameSchema.refine(
  (name) => {
    const clean = sanitizeFilename(name);
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? clean.slice(dot + 1) : null;
    return ext !== null && UPLOAD_KINDS['project-file'].exts.includes(ext);
  },
  {
    error: (issue) => {
      const clean = sanitizeFilename(String(issue.input));
      const dot = clean.lastIndexOf('.');
      return typeMessage(dot > 0 ? clean.slice(dot + 1) : null, 'project-file');
    },
  },
);

const versionPayloadSchema = z.object({
  version_number: versionNumberSchema,
  name: z.string().max(80, { error: 'Too long. 80 characters maximum.' }).optional(),
  changelog_md: z.string().max(20000, { error: 'Too long. 20000 characters maximum.' }).optional(),
  game_versions: z
    .array(
      z.string().regex(/^[0-9][0-9A-Za-z.\-+_]{0,19}$/, {
        error: 'Game versions look like 1.21 or 24w14a.',
      }),
    )
    .min(1, { error: 'Pick at least one game version.' })
    .max(60, { error: '60 game versions maximum.' }),
  loaders: z
    .array(
      z.enum(
        [
          'fabric',
          'forge',
          'neoforge',
          'quilt',
          'paper',
          'spigot',
          'bukkit',
          'purpur',
          'folia',
          'velocity',
          'bungeecord',
          'waterfall',
          'sponge',
          'datapack',
          'minecraft',
        ],
        { error: "That loader isn't on the list." },
      ),
    )
    .min(1, { error: 'Pick at least one loader.' })
    .max(10, { error: '10 loaders maximum.' }),
  version_type: z.enum(['release', 'beta', 'alpha'], { error: 'Pick release, beta or alpha.' }),
  date_published: z.iso.datetime({ error: 'Dates are ISO timestamps.' }).optional(),
});

export const uploadProjectFileInput = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('begin'),
    project_id: projectIdSchema,
    version_number: versionNumberSchema,
    filename: projectFilenameSchema,
    size_bytes: fileSizeSchema,
    mime: z.string().max(128).optional(),
  }),
  z.object({
    phase: z.literal('commit'),
    project_id: projectIdSchema,
    path: pathSchema,
    version: versionPayloadSchema,
    primary: z.boolean().optional(),
  }),
]);

export type UploadProjectFileBeginInput = {
  phase: 'begin';
  project_id: string;
  version_number: string;
  filename: string;
  size_bytes: number;
  mime?: string;
};
export type UploadProjectFileCommitInput = {
  phase: 'commit';
  project_id: string;
  path: string;
  version: {
    version_number: string;
    name?: string;
    changelog_md?: string;
    game_versions: string[];
    loaders: string[];
    version_type: 'release' | 'beta' | 'alpha';
    date_published?: string;
  };
  primary?: boolean;
};
export type UploadProjectFileInput = UploadProjectFileBeginInput | UploadProjectFileCommitInput;

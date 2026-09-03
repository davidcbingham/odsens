import { Comment, type CommentProps } from '@/components/comments/Comment';

/**
 * Reply — DESIGN.md §5 Reply ("One level of indentation only: 52px left margin, 16px left
 * padding, 2px left border. Deeper replies stay flat and open with `@handle`."); 03 §2.4 `Reply`.
 * Shared thin wrapper (no directive — imported only by the client `CommentThread`; no
 * `.module.css` of its own, C-01 exempt): a `Comment` at `depth={1}`, whose look lives in
 * `Comment.module.css` `[data-depth="1"]` (34px avatar, 13px bubble padding) and whose nested
 * `<ol>` — the indent rule — is drawn by the root `Comment` around its replies. A reply to a
 * reply arrives here flat with the client-added `@handle` prefix in its body (data-model §2.5).
 */
export type ReplyProps = Omit<CommentProps, 'depth'> & { depth?: 1 };

export function Reply(props: ReplyProps) {
  return <Comment {...props} depth={1} />;
}

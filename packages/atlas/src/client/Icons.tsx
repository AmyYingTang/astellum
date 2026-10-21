/**
 * The target list's marks.
 *
 * One per target, and it answers one question: do I have to do something
 * about this? Not a census of annotation states — the filter chips above the
 * list already give that, and a row scanned down a list of ninety-eight is
 * read, not studied. The reference image is the exception: it is about whether
 * the target can be worked on at all, so it has a column of its own.
 *
 * Drawings rather than glyphs (▣ ✓ ⏳) so they share a size and a baseline
 * whatever font answers, and they take their colour from the row.
 */

export type IconName = 'image' | 'exported' | 'needsExport' | 'todo';

const PATHS: Record<IconName, JSX.Element> = {
  // There is a reference image: a picture, with a horizon and a sun in it.
  image: (
    <>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.6" />
      <circle cx="5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <path d="M2.4 10.2 6 7.4l2.1 1.7 2-1.6 1.2 1" />
    </>
  ),
  // Reviewed and handed over: a tick. Nothing to do.
  exported: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M4.6 7.2 6.3 9l3.2-3.6" />
    </>
  ),
  // Approved, still sitting here: an arrow that has not left. One click.
  needsExport: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M7 9.6V4.6M4.9 6.6 7 4.4l2.1 2.2" />
    </>
  ),
  // Drafts or things waiting to be looked at: an unfinished ring. An evening.
  todo: <circle cx="7" cy="7" r="5.2" strokeDasharray="2.2 1.8" />,
};

export function Icon({ name, title }: { name: IconName; title?: string }): JSX.Element {
  return (
    <svg
      className={`ico ico-${name}`}
      viewBox="0 0 14 14"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

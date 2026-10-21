/**
 * The target list's markers.
 *
 * They used to be typographic — ▣, ✓, ⏳, a bare number — which rendered at
 * four different weights depending on the font that answered, and said nothing
 * about themselves. These are one family at one size, drawn from `currentColor`
 * so the colour stays where it belongs (in the CSS), and every one of them
 * appears in the legend under the list.
 */

export type IconName = 'image' | 'approved' | 'review' | 'draft' | 'stale';

const PATHS: Record<IconName, JSX.Element> = {
  // A reference image exists: a picture, with a horizon and a sun in it.
  image: (
    <>
      <rect x="1.5" y="2.5" width="11" height="9" rx="1.6" />
      <circle cx="5" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <path d="M2.4 10.2 6 7.4l2.1 1.7 2-1.6 1.2 1" />
    </>
  ),
  // Reviewed and standing: a tick.
  approved: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M4.6 7.2 6.3 9l3.2-3.6" />
    </>
  ),
  // Waiting for someone to look at it: a half-turned dial.
  review: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M7 4.1V7l2 1.5" />
    </>
  ),
  // Drawn, not yet judged: an outline with nothing in it.
  draft: <circle cx="7" cy="7" r="5.2" strokeDasharray="2.2 1.8" />,
  // Approved but not handed to the runtime: an arrow that has not left.
  stale: (
    <>
      <circle cx="7" cy="7" r="5.2" />
      <path d="M7 9.6V4.6M4.9 6.6 7 4.4l2.1 2.2" />
    </>
  ),
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

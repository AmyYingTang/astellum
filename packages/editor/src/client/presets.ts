/**
 * The studio's quick-pick style buttons.
 *
 * The list itself now lives in `@astellum/schema` — the kiosk asks the same
 * question when it is configured to write on the night, and two copies of the
 * wording would drift. This module stays as the studio's door to it.
 */
export { BUILT_IN_STYLE_PRESETS as PRESETS, type StylePreset as Preset } from '@astellum/schema';
/** Where the role selector starts before the server has answered. */
export { DEFAULT_ROLE as DEFAULT_ROLE_ID } from '@astellum/schema';

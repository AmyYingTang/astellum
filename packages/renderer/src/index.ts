export {
  buildOverlaySvg,
  renderAnnotated,
  renderAnnotatedBuffer,
  type RenderAnnotatedOptions,
  type RenderAnnotatedBufferOptions,
} from './annotate.js';
export {
  buildPosterHtml,
  renderPoster,
  renderPosterBuffers,
  type PosterLayout,
  type PosterBuffer,
  type RenderPosterOptions,
} from './poster.js';
export { generateEmbedHtml, type EmbedOptions } from './embed.js';
export {
  generateKioskHtml,
  generateKioskShellHtml,
  KIOSK_FAVICON,
  KIOSK_FAVICON_DATA_URI,
  type KioskOptions,
  type KioskPicker,
  type KioskShellOptions,
  type KioskState,
} from './kiosk.js';

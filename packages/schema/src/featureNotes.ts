import type { LocalizedString } from './i18n.js';
import type { FeatureTypeKey } from './taxonomy.js';

/**
 * Generic, per-feature-type explanations — the no-LLM fallback for onsite mode.
 *
 * The split (Amy, 2026-08-01): the atlas drawing vocabulary is the ONLY source of
 * B-class features a kiosk frame can show, so a note per drawable type covers
 * it. The full taxonomy is instead handed to the LLM offsite, where precision is
 * what's wanted. Onsite is mass outreach — a visitor says "I see a shell, I see
 * threads", so these are written at that level and deliberately avoid jargon
 * (no "blue horizontal branch"). Reading level: school year 8–12.
 *
 * Partial on purpose. The drawing vocabulary was split finer in 2026-10 (pillar
 * vs elephant trunk, Bok vs cometary globule, HH jet vs ansae/FLIER, shell vs
 * bipolar lobe) without writing notes for the new types: a type with no note
 * falls through to the fact template and is marked ※ onsite, which is honest.
 * Writing one is a pure addition whenever the words are ready.
 *
 * Keyed by the *pipeline* FeatureTypeKey (taxonomy.ts), which is what a
 * FactObject carries by the time the reader sees it — atlasApply.ts has already
 * mapped the atlas's drawing keys into this space.
 *
 * These are the type-level layer. A specific target's own wording (the Horsehead
 * being horse-shaped vs the Dark Doodad being a streak) belongs in the
 * target-level predefined reading; here both are simply "a cold dark cloud".
 */
export const FEATURE_NOTES: Partial<Record<FeatureTypeKey, LocalizedString>> = {
  pillar: {
    zh: '这是一根被“吹”出来的柱子。附近大质量恒星发出的强烈紫外线和星风,把周围稀薄的气体一层层剥走;只有密度最高的那一小块顶得住,它身后的气体因此被保护下来,留下一根指向那些恒星的柱子。柱子顶端往往正在诞生新的恒星。',
    en: 'A pillar is what survives when nearby massive stars blow the thinner gas away. Only the densest clump holds out, shielding the gas behind it, so a column is left pointing back at the stars doing the blowing. New stars are often forming right in the tip.',
  },
  ionization_front: {
    zh: '这条亮边是气体被“点亮”的分界线。一侧的氢被恒星的紫外线打散成带电粒子,重新结合时发出红光;另一侧还没被照到,仍是黑暗的冷气体。随着恒星一点点吃掉这团云,这条边界会持续向外推进。',
    en: 'This bright edge is the boundary where starlight is switching the gas on. On one side, ultraviolet light tears hydrogen apart and it glows red as it recombines; on the other side the gas is still cold and dark. The edge creeps outward as the stars eat into the cloud.',
  },
  snr_filament: {
    zh: '这些细丝是被冲击波扫过的气体。当爆炸或强烈的星风推着物质高速撞进周围的气体,被压缩加热的那一薄层就会发光。它们看起来像丝线,其实每一条都是一层很薄的壳,只是我们正好从侧面看过去。',
    en: 'These threads are gas swept up by a shock wave. When an explosion or a fierce stellar wind slams into the surrounding material, the thin compressed layer heats up and glows. They look like threads, but each one is really a very thin sheet seen edge-on.',
  },
  silhouette_shape: {
    zh: '这里不是“什么都没有”,而是有一团又冷又密的尘埃云挡在前面,把后面的光遮住了,才显出一个黑色的形状。它的温度只有零下 260 度上下,是天空中最冷的东西之一,也正是将来恒星诞生的地方。',
    en: "The dark shape isn't empty space — it's a cold, dense cloud of dust sitting in front of everything, blocking the light behind it. At around −260 °C it is one of the coldest things in the sky, and exactly the kind of place where stars form later on.",
  },
  cometary_globule: {
    zh: '一小团特别致密的冷气体和尘埃。有的是圆的,有的被附近恒星的星风吹出一条尾巴,看上去像彗星(其实和彗星毫无关系)。这样一小团里的材料,通常只够形成一颗到几颗恒星。',
    en: 'A small, unusually dense knot of cold gas and dust. Some are round; some have been blown into a tail by a nearby star’s wind, which makes them look like comets (they have nothing to do with comets). A knot like this usually holds only enough material for one or a few stars.',
  },
  dust_lane: {
    zh: '一条横穿画面的暗带,是排成一层的尘埃在挡光。尘埃颗粒比烟尘还小,但数量极多,累积起来足以把后面整片星光遮住。在星系里,尘埃带往往正好标出它那个扁平圆盘的位置。',
    en: 'A dark band cutting across the view: dust arranged in a sheet, blocking the light behind it. The grains are smaller than smoke particles, but there are so many of them that together they hide whole starfields. In a galaxy, a dust lane usually marks where the flat disc lies.',
  },
  bubble_shell: {
    zh: '一颗或几颗恒星持续吹出的高速星风,在周围气体里吹出了一个空腔,腔壁被压得比较密,于是我们看到一圈壳。看到的“环”其实是一个球壳的边缘——视线沿边缘穿过的气体更厚,所以边缘看起来最亮。',
    en: 'Fast wind pouring off one or more stars has blown a cavity in the surrounding gas, and the compressed cavity wall shows up as a shell. The "ring" is really the rim of a sphere: our line of sight passes through more material at the edge, so the edge looks brightest.',
  },
  spiral_arm: {
    zh: '旋臂并不是一条固定的“物质手臂”,更像是绕着星系传播的一道交通堵塞:气体经过时被挤压,大批新恒星因此诞生。其中最亮的蓝色年轻恒星寿命很短,还来不及离开就烧完了,所以旋臂看起来又蓝又亮。',
    en: "A spiral arm isn't a fixed arm of material — it's more like a traffic jam travelling around the galaxy. Gas piles up as it passes through, and new stars are triggered. The brightest blue newcomers are short-lived and burn out before they can drift away, which is why the arms look blue and bright.",
  },
  tidal_tail: {
    zh: '两个星系彼此靠近时,引力对近的一侧和远的一侧拉扯的力度不一样,把恒星和气体拉成长长的尾巴。这样一次“擦身而过”要持续几亿年,我们看到的只是其中凝固的一瞬间。',
    en: 'When two galaxies pass close, gravity pulls harder on the near side than the far side, drawing stars and gas out into long streamers. The whole encounter takes hundreds of millions of years — this picture is one frozen instant of it.',
  },
  emission_color_region: {
    zh: '这一块被单独圈出来,是因为它的颜色或亮度和周围明显不同。不同的元素发出不同颜色的光——氢偏红、氧偏青绿——所以颜色变了,通常意味着这里的成分、温度或密度和旁边不一样。',
    en: 'This patch is circled because its colour or brightness clearly differs from its surroundings. Different elements glow in different colours — hydrogen reddish, oxygen teal — so a change of colour usually means the composition, temperature or density here is different from next door.',
  },
  hh_jet: {
    zh: '一道又细又直的高速气流,沿着一颗正在形成的恒星的自转轴喷出去,速度可以达到每秒几百公里。它撞到周围的气体时会把气体加热发光,所以我们看到的是一串亮结,而不是一条连续的线。',
    en: 'A narrow, straight jet of gas fired along the rotation axis of a forming star at hundreds of kilometres per second. Where it slams into the surrounding gas it heats it up, which is why we see a line of glowing knots rather than a continuous streak.',
  },
};

/** The generic note for a feature type, or undefined when none is written. */
export function featureNote(ft: FeatureTypeKey): LocalizedString | undefined {
  return FEATURE_NOTES[ft];
}

import type * as React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { preferredLang } from '@astellum/schema';

export type UiLang = 'zh' | 'en';

export interface Strings {
  newReading: string;
  atlasLink: string;
  solverLabel: string;
  backToHub: string;
  readyOffline: string;
  notReadyOffline: string;
  readingsCovered: string;
  savePredefined: string;
  saveAnnotations: string;
  savedAnnotations: string;
  savingPredefined: string;
  savedPredefined: string;
  newReadingDesc: string;
  pickImage: string;
  hintPlaceholder: string;
  generate: string;
  generating: string;
  calloutLabel: string;
  calloutHint: string;
  roleLabel: string;
  switchingRole: string;
  focusLabel: string;
  styleFreePlaceholder: string;
  openExisting: string;
  loading: string;
  emptyWorkspace: string;
  stagePrefix: string;
  featuresSuffix: string;
  overlayTitle: string;
  overlaySub: string;
  backToLibrary: string;
  exportLabel: string;
  exporting: string;
  exported: string;
  savedTo: string;
  browserDefault: string;
  loadFailed: string;
  errorLabel: string;
  narrative: string;
  featuresLabel: string;
  add: string;
  collapseAll: string;
  expandAll: string;
  save: string;
  saved: string;
  deleteFeature: string;
  badgeNum: string;
  phExplanation: string;
  phPhysics: string;
  phInteresting: string;
  fmtAnnotated: string;
  fmtPoster: string;
  fmtAll: string;
  stageSolving: string;
  stageReading: string;
  reviewSuffix: string;
  confirmReview: string;
  needsReviewTitle: string;
  secIdentify: string;
  secIdentifyDesc: string;
  btnIdentify: string;
  identifying: string;
  secReading: string;
  secReadingDesc: string;
  reidentify: string;
  reidentifying: string;
  reidentifyConfirm: string;
  /** `{n}` is the number of written passages that would be lost. */
  reidClearsText: string;
  /** Overwrite confirmations. `{n}` passages, `{role}` a role, `{files}` names. */
  genOverwrite: string;
  genOverwriteBtn: string;
  roleOverwrite: string;
  roleOverwriteBtn: string;
  predefOverwrite: string;
  predefOverwriteBtn: string;
  exportOverwrite: string;
  annsOverwrite: string;
  annsOverwriteBtn: string;
  exportOverwriteBtn: string;
  reidConfirmBtn: string;
  reidCancel: string;
  starMagLabel: string;
  genReading: string;
  genReadingRunning: string;
  titleHint: string;
  gridShow: string;
  gridHide: string;
  factsSolve: string;
  factsObjects: string;
  factsFeaturesB: string;
  factsBSourceCv: string;
  factsBSourceGeometric: string;
  factsBSourceAi: string;
  factsBSourceAtlas: string;
  factsNoneYet: string;
  editTitle: string;
  editSub: string;
  panelFacts: string;
  panelReading: string;
  dragDivider: string;
  previewTitle: string;
  pvAnnotated: string;
  pvLandscape: string;
  pvPortrait: string;
  fmtPosterLandscape: string;
  fmtPosterPortrait: string;
  exportAll: string;
  previewHint: string;
}

const STRINGS: Record<UiLang, Strings> = {
  zh: {
    newReading: '新读图',
    atlasLink: '基准标注库',
    solverLabel: '解算器',
    backToHub: '导航',
    readyOffline: '可离线运行',
    notReadyOffline: '离线星表不全,先跑 astellum prefetch',
    readingsCovered: '已录解读',
    savePredefined: '存为预定义解读',
    saveAnnotations: '存入我的标注库',
    savedAnnotations: '已存入标注库',
    savingPredefined: '保存中…',
    savedPredefined: '已存入预定义库',
    newReadingDesc: '选一张深空摄影图,ASTELLUM 会识别天体并自动标注,然后进入微调页面。',
    pickImage: '选择图片…',
    hintPlaceholder: '对象名提示(可选),如 "Sh2-308"',
    generate: '生成读图',
    generating: '识别中…',
    calloutLabel: '放大框',
    calloutHint: '太小看不清时,在画面空处放一个放大图。最多三个,拖动框可以换位置。',
    roleLabel: '角色',
    switchingRole: '切换角色中…',
    focusLabel: '侧重',
    styleFreePlaceholder: '其他要求…(可选,会附加到提示词)',
    openExisting: '打开已有作品',
    loading: '加载中…',
    emptyWorkspace: '工作区还没有作品。先做一个新读图吧。',
    stagePrefix: '阶段',
    featuresSuffix: '标注',
    overlayTitle: '正在识别和标注…',
    overlaySub: '调用 claude 看图,可能需要 1 分钟左右。',
    backToLibrary: '← 作品库',
    exportLabel: '导出',
    exporting: '导出中…',
    exported: '已导出:',
    savedTo: '已保存到',
    browserDefault: '浏览器默认下载位置',
    loadFailed: '加载失败',
    errorLabel: '出错',
    narrative: '导读',
    featuresLabel: '标注',
    add: '+ 添加',
    collapseAll: '全部折叠',
    expandAll: '全部展开',
    save: '保存',
    saved: '已保存',
    deleteFeature: '删除标注',
    badgeNum: '编号',
    phExplanation: '说明',
    phPhysics: '物理机制(可选)',
    phInteresting: '冷知识(可选)',
    fmtAnnotated: '标注图 (JPG)',
    fmtPoster: '海报 (PNG)',
    fmtAll: '全部',
    stageSolving: '正在解像(plate-solve,可能 30 秒到几分钟)…',
    stageReading: '正在生成双语解读…',
    reviewSuffix: '待确认',
    confirmReview: '确认位置',
    needsReviewTitle: '此标注由识别系统占位(B 类),请拖到正确位置后确认',
    secIdentify: '① 只识别(看落点)',
    secIdentifyDesc: '只跑 plate-solve + 查目录,在编辑器里看 factsheet 和 A 类落点;不调用 AI。',
    btnIdentify: '识别',
    identifying: '识别中…',
    secReading: '② AI 解读',
    secReadingDesc: '在识别基础上让 AI 生成双语解读 + 标注;需要 claude。',
    reidentify: '重新识别',
    reidentifying: '识别中…',
    reidentifyConfirm: '重新识别会覆盖当前标注和已生成的解读文字,不可撤销。',
    reidConfirmBtn: '确认重新识别',
    genOverwrite:
      '已经有 {n} 段解读文字。重新生成会用 AI 新写的文字替换它们,现在的文字(包括你手改过的)都会丢失。',
    genOverwriteBtn: '替换并生成',
    roleOverwrite:
      '切换到「{role}」会从解读库读入这个角色的文字,替换现在的 {n} 段文字(包括你手改过的)。',
    roleOverwriteBtn: '切换角色',
    predefOverwrite:
      '解读库里已经有这个目标「{role}」的文字。保存会用现在的文字覆盖其中相同的部分,这个目标的其他作品读到的也会跟着变。',
    predefOverwriteBtn: '覆盖保存',
    exportOverwrite: '这个文件夹里已经有同名文件:{files}。导出会覆盖它们。',
    exportOverwriteBtn: '覆盖导出',
    annsOverwrite:
      '你之前从这个作品存过 {n} 个标注到标注库。再存一次会用现在的版本替换它们;上次保存之后你在这里删掉的标注,也会从标注库里删掉。',
    annsOverwriteBtn: '替换标注',
    reidClearsText: '这份作品已经写好了 {n} 段解读文字(导读和要素说明)。重新识别会把它们全部清空,无法恢复。想留着的话,先「存为预定义解读」。',
    reidCancel: '取消',
    starMagLabel: '亮星阈值 V <',
    genReading: '✦ 生成解读',
    genReadingRunning: '生成解读中…',
    titleHint: '主题标题(可改),例如改成 Antares 或「天空中的调色盘」',
    gridShow: '⊞ 显示网格',
    gridHide: '⊞ 隐藏网格',
    factsSolve: '解像',
    factsObjects: '目录天体',
    factsFeaturesB: '形态特征 (B 类 · 推断)',
    factsBSourceCv: '图像检测 (CV)',
    factsBSourceGeometric: '几何推断',
    factsBSourceAi: 'AI 推断',
    factsBSourceAtlas: '基准标注库',
    factsNoneYet: '没有事实层(此项目早于识别阶段)。',
    editTitle: '编辑',
    editSub: '需要时才改 · 改动实时反映在右侧预览',
    panelFacts: '识别与事实',
    panelReading: '解读文字',
    dragDivider: '拖动调整编辑 / 预览宽度',
    previewTitle: '预览 · 所见即所得',
    pvAnnotated: '🏷️ 仅标签',
    pvLandscape: '🖼️ 横版解说',
    pvPortrait: '📜 竖版解说',
    fmtPosterLandscape: '横版海报 (PNG)',
    fmtPosterPortrait: '竖版海报 (PNG)',
    exportAll: '导出全部格式',
    previewHint:
      '图上可以直接拖动:编号、圆圈、放大框都能挪位置;点选圆圈后拖它边上的小圆点可改大小。点图上空白处或按 Esc 取消选中,⌘/Ctrl+Z 撤销。',
  },
  en: {
    newReading: 'New reading',
    atlasLink: 'Feature Atlas',
    solverLabel: 'Solver',
    backToHub: 'Home',
    readyOffline: 'Ready offline',
    notReadyOffline: 'Catalog pack incomplete — run astellum prefetch',
    readingsCovered: 'Readings',
    savePredefined: 'Save as predefined reading',
    saveAnnotations: 'Save to my atlas overlay',
    savedAnnotations: 'Saved to your atlas overlay',
    savingPredefined: 'Saving…',
    savedPredefined: 'Saved to the predefined library',
    newReadingDesc:
      'Pick a deep-sky photo — ASTELLUM identifies the object, annotates it, then opens the editor.',
    pickImage: 'Choose image…',
    hintPlaceholder: 'Object hint (optional), e.g. "Sh2-308"',
    generate: 'Generate',
    generating: 'Reading…',
    calloutLabel: 'Magnify',
    calloutHint:
      'When it is too small to read, show the patch enlarged in an empty part of the frame. Three at most; drag the panel to move it.',
    roleLabel: 'Role',
    switchingRole: 'Switching role…',
    focusLabel: 'Focus',
    styleFreePlaceholder: 'Other instructions… (optional, appended to the prompt)',
    openExisting: 'Open existing',
    loading: 'Loading…',
    emptyWorkspace: 'No readings yet. Start a new one above.',
    stagePrefix: 'Stage',
    featuresSuffix: 'features',
    overlayTitle: 'Identifying and annotating…',
    overlaySub: 'Calling claude to read the image — this can take about a minute.',
    backToLibrary: '← Library',
    exportLabel: 'Export',
    exporting: 'Exporting…',
    exported: 'Exported:',
    savedTo: 'Saved to',
    browserDefault: 'browser default location',
    loadFailed: 'Failed to load',
    errorLabel: 'Error',
    narrative: 'Narrative',
    featuresLabel: 'Features',
    add: '+ Add',
    collapseAll: 'Collapse all',
    expandAll: 'Expand all',
    save: 'Save',
    saved: 'Saved',
    deleteFeature: 'Delete feature',
    badgeNum: 'Badge number',
    phExplanation: 'explanation',
    phPhysics: 'physics (optional)',
    phInteresting: 'interesting (optional)',
    fmtAnnotated: 'Annotated JPG',
    fmtPoster: 'Poster PNG',
    fmtAll: 'All',
    stageSolving: 'Plate-solving (this can take 30s–a few minutes)…',
    stageReading: 'Writing the bilingual reading…',
    reviewSuffix: 'to review',
    confirmReview: 'Confirm position',
    needsReviewTitle: 'Placed by the identification stage (B-class); drag to the right spot, then confirm',
    secIdentify: '① Identify (see placement)',
    secIdentifyDesc: 'Plate-solve + catalog only — view the fact sheet and A-class placement in the editor. No AI.',
    btnIdentify: 'Identify',
    identifying: 'Identifying…',
    secReading: '② AI reading',
    secReadingDesc: 'On top of identification, AI writes the bilingual reading + annotations. Needs claude.',
    reidentify: 'Re-identify',
    reidentifying: 'Identifying…',
    reidentifyConfirm: 'Re-identifying overwrites the current annotations and any generated reading text. Cannot be undone.',
    reidConfirmBtn: 'Re-identify',
    genOverwrite:
      'There are already {n} written passages. Generating again replaces them with new AI text — the current text, including your edits, will be lost.',
    genOverwriteBtn: 'Replace and generate',
    roleOverwrite:
      'Switching to “{role}” reads that role’s text from the library and replaces the current {n} passages, including your edits.',
    roleOverwriteBtn: 'Switch role',
    predefOverwrite:
      'The library already has text for this target as “{role}”. Saving overwrites the matching parts with the current text, and every other project of this target will read the new version.',
    predefOverwriteBtn: 'Overwrite',
    exportOverwrite: 'This folder already has: {files}. Exporting overwrites them.',
    exportOverwriteBtn: 'Overwrite',
    annsOverwrite:
      'You saved {n} annotations from this project to your atlas overlay before. Saving again replaces them with the current version — anything you have deleted here since the last save is removed from the overlay too.',
    annsOverwriteBtn: 'Replace annotations',
    reidClearsText: 'This reading already has {n} written passages (narrative and feature notes). Re-identifying erases all of them and they cannot be recovered. To keep them, use “Save as predefined reading” first.',
    reidCancel: 'Cancel',
    starMagLabel: 'Bright-star V <',
    genReading: '✦ Generate reading',
    genReadingRunning: 'Writing reading…',
    titleHint: 'Theme title (editable) — e.g. rename to Antares or "A palette in the sky"',
    gridShow: '⊞ Show grid',
    gridHide: '⊞ Hide grid',
    factsSolve: 'Solve',
    factsObjects: 'Catalog objects',
    factsFeaturesB: 'Morphological features (Class B · inferred)',
    factsBSourceCv: 'Image-detected (CV)',
    factsBSourceGeometric: 'Geometric',
    factsBSourceAi: 'AI',
    factsBSourceAtlas: 'Feature atlas',
    factsNoneYet: 'No fact sheet (this project predates the identification stage).',
    editTitle: 'Edit',
    editSub: 'Only when needed · changes show in the preview',
    panelFacts: 'Identification & facts',
    panelReading: 'Reading text',
    dragDivider: 'Drag to resize edit / preview',
    previewTitle: 'Preview · what you export',
    pvAnnotated: '🏷️ Labels only',
    pvLandscape: '🖼️ Landscape',
    pvPortrait: '📜 Portrait',
    fmtPosterLandscape: 'Landscape poster (PNG)',
    fmtPosterPortrait: 'Portrait poster (PNG)',
    exportAll: 'Export all formats',
    previewHint:
      'Drag on the picture: numbers, rings and magnified insets all move; select a ring and drag the dot on its edge to resize. Click empty sky or press Esc to deselect; ⌘/Ctrl+Z to undo.',
  },
};

interface LangCtx {
  lang: UiLang;
  setLang: (l: UiLang) => void;
}

const Ctx = createContext<LangCtx>({ lang: 'zh', setLang: () => {} });
const STORAGE_KEY = 'astellum.uiLang';

export function LangProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<UiLang>(
    () =>
      (localStorage.getItem(STORAGE_KEY) as UiLang | null) ??
      preferredLang(navigator.languages ?? [navigator.language]),
  );
  const setLang = useCallback((l: UiLang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useUi(): { lang: UiLang; setLang: (l: UiLang) => void; t: Strings } {
  const { lang, setLang } = useContext(Ctx);
  return { lang, setLang, t: STRINGS[lang] };
}

export function LangToggle(): React.JSX.Element {
  const { lang, setLang } = useUi();
  return (
    <button className="lang-toggle" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}>
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}

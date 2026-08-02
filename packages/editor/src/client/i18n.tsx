import type * as React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { preferredLang } from '@astrolens/schema';

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
  styleLabel: string;
  audienceLabel: string;
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
  pickerUnsupported: string;
  savedTo: string;
  saveModeFolder: string;
  saveModeDownload: string;
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
  fmtEmbed: string;
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
  reidConfirmBtn: string;
  reidCancel: string;
  starMagLabel: string;
  genReading: string;
  genReadingRunning: string;
  titleHint: string;
  gridShow: string;
  gridHide: string;
  factsTitle: string;
  factsSolve: string;
  factsObjects: string;
  factsFeaturesB: string;
  factsBSourceCv: string;
  factsBSourceGeometric: string;
  factsBSourceAi: string;
  factsBSourceAtlas: string;
  factsNoneYet: string;
}

const STRINGS: Record<UiLang, Strings> = {
  zh: {
    newReading: '新读图',
    atlasLink: '基准标注库',
    solverLabel: '解算器',
    backToHub: '导航',
    readyOffline: '可离线运行',
    notReadyOffline: '离线星表不全,先跑 astrolens prefetch',
    readingsCovered: '已录解读',
    savePredefined: '存为预定义解读',
    saveAnnotations: '存入我的标注库',
    savedAnnotations: '已存入标注库',
    savingPredefined: '保存中…',
    savedPredefined: '已存入预定义库',
    newReadingDesc: '选一张深空摄影图,astrolens 会识别天体并自动标注,然后进入微调页面。',
    pickImage: '选择图片…',
    hintPlaceholder: '对象名提示(可选),如 "Sh2-308"',
    generate: '生成读图',
    generating: '识别中…',
    styleLabel: '风格(可选)',
    audienceLabel: '读者',
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
    pickerUnsupported: '当前浏览器不支持选择文件夹,请使用 Chrome / Edge / Arc 等基于 Chromium 的浏览器。',
    savedTo: '已保存到',
    saveModeFolder: '选择文件夹',
    saveModeDownload: '直接下载',
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
    fmtEmbed: '互动网页 (HTML)',
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
    reidCancel: '取消',
    starMagLabel: '亮星阈值 V <',
    genReading: '✦ 生成解读',
    genReadingRunning: '生成解读中…',
    titleHint: '主题标题(可改),例如改成 Antares 或「天空中的调色盘」',
    gridShow: '⊞ 显示网格',
    gridHide: '⊞ 隐藏网格',
    factsTitle: '事实层 (Facts)',
    factsSolve: '解像',
    factsObjects: '目录天体',
    factsFeaturesB: '形态特征 (B 类 · 推断)',
    factsBSourceCv: '图像检测 (CV)',
    factsBSourceGeometric: '几何推断',
    factsBSourceAi: 'AI 推断',
    factsBSourceAtlas: '基准标注库',
    factsNoneYet: '没有事实层(此项目早于识别阶段)。',
  },
  en: {
    newReading: 'New reading',
    atlasLink: 'Feature Atlas',
    solverLabel: 'Solver',
    backToHub: 'Home',
    readyOffline: 'Ready offline',
    notReadyOffline: 'Catalog pack incomplete — run astrolens prefetch',
    readingsCovered: 'Readings',
    savePredefined: 'Save as predefined reading',
    saveAnnotations: 'Save to my atlas overlay',
    savedAnnotations: 'Saved to your atlas overlay',
    savingPredefined: 'Saving…',
    savedPredefined: 'Saved to the predefined library',
    newReadingDesc:
      'Pick a deep-sky photo — astrolens identifies the object, annotates it, then opens the editor.',
    pickImage: 'Choose image…',
    hintPlaceholder: 'Object hint (optional), e.g. "Sh2-308"',
    generate: 'Generate',
    generating: 'Reading…',
    styleLabel: 'Style (optional)',
    audienceLabel: 'Audience',
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
    pickerUnsupported: 'This browser does not support the folder picker. Use a Chromium-based browser (Chrome / Edge / Arc).',
    savedTo: 'Saved to',
    saveModeFolder: 'Folder picker',
    saveModeDownload: 'Browser download',
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
    fmtEmbed: 'Embed HTML',
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
    reidCancel: 'Cancel',
    starMagLabel: 'Bright-star V <',
    genReading: '✦ Generate reading',
    genReadingRunning: 'Writing reading…',
    titleHint: 'Theme title (editable) — e.g. rename to Antares or "A palette in the sky"',
    gridShow: '⊞ Show grid',
    gridHide: '⊞ Hide grid',
    factsTitle: 'Facts',
    factsSolve: 'Solve',
    factsObjects: 'Catalog objects',
    factsFeaturesB: 'Morphological features (Class B · inferred)',
    factsBSourceCv: 'Image-detected (CV)',
    factsBSourceGeometric: 'Geometric',
    factsBSourceAi: 'AI',
    factsBSourceAtlas: 'Feature atlas',
    factsNoneYet: 'No fact sheet (this project predates the identification stage).',
  },
};

interface LangCtx {
  lang: UiLang;
  setLang: (l: UiLang) => void;
}

const Ctx = createContext<LangCtx>({ lang: 'zh', setLang: () => {} });
const STORAGE_KEY = 'astrolens.uiLang';

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

import { createContext, useContext, useState, type ReactNode } from 'react';

// Minimal bilingual layer — zh default, matches astrolens convention. UI strings
// are keyed; annotation labels are stored bilingually in the data, not here.

export type Lang = 'zh' | 'en';

const STRINGS = {
  title: { zh: '基准标注库', en: 'Feature Atlas' },
  subtitle: { zh: 'B 类形态特征基准标注', en: 'B-class morphology baseline annotations' },
  upload: { zh: '上传参考图', en: 'Upload reference image' },
  solving: { zh: '正在定位（plate-solve，可能要几分钟）…', en: 'Plate-solving (can take minutes)…' },
  identifying: { zh: '正在定位并识别天体（可能要几分钟）…', en: 'Solving + identifying (can take minutes)…' },
  storing: { zh: '正在保存图像…', en: 'Storing image…' },
  typeLabel: { zh: '类型', en: 'Type' },
  autoFilled: { zh: '身份已自动识别，可修改', en: 'Identity auto-detected — edit if needed' },
  noIdentify: { zh: '未识别到已知天体，请手动填主 ID', en: 'No known object identified — enter a primary ID manually' },
  solveFailed: { zh: '定位失败', en: 'Solve failed' },
  solved: { zh: '已定位', en: 'Solved' },
  stepUpload: { zh: '上传参考图', en: 'Upload reference image' },
  stepIdentity: { zh: '确认身份', en: 'Confirm identity' },
  stepDraw: { zh: '画特征', en: 'Draw features' },
  stepSave: { zh: '保存到库', en: 'Save to atlas' },
  drawSteps: {
    zh: '① 选类型 → ② 填专名（可选）→ ③「开始绘制」，在图上逐点点出轮廓 → ④「结束并保存本次绘制」',
    en: '① pick type → ② name it (optional) → ③ Start drawing, click vertices → ④ Finish & save this shape',
  },
  navHint: { zh: '未绘制时：拖动平移、滚轮缩放', en: 'When not drawing: drag to pan, scroll to zoom' },
  startDraw: { zh: '开始绘制', en: 'Start drawing' },
  finishSave: { zh: '结束并保存本次绘制', en: 'Finish & save this shape' },
  endDraw: { zh: '结束绘制（丢弃）', en: 'Discard drawing' },
  pointsPlaced: { zh: '已点 {n} 个顶点', en: '{n} vertices placed' },
  listHint: { zh: '存入库前，可点图上标记「×」删除某条', en: 'Before saving, click the × on a shape to delete it' },
  libraryTitle: { zh: '库中已有', en: 'In the atlas' },
  targetsTitle: { zh: '目标清单', en: 'Targets' },
  targetsDone: { zh: '已标 {a}/{b}', en: '{a}/{b} annotated' },
  searchPlaceholder: { zh: '搜索目标…', en: 'Search targets…' },
  fAll: { zh: '全部', en: 'All' },
  fNone: { zh: '未标', en: 'Not started' },
  fDraft: { zh: '有草稿', en: 'Has draft' },
  fReview: { zh: '待审', en: 'In review' },
  fApproved: { zh: '已批准', en: 'Approved' },
  fNoImage: { zh: '缺图', en: 'No image' },
  hasImage: { zh: '已有参考图，可直接标注', en: 'Reference image ready — can annotate' },
  noMatch: { zh: '没有匹配的目标', en: 'No matching targets' },
  suggested: { zh: '建议标注', en: 'Suggested' },
  currentUser: { zh: '当前用户', en: 'Current user' },
  solverLabel: { zh: '解算器', en: 'Solver' },
  // edit modes
  previewOnly: { zh: '只读预览 — 点「编辑真值」修改或审核', en: 'Read-only preview — click "Edit canonical" to change or review' },
  editingCanonical: { zh: '编辑真值中（改动会写回基准库）', en: 'Editing canonical (changes go to the shared baseline)' },
  checkingOther: { zh: '核对模式（只读）— 用当前图 WCS 投影，验证落点', en: 'Verify mode (read-only) — projected with this image’s WCS' },
  editCanonical: { zh: '编辑真值', en: 'Edit canonical' },
  checkOther: { zh: '用另一张图核对', en: 'Verify on another image' },
  exitCheck: { zh: '退出核对', en: 'Exit verify' },
  // review status
  stDraft: { zh: '草稿', en: 'draft' },
  stReview: { zh: '待审', en: 'in review' },
  stApproved: { zh: '已批准', en: 'approved' },
  reviewedBy: { zh: '审核', en: 'by' },
  exportRegistry: { zh: '导出 registry（仅 approved）', en: 'Export registry (approved only)' },
  exported: { zh: '已导出', en: 'Exported' },
  identity: { zh: '目标身份', en: 'Target identity' },
  primaryId: { zh: '主 ID（如 NGC 3372）', en: 'Primary ID (e.g. NGC 3372)' },
  aliases: { zh: '别名（逗号分隔）', en: 'Aliases (comma-separated)' },
  featureType: { zh: '特征类型', en: 'Feature type' },
  labelName: { zh: '特征名（可选）', en: 'Feature name (optional)' },
  labelHelp: {
    zh: '这条特征的专有名，如「神秘山」「锁孔」「创生之柱」。没有专名就留空 → 会用类型通用名（如「尘埃暗带」）。',
    en: 'The proper name of this feature, e.g. "Mystic Mountain", "Keyhole". Leave blank if it has none → the generic type name is used.',
  },
  labelZh: { zh: '专名（中文）', en: 'Name (zh)' },
  labelEn: { zh: '专名（English）', en: 'Name (en)' },
  annotations: { zh: '标注', en: 'Annotations' },
  save: { zh: '保存到库', en: 'Save to atlas' },
  saved: { zh: '已保存', en: 'Saved' },
  saveConflict: {
    zh: '这条已被他人修改，请刷新页面重新载入后再保存（避免覆盖对方的改动）。',
    en: 'Someone else changed this entry — reload before saving so you don’t overwrite their work.',
  },
  required: { zh: '必填', en: 'required' },
  needImage: { zh: '需先上传并定位一张参考图', en: 'Upload & solve a reference image first' },
  needId: { zh: '需先填「主 ID」才能保存', en: 'Enter a primary ID to save' },
  noImage: { zh: '先上传一张参考图开始', en: 'Upload a reference image to start' },
} as const;

type Key = keyof typeof STRINGS;

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
}

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lang, setLang] = useState<Lang>('zh');
  const t = (k: Key): string => STRINGS[k][lang];
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error('useLang outside provider');
  return c;
}

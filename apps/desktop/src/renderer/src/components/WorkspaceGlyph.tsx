import {
  BriefcaseBusiness,
  ChartNoAxesColumn,
  Compass,
  Earth,
  Feather,
  Film,
  FlaskConical,
  LockKeyhole,
  ShoppingBag,
  Terminal,
} from 'lucide-react'

export const workspaceGlyphs = [
  { value: '🧭', label: '浏览', Icon: Compass },
  { value: '🔐', label: '账号', Icon: LockKeyhole },
  { value: '💼', label: '工作', Icon: BriefcaseBusiness },
  { value: '🌐', label: '网络', Icon: Earth },
  { value: '🛒', label: '购物', Icon: ShoppingBag },
  { value: '🐦', label: '社交', Icon: Feather },
  { value: '🧪', label: '实验', Icon: FlaskConical },
  { value: '🤖', label: '开发', Icon: Terminal },
  { value: '🎬', label: '影视', Icon: Film },
  { value: '📊', label: '数据', Icon: ChartNoAxesColumn },
]

export const workspaceColors = [
  '#1F5AE0', '#147A6B', '#B45D12', '#6D4DC7', '#BE3B62', '#3C6E8F', '#4D7C0F',
]

export function WorkspaceGlyph({ value, size = 17 }: { value: string; size?: number }) {
  const Icon = workspaceGlyphs.find((item) => item.value === value)?.Icon
  return Icon
    ? <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
    : <span aria-hidden="true">{value}</span>
}

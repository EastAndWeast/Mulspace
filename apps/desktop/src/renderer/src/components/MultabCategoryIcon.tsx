import {
  Bookmark,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  Code2,
  Compass,
  Folder,
  Globe,
  Heart,
  Layers,
  LayoutGrid,
  PenTool,
  ShoppingBag,
  Sparkles,
  Star,
} from 'lucide-react'

export const multabCategoryIcons = [
  { id: 'folder', label: '分类', Icon: Folder },
  { id: 'hotel', label: '酒店', Icon: Building2 },
  { id: 'layers', label: '项目', Icon: Layers },
  { id: 'compass', label: '导航', Icon: Compass },
  { id: 'briefcase', label: '办公', Icon: BriefcaseBusiness },
  { id: 'grid', label: '工具', Icon: LayoutGrid },
  { id: 'heart', label: '收藏', Icon: Heart },
  { id: 'code', label: '开发', Icon: Code2 },
  { id: 'pen', label: '设计', Icon: PenTool },
  { id: 'globe', label: '常用', Icon: Globe },
  { id: 'sparkles', label: '灵感', Icon: Sparkles },
  { id: 'bot', label: 'AI', Icon: Bot },
  { id: 'bookmark', label: '书签', Icon: Bookmark },
  { id: 'book', label: '文档', Icon: BookOpen },
  { id: 'star', label: '精选', Icon: Star },
  { id: 'shopping', label: '商业', Icon: ShoppingBag },
] as const

export const multabCategoryPickerIcons = multabCategoryIcons.slice(0, 12)

export function MultabCategoryIcon({ name, size = 14 }: { name: string; size?: number }) {
  const match = multabCategoryIcons.find((item) => item.id === name)
  const Icon = match?.Icon ?? Folder
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
}

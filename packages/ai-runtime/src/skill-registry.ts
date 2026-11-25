import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillDefinition, WorkspaceId } from '@wb/contracts'
import { parse as parseYaml } from 'yaml'

export const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    id: 'builtin_summarize_page',
    name: '网页内容精炼总结',
    description: '读取当前工作区激活标签的可访问性树与文本摘要，提炼核心要点与关键链接。',
    promptTemplate:
      '请先调用 get_page_snapshot 读取当前激活标签页内容，然后用简洁的中文结构化要点总结核心内容、关键数据与可执行链接。',
    allowedTools: ['get_page_snapshot'],
    scope: 'global',
    builtIn: true,
  },
  {
    id: 'builtin_account_env_audit',
    name: '当前工作区环境与防串号体检',
    description: '检查当前账号工作区的隔离分区、代理状态与活动标签页，输出环境健康报告。',
    promptTemplate:
      '请检查当前工作区环境信息，确认存储隔离、WebRTC 策略与代理配置是否安全，并给出优化建议。',
    allowedTools: ['get_workspace_env', 'get_page_snapshot'],
    scope: 'global',
    builtIn: true,
  },
  {
    id: 'builtin_extract_structured',
    name: '页面结构化信息提取',
    description: '从当前页面提取表格、按钮、输入框与核心字段为 JSON 清单。',
    promptTemplate:
      '请调用 get_page_snapshot 获取当前页面可交互元素与文本摘要，整理出清晰的结构化字段清单（JSON 或 Markdown 表格）。',
    allowedTools: ['get_page_snapshot'],
    scope: 'global',
    builtIn: true,
  },
]

export function parseSkillMarkdown(rawMarkdown: string, sourcePath?: string): SkillDefinition {
  const match = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    throw new Error('SKILL.md 缺少 YAML Frontmatter (--- ... ---)')
  }

  const frontmatter = (parseYaml(match[1] ?? '') ?? {}) as Record<string, unknown>
  const body = (match[2] ?? '').trim()
  const name = String(frontmatter.name ?? '').trim()
  const description = String(frontmatter.description ?? '').trim()
  if (!name) {
    throw new Error('SKILL.md Frontmatter 缺少 name 字段')
  }

  const rawTools = Array.isArray(frontmatter.tools)
    ? frontmatter.tools.map(String)
    : ['get_page_snapshot']

  const rawScope = frontmatter.scope ? String(frontmatter.scope) : 'global'
  const id =
    (frontmatter.id ? String(frontmatter.id) : `skill_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)

  return {
    id,
    name,
    description: description || name,
    promptTemplate: body || description || name,
    allowedTools: rawTools,
    scope: rawScope,
    sourcePath,
    builtIn: false,
  }
}

export class SkillRegistry {
  private customSkills: SkillDefinition[] = []
  private diskSkills: SkillDefinition[] = []

  constructor(private readonly skillsDir?: string) {}

  setCustomSkills(skills: SkillDefinition[]): void {
    this.customSkills = skills.map((s) => structuredClone(s))
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.skillsDir) {
      this.diskSkills = []
      return
    }
    const loaded: SkillDefinition[] = []
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillFile = join(this.skillsDir, entry.name, 'SKILL.md')
        try {
          const content = await readFile(skillFile, 'utf8')
          loaded.push(parseSkillMarkdown(content, skillFile))
        } catch {
          // Ignore invalid/missing SKILL.md
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    this.diskSkills = loaded
  }

  list(workspaceId?: WorkspaceId): SkillDefinition[] {
    const merged = new Map<string, SkillDefinition>()
    for (const s of BUILT_IN_SKILLS) merged.set(s.id, s)
    for (const s of this.diskSkills) merged.set(s.id, s)
    for (const s of this.customSkills) merged.set(s.id, s)

    const all = [...merged.values()]
    if (!workspaceId) return all.map((s) => structuredClone(s))
    return all
      .filter((s) => s.scope === 'global' || s.scope === workspaceId)
      .map((s) => structuredClone(s))
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.list().find((s) => s.id === skillId)
  }
}

import type { AgentSkill } from '@genoffice/agent-core'
import { AGENT_TOOLS, executePdfTool } from './tools'
import type { PdfAiDeps } from './tools'

export function createPdfSkill(deps: PdfAiDeps): AgentSkill {
  return {
    id: 'pdf',
    systemPrompt: '',
    tools: AGENT_TOOLS,
    buildContext: () => {
      const parts = [
        `Current document: "${deps.fileName()}", ${deps.pageCount()} pages; the user is viewing page ${deps.currentPage()}.`,
      ]
      if (deps.readOnly())
        parts.push('The document is encrypted and read-only; it cannot be modified.')
      const outline = deps.outline()
      if (outline && outline.length > 0) {
        parts.push(
          `The document has an outline (${outline.length} top-level entries); use get_outline to view it.`,
        )
      }
      return parts.join('\n')
    },
    executeTool: (call) => executePdfTool(deps, call),
  }
}

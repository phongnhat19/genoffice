import type { AgentSkill } from '@genoffice/agent-core'
import type { AttachmentMeta } from '../../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import { t } from '../i18n/locale'
import type { ProjectMention } from '@genoffice/ui'

/**
 * Chat-attachment capability as an AgentSkill: the per-turn context lists the
 * attached local files, and read_attachment pages through their extracted
 * text (parsing happens in the main process; files never leave the machine).
 */

const READ_CHUNK_CHARS = 24_000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function createFilesSkill(
  getAttachments: () => AttachmentMeta[],
  getMentions: () => ProjectMention[] = () => [],
): AgentSkill {
  return {
    id: 'files',
    systemPrompt: '',
    tools: [
      {
        name: 'read_attachment',
        description:
          'Read the text content of an attachment (parsed locally). Long files are paged: read offset=0 first, then decide whether to continue based on the returned total character count.',
        inputSchema: {
          type: 'object',
          properties: {
            index: {
              type: 'integer',
              description: 'attachment index (0-based, see the attachment list)',
            },
            offset: { type: 'integer', description: 'start character position, default 0' },
          },
          required: ['index'],
        },
      },
      {
        name: 'read_file',
        description:
          'Read a file explicitly mentioned with @ in this user request. Use its root-relative path from the mentioned-file list. Long files are paged; continue with offset when needed.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, offset: { type: 'integer' } },
          required: ['path'],
        },
      },
    ],
    buildContext: () => {
      const list = getAttachments()
      const mentioned = getMentions()
      const attachmentContext =
        list.length === 0
          ? ''
          : `Attachment list (index | file name | type | size):\n${list.map((a, i) => `${i} | ${a.name} | .${a.ext} | ${formatSize(a.sizeBytes)}`).join('\n')}`
      const mentionContext =
        mentioned.length === 0
          ? ''
          : `Mentioned project files (read with read_file path):\n${mentioned.map((m) => `${m.path} | .${m.ext} | ${formatSize(m.sizeBytes)}`).join('\n')}`
      return [attachmentContext, mentionContext].filter(Boolean).join('\n\n')
    },
    executeTool: async (call) => {
      if (call.name === 'read_file') {
        const path = String(call.input.path ?? '')
        const mention = getMentions().find((item) => item.path === path)
        if (!mention)
          return {
            output: 'This file was not explicitly mentioned in the current request.',
            isError: true,
            summary: 'read file',
          }
        const result = await window.projectApi.readProjectFile({
          projectId: mention.projectId,
          path,
          offset: Math.max(0, Number(call.input.offset) || 0),
          maxChars: READ_CHUNK_CHARS,
          ...(mention.rootPath ? { rootPath: mention.rootPath } : {}),
        })
        if (!result.ok)
          return {
            output: result.error ?? 'read failed',
            isError: true,
            summary: `read ${mention.name}`,
          }
        const end = (result.offset ?? 0) + (result.text?.length ?? 0)
        return {
          output: `File ${path}, total characters ${result.totalChars}, slice ${result.offset}-${end}${end < (result.totalChars ?? 0) ? ` (continue with offset=${end})` : ' (end of file)'}\n---\n${result.text ?? ''}`,
          mutated: false,
          summary: `read ${mention.name}`,
        }
      }
      if (call.name !== 'read_attachment') {
        return { output: `unknown tool: ${call.name}`, isError: true, summary: call.name }
      }
      const list = getAttachments()
      const index = Number(call.input.index)
      const att = Number.isInteger(index) ? list[index] : undefined
      if (!att) {
        return {
          output: 'invalid attachment index (see the attachment list)',
          isError: true,
          summary: t('aiSumReadAttachment'),
        }
      }
      // no text extraction for images: already provided as a multimodal image with the user message on send
      if (ATTACHMENT_IMAGE_EXTS.has(att.ext)) {
        return {
          output: `${att.name} is an image attachment already sent as an image with the user message; just look at the image in the message, no text to read.`,
          mutated: false,
          summary: t('aiSumImageAttachment', { name: att.name }),
        }
      }
      const offset = Math.max(0, Number(call.input.offset) || 0)
      const result = await window.desktop.readAttachment(att.path, offset, READ_CHUNK_CHARS)
      if (!result.ok) {
        return {
          output: result.error ?? 'read failed',
          isError: true,
          summary: t('aiSumRead', { name: att.name }),
        }
      }
      const end = (result.offset ?? 0) + (result.text?.length ?? 0)
      const header = `File ${att.name}, total characters ${result.totalChars}, this slice ${result.offset}-${end}${
        end < (result.totalChars ?? 0)
          ? ' (not finished, continue with offset=' + end + ')'
          : ' (end of file)'
      }`
      return {
        output: `${header}\n---\n${result.text ?? ''}`,
        mutated: false,
        summary: t('aiSumReadAttachmentName', { name: att.name }),
      }
    },
  }
}

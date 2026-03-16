const EMBEDDED_ATTACHMENT_LIMIT_BYTES = 40 * 1024

export function getEmbeddedAttachmentLimit(): number {
  return EMBEDDED_ATTACHMENT_LIMIT_BYTES
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isImageAttachment(file: File): boolean {
  return file.type.startsWith('image/')
}

export function createFileAttachmentMarkup(file: File, dataUrl: string): string {
  return [
    `<a class="message-attachment" href="${escapeAttribute(dataUrl)}" download="${escapeAttribute(file.name)}"`,
    ` data-attachment="file" data-file-name="${escapeAttribute(file.name)}"`,
    ` data-file-size="${file.size}" data-file-type="${escapeAttribute(file.type || 'application/octet-stream')}">`,
    `<span class="message-attachment__title">${escapeHtml(file.name)}</span>`,
    `<span class="message-attachment__meta">${escapeHtml(formatAttachmentSize(file.size))} · ${escapeHtml(resolveAttachmentLabel(file.type))}</span>`,
    `</a><p></p>`,
  ].join('')
}

function resolveAttachmentLabel(mimeType: string): string {
  if (!mimeType) {
    return 'file'
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }
  if (mimeType.startsWith('video/')) {
    return 'video'
  }
  if (mimeType.includes('pdf')) {
    return 'pdf'
  }
  if (mimeType.startsWith('text/')) {
    return 'text'
  }
  return 'file'
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

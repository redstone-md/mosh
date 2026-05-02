export function setRoomDraftValue(
  drafts: Record<string, string>,
  roomId: string,
  value: string
): Record<string, string> {
  if (isEmptyDraft(value)) {
    const { [roomId]: _removed, ...rest } = drafts
    return rest
  }

  return {
    ...drafts,
    [roomId]: value,
  }
}

export function getRoomDraftPreview(value: string, maxLength = 34): string {
  const normalized = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function isEmptyDraft(value: string): boolean {
  return getRoomDraftPreview(value).length === 0
}

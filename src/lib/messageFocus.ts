const MESSAGE_FOCUS_CLASSES = [
  'ring-2',
  'ring-primary',
  'ring-offset-2',
  'ring-offset-background',
  'transition-all',
  'duration-500',
] as const

export function focusMessageElement(messageId: string, highlight = false): boolean {
  const target = document.getElementById(messageId)
  if (!target) {
    return false
  }

  target.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })

  if (highlight) {
    target.classList.add(...MESSAGE_FOCUS_CLASSES)
    window.setTimeout(() => {
      target.classList.remove(...MESSAGE_FOCUS_CLASSES)
    }, 1500)
  }

  return true
}

import { useEffect, useState } from 'react'

import { useI18n } from './I18nProvider'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Textarea } from './ui/textarea'

type MessageEditDialogProps = {
  open: boolean
  initialValue: string
  onOpenChange: (open: boolean) => void
  onSave: (value: string) => void
}

export function MessageEditDialog({ open, initialValue, onOpenChange, onSave }: MessageEditDialogProps) {
  const { copy } = useI18n()
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [initialValue, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.messages.edit}</DialogTitle>
          <DialogDescription>{copy.messages.editDescription}</DialogDescription>
        </DialogHeader>
        <Textarea value={value} onChange={(event) => setValue(event.target.value)} className="min-h-40 resize-y" />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.common.dismiss}
          </Button>
          <Button type="button" onClick={() => onSave(value)} disabled={!value.trim()}>
            {copy.messages.saveEdit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

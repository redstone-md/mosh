import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

export const MentionList = forwardRef((props: any, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = (index: number) => {
    const item = props.items[index]
    if (item) {
      props.command({ id: item })
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }
      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }
      if (event.key === 'Enter') {
        enterHandler()
        return true
      }
      return false
    },
  }))

  return (
    <div className="bg-background/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl p-1 overflow-hidden min-w-[150px] z-50">
      {props.items.length ? (
        props.items.map((item: string, index: number) => (
          <button
            className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
              index === selectedIndex ? 'bg-primary/20 text-primary font-bold' : 'text-foreground/80 hover:bg-white/5'
            }`}
            key={index}
            onClick={() => selectItem(index)}
          >
            {item}
          </button>
        ))
      ) : (
        <div className="px-3 py-2 text-sm text-foreground/50">No result</div>
      )}
    </div>
  )
})

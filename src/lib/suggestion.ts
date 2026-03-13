import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance, type Props } from 'tippy.js'
import { MentionList } from '../components/MentionList'

export default function makeSuggestion(peers: string[]) {
  return {
    items: ({ query }: { query: string }) => {
      return peers.filter((item) => item.toLowerCase().startsWith(query.toLowerCase())).slice(0, 5)
    },

    render: () => {
      let component: ReactRenderer
      let popup: Instance<Props>[]

      return {
        onStart: (props: any) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })

          if (!props.clientRect) {
            return
          }

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'top-start',
          })
        },

        onUpdate(props: any) {
          component.updateProps(props)

          if (!props.clientRect) {
            return
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          })
        },

        onKeyDown(props: any) {
          if (props.event.key === 'Escape') {
            popup[0].hide()
            return true
          }

          return (component.ref as any)?.onKeyDown(props)
        },

        onExit() {
          popup[0].destroy()
          component.destroy()
        },
      }
    },
  }
}
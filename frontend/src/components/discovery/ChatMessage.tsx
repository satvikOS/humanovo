// ChatMessage — individual message bubble in the Discovery conversation.
//
// Minimal chrome (no sidebar-style avatar framing) and muted
// colours to match the rest of the platform. Renders markdown-lite
// via a tiny inline renderer so assistant output reads as prose
// without pulling in a full markdown dep.
//
// Rich cards (hypothesis / evidence / entity) render beneath the
// message body when the assistant returns them.
import type { DiscoveryMessage } from '../../services/api'
import RichCard from './RichCard'
import { FiCopy, FiCheck, FiUser, FiCpu } from 'react-icons/fi'
import { useState } from 'react'

interface ChatMessageProps {
  message: DiscoveryMessage
  // Set to true for the last assistant message while the stream is
  // still arriving — renders a blinking caret at the end of the body.
  streaming?: boolean
  onCardAction?: (cardKind: string, payload: Record<string, unknown>) => void
}

// Very small markdown-to-JSX — handles **bold**, *italic*, > blockquote,
// newlines, and fenced `code`. Keeps the bundle light; anything more
// ambitious can swap in react-markdown later.
function renderLite(text: string): React.ReactNode {
  if (!text) return null
  const lines = text.split('\n')
  return lines.map((line, li) => {
    if (line.startsWith('> ')) {
      return (
        <blockquote key={li} className="border-l-2 border-[var(--color-border)] pl-3 my-1 text-[var(--color-text-muted)] italic">
          {renderInline(line.slice(2))}
        </blockquote>
      )
    }
    return <div key={li} className={line ? '' : 'h-2'}>{renderInline(line)}</div>
  })
}

function renderInline(text: string): React.ReactNode {
  // Handle **bold**, *italic*, `code` — simple regex pass.
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const token = match[0]
    if (token.startsWith('**')) parts.push(<strong key={match.index} className="font-semibold">{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) parts.push(<em key={match.index}>{token.slice(1, -1)}</em>)
    else if (token.startsWith('`')) parts.push(<code key={match.index} className="px-1 py-0.5 rounded text-[0.85em] bg-[var(--glass-bg)] font-mono">{token.slice(1, -1)}</code>)
    last = match.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : text
}

export default function ChatMessage({ message, streaming, onCardAction }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* ignore */ }
  }

  // Compact pill for system messages.
  if (isSystem) {
    return (
      <div className="my-3 mx-auto px-3 py-1.5 text-xxs rounded-full border border-[var(--glass-border)] text-[var(--color-text-muted)] bg-[var(--glass-bg)] w-fit">
        {message.content}
      </div>
    )
  }

  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center" title="Humanovo">
          <FiCpu className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </div>
      )}
      <div className={`max-w-[72ch] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[var(--color-surface-raised)] border border-[var(--color-border)]'
              : 'border border-[var(--glass-border)] bg-transparent'
          }`}
          style={{ color: 'var(--color-text)' }}
        >
          {renderLite(message.content)}
          {streaming && (
            <span className="inline-block w-1.5 h-4 align-middle ml-0.5 bg-[var(--color-text-muted)] animate-pulse" aria-hidden="true" />
          )}
        </div>
        {isAssistant && message.cards && message.cards.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.cards.map((card, i) => (
              <RichCard key={i} card={card} onAction={onCardAction} />
            ))}
          </div>
        )}
        {/* Toolbar on hover */}
        {!streaming && (
          <div className={`mt-1 flex gap-2 text-xxs text-[var(--color-text-muted)] ${isUser ? 'justify-end' : 'justify-start'} opacity-0 group-hover:opacity-100 transition-opacity`}>
            <button onClick={copy} className="flex items-center gap-1 hover:text-[var(--color-text)]" aria-label="Copy message">
              {copied ? <FiCheck className="w-3 h-3" /> : <FiCopy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {message.timestamp && (
              <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            {message.tokens && (
              <span>·  {message.tokens.completion} tok</span>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] flex items-center justify-center" title="You">
          <FiUser className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
        </div>
      )}
    </div>
  )
}

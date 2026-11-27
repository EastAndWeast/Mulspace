import { memo, useEffect, useRef, useState } from 'react'
import { NEW_TAB_URL } from '@wb/contracts'
import { Globe, Lock, Search } from 'lucide-react'

interface AddressBarProps {
  tabId?: string | null
  tabUrl?: string
  onNavigate: (input: string) => void
}

export const AddressBar = memo(function AddressBar({
  tabId,
  tabUrl,
  onNavigate,
}: AddressBarProps) {
  const [addressInput, setAddressInput] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return window.browserApi.onFocusOmnibox(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setAddressInput(!tabUrl || tabUrl === NEW_TAB_URL ? '' : tabUrl)
    }
  }, [tabId, tabUrl])

  const trimmed = addressInput.trim()
  const showNewTab = tabUrl === NEW_TAB_URL
  const isSecureHttps = !showNewTab && /^https:\/\//i.test(trimmed)
  const isNavUrl = !showNewTab && /^[a-z][a-z\d+\-.]*:/i.test(trimmed)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!trimmed) return
        inputRef.current?.blur()
        onNavigate(trimmed)
      }}
      className="wb-address"
    >
      <span className="wb-address__icon" aria-hidden="true">
        {isSecureHttps ? (
          <Lock size={13} strokeWidth={1.8} className="wb-address__secure" />
        ) : isNavUrl ? (
          <Globe size={14} strokeWidth={1.7} />
        ) : (
          <Search size={14} strokeWidth={1.7} />
        )}
      </span>
      <input
        ref={inputRef}
        className="wb-omnibox"
        value={addressInput}
        onChange={(e) => setAddressInput(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        placeholder="输入网址或搜索…"
        aria-label="地址栏"
        spellCheck={false}
      />
    </form>
  )
})

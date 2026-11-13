import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

interface GeoResponse {
  city: string
  country: string
  runtime: string
}

interface ExplainResponse {
  topic: string
  explanation: string
  codeExample: string
  source: string
  cached: boolean
  isFallback?: boolean
  generatedAt?: string
}

const QUICK_TOPICS = ['Closures', 'Promises', 'Async/Await', 'Event Loop', 'Hoisting']

const JS_TOKEN_REGEX =
  /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|async|await|new|Promise|if|else|try|catch|for|of|in|setTimeout|console|true|false|null|undefined|throw|class)\b|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][\w$]*(?=\s*\())/g

function highlightJs(code: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  JS_TOKEN_REGEX.lastIndex = 0

  while ((match = JS_TOKEN_REGEX.exec(code)) !== null) {
    if (match.index > lastIndex) {
      parts.push(code.slice(lastIndex, match.index))
    }
    const token = match[0]
    let className = 'tok-fn'
    if (token.startsWith('//')) {
      className = 'tok-com'
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      className = 'tok-str'
    } else if (/^\d/.test(token)) {
      className = 'tok-num'
    } else if (
      /^(const|let|var|function|return|async|await|new|Promise|if|else|try|catch|for|of|in|true|false|null|undefined|throw|class)$/.test(
        token,
      )
    ) {
      className = 'tok-kw'
    }
    parts.push(
      <span key={match.index} className={className}>
        {token}
      </span>,
    )
    lastIndex = JS_TOKEN_REGEX.lastIndex
  }

  if (lastIndex < code.length) {
    parts.push(code.slice(lastIndex))
  }

  return parts
}

export default function App() {
  const [geo, setGeo] = useState<GeoResponse | null>(null)
  const [geoRtt, setGeoRtt] = useState<number | null>(null)

  const [inputValue, setInputValue] = useState('Closures')
  const [activeTopic, setActiveTopic] = useState('closures')
  const [card, setCard] = useState<ExplainResponse | null>(null)
  const [fetchLatency, setFetchLatency] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch visitor location from Netlify Edge Function (/api/geo)
  useEffect(() => {
    let cancelled = false
    const loadGeo = async () => {
      const start = performance.now()
      try {
        const res = await fetch('/api/geo')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as GeoResponse
        const elapsed = Math.max(1, Math.round(performance.now() - start))
        if (!cancelled) {
          setGeo(data)
          setGeoRtt(elapsed)
        }
      } catch {
        if (!cancelled) {
          setGeo({
            city: 'Local Dev',
            country: 'Local Network',
            runtime: 'Deno at CDN Edge',
          })
        }
      }
    }
    void loadGeo()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchExplanation = useCallback(async (rawTopic: string) => {
    const normalized = rawTopic.trim().toLowerCase() || 'closures'
    setActiveTopic(normalized)
    setLoading(true)
    setError(null)

    const start = performance.now()
    try {
      const res = await fetch(`/api/explain?topic=${encodeURIComponent(normalized)}`)
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`)
      }
      const data = (await res.json()) as ExplainResponse
      const elapsed = Math.max(1, Math.round(performance.now() - start))
      setCard(data)
      setFetchLatency(elapsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch explanation')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load with default topic ("closures")
  useEffect(() => {
    void fetchExplanation('closures')
  }, [fetchExplanation])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    void fetchExplanation(inputValue)
  }

  const handleChipClick = (chip: string) => {
    setInputValue(chip)
    void fetchExplanation(chip)
  }

  const handleClearAndRegenerate = async () => {
    if (!activeTopic) return
    setClearing(true)
    setError(null)
    try {
      const delRes = await fetch(`/api/explain?topic=${encodeURIComponent(activeTopic)}`, {
        method: 'DELETE',
      })
      if (!delRes.ok) {
        throw new Error(`Failed to clear cache (HTTP ${delRes.status})`)
      }
      await fetchExplanation(activeTopic)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache')
    } finally {
      setClearing(false)
    }
  }

  const getBadgeDetails = (data: ExplainResponse) => {
    if (data.cached) {
      return {
        className: 'source-badge cache-hit',
        label: '⚡ Netlify Blobs Cache (Instant)',
      }
    }
    if (data.isFallback) {
      return {
        className: 'source-badge fallback-llm',
        label: '🔌 Netlify AI Gateway (Local Preview — Unlinked)',
      }
    }
    return {
      className: 'source-badge live-llm',
      label: '✨ Netlify AI Gateway (Live LLM)',
    }
  }

  return (
    <>
      {/* Top Edge Status Bar */}
      <header className="status-bar">
        <div className="status-bar-inner">
          <div className="status-left">
            <span className="edge-badge">
              <span className="pulse-dot" />
              Edge Function (Deno)
            </span>
            <span className="geo-text">
              {geo ? (
                <>
                  Visitor Location: <strong>{geo.city}</strong>, <strong>{geo.country}</strong> ·{' '}
                  {geo.runtime}
                </>
              ) : (
                'Resolving edge location via /api/geo...'
              )}
            </span>
          </div>
          <div className="status-right">
            {geoRtt !== null && <span className="rtt-pill">/api/geo RTT: {geoRtt} ms</span>}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        <section className="hero">
          <span className="hero-eyebrow">Netlify Platform Primitives Demo</span>
          <h1>Netlify JS Flashcards</h1>
          <p>
            Pick a JavaScript concept below. On a cache miss, a{' '}
            <strong>Serverless Function</strong> generates a 2-sentence flashcard via{' '}
            <strong>Netlify AI Gateway</strong> and stores it in{' '}
            <strong>Deploy-Scoped Netlify Blobs</strong> for sub-50ms repeat reads.
          </p>
        </section>

        {/* Topic Picker & Input */}
        <section className="controls-panel" aria-label="Topic Selector">
          <div className="chips-row">
            <span className="chips-label">Quick Topics:</span>
            {QUICK_TOPICS.map((chip) => {
              const isSelected = activeTopic === chip.toLowerCase()
              return (
                <button
                  key={chip}
                  type="button"
                  className={`topic-chip ${isSelected ? 'active' : ''}`}
                  disabled={loading || clearing}
                  onClick={() => handleChipClick(chip)}
                >
                  {chip}
                </button>
              )
            })}
          </div>

          <form className="search-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="topic-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter any JS topic (e.g., Currying, WeakMap, Generators, Prototypes)..."
              aria-label="JavaScript topic"
              disabled={loading || clearing}
            />
            <button type="submit" className="explain-btn" disabled={loading || clearing}>
              {loading ? 'Generating...' : 'Explain'}
            </button>
          </form>
        </section>

        {error && <div className="error-banner">Error: {error}</div>}

        {/* Flashcard Output */}
        <section
          className={`result-card ${card ? (card.cached ? 'is-cached' : 'is-live') : ''}`}
          aria-live="polite"
        >
          {loading && !card ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Checking Netlify Blobs &amp; querying Netlify AI Gateway...</span>
            </div>
          ) : card ? (
            <>
              <div className="card-header">
                <div className="card-title-group">
                  <span className="card-topic-label">JavaScript Flashcard</span>
                  <h2 className="card-topic-title">{card.topic}</h2>
                </div>

                <div className="badges-cluster">
                  {(() => {
                    const badge = getBadgeDetails(card)
                    return <span className={badge.className}>{badge.label}</span>
                  })()}

                  {fetchLatency !== null && (
                    <span
                      className={`latency-badge ${card.cached ? 'fast' : 'slow'}`}
                      title="Measured client-side fetch round-trip latency"
                    >
                      ⏱ {fetchLatency} ms
                    </span>
                  )}
                </div>
              </div>

              <p className="explanation-text">{card.explanation}</p>

              <div className="code-window">
                <div className="code-window-bar">
                  <div className="window-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span className="code-lang-tag">example.js</span>
                </div>
                <pre className="code-pre">
                  <code>{highlightJs(card.codeExample)}</code>
                </pre>
              </div>

              <div className="card-footer">
                <span className="cache-hint">
                  {card.cached
                    ? 'Served instantaneously from deploy-scoped Netlify Blobs.'
                    : card.isFallback
                      ? 'Fallback response not cached — link with `netlify init` to enable zero-key Gemini.'
                      : 'Freshly generated via Gemini and persisted to Netlify Blobs — click topic again to test cache speed!'}
                </span>

                <button
                  type="button"
                  className="clear-btn"
                  onClick={() => void handleClearAndRegenerate()}
                  disabled={loading || clearing}
                >
                  {clearing ? 'Clearing & Re-generating...' : '🗑 Clear from Blobs & Re-generate'}
                </button>
              </div>
            </>
          ) : null}
        </section>
      </main>

      {/* Bottom Architecture Explainer Strip */}
      <footer className="arch-strip">
        <div className="arch-inner">
          <div className="arch-header">
            <h2 className="arch-title">How the 4 Netlify Primitives Work Together</h2>
          </div>

          <div className="arch-grid">
            <div className="arch-card">
              <span className="arch-step">01 · EDGE COMPUTE</span>
              <h3>Netlify Edge Functions</h3>
              <span className="arch-route">GET /api/geo</span>
              <p>
                Runs on Deno at the nearest CDN node to read{' '}
                <code>context.geo</code> and return visitor city &amp; country with ultra-low
                latency.
              </p>
            </div>

            <div className="arch-card">
              <span className="arch-step">02 · SERVERLESS V2</span>
              <h3>Serverless Functions</h3>
              <span className="arch-route">GET / DELETE /api/explain</span>
              <p>
                Uses modern Web-standard <code>Request</code> &amp; <code>Response.json</code>{' '}
                with in-code <code>config.path</code> routing to orchestrate caching &amp; AI.
              </p>
            </div>

            <div className="arch-card">
              <span className="arch-step">03 · KEY-VALUE STORAGE</span>
              <h3>Deploy-Scoped Blobs</h3>
              <span className="arch-route">getDeployStore(&quot;explanations&quot;)</span>
              <p>
                Caches AI flashcards per deploy so repeat lookups drop from ~1500ms to ~20ms and
                cleanly roll back with deploys.
              </p>
            </div>

            <div className="arch-card">
              <span className="arch-step">04 · ZERO-KEY LLM</span>
              <h3>Netlify AI Gateway</h3>
              <span className="arch-route">new GoogleGenAI(&#123;&#125;)</span>
              <p>
                Auto-injects Gemini credentials and base URLs at runtime—no manual API keys in code
                or env files required.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}

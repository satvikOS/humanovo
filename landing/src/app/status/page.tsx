"use client";

/*
  /status - public-facing platform status page.

  Reads /api/v1/health/full (shipped in Round 9 commit Y) and
  renders DB + vector_store status, Stripe configuration, and the
  62-source liveness summary in the same Renaissance editorial
  register as /manifesto and /provenance.

  Lightweight: the backend endpoint reads an in-memory liveness
  cache, doesn't fan out 62 outbound probes per page load. The
  page itself fetches client-side so it can show the network
  failure cleanly when the API is unreachable (vs a 500 from
  Vercel's edge).

  The configured API URL falls back to api.humanovo.net; in dev
  override via NEXT_PUBLIC_HUMANOVO_API.
*/

import { useEffect, useState } from "react";
import Link from "next/link";
import Colophon from "@/components/Colophon";

type Status = "healthy" | "degraded" | "unhealthy" | "unknown";

interface SourcesSummary {
  total_active: number;
  healthy?: number;
  degraded?: number;
  unknown?: number;
  error?: string;
}

interface HealthFullResponse {
  status: Status;
  timestamp: string;
  version: string;
  components: Record<string, string>;
  latencies_ms: Record<string, number>;
  billing: { stripe_configured: boolean };
  sources: SourcesSummary;
}

const API_BASE =
  process.env.NEXT_PUBLIC_HUMANOVO_API || "https://api.humanovo.net";

const STATUS_TONE: Record<Status, { label: string; color: string }> = {
  healthy: { label: "All systems operational", color: "var(--rust)" },
  degraded: { label: "Degraded performance", color: "#b8762d" },
  unhealthy: { label: "Major outage", color: "#a23b3b" },
  unknown: { label: "Status unknown", color: "var(--ink-3)" },
};

export default function StatusPage() {
  const [data, setData] = useState<HealthFullResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/v1/health/full`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as HealthFullResponse;
        if (cancelled) return;
        setData(json);
        setFetchedAt(new Date());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchHealth();
    // Auto-refresh every 30s. Set up the interval AFTER the initial
    // fetch so the first response renders immediately rather than
    // waiting 30s.
    const handle = window.setInterval(fetchHealth, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const overall: Status = data?.status ?? "unknown";
  const tone = STATUS_TONE[overall];

  return (
    <main
      style={{
        minHeight: "100vh",
        position: "relative",
        zIndex: 1,
        paddingTop: 90,
      }}
    >
      <div
        style={{
          maxWidth: 760,
          marginInline: "auto",
          paddingInline: 24,
          marginBottom: 60,
        }}
      >
        <Link
          href="/"
          className="status-back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            textDecoration: "none",
            paddingBottom: 2,
            borderBottom: "1px solid transparent",
            transition: "color 0.2s ease, border-color 0.2s ease",
          }}
        >
          <span aria-hidden>&larr;</span>
          humanovo
        </Link>
      </div>

      <article
        style={{
          maxWidth: 760,
          marginInline: "auto",
          paddingInline: 24,
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--ink-1)",
        }}
      >
        <header style={{ textAlign: "center", marginBottom: 56 }}>
          <span
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.58rem",
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "var(--ink-4)",
            }}
          >
            Vol. I &middot; No. 01 &middot; Status
          </span>
          <h1
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontWeight: 400,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 144, "SOFT" 100, "WONK" 1',
              fontSize: "clamp(2.4rem, 4.8vw, 3.4rem)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--ink-0)",
              margin: "22px 0 0",
            }}
          >
            {tone.label}
          </h1>
          <p
            style={{
              marginTop: 22,
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 72, "SOFT" 80',
              fontSize: "0.96rem",
              color: "var(--ink-3)",
            }}
          >
            {loading && !data
              ? "Querying live health endpoint…"
              : error
              ? `Reachability check failed: ${error}`
              : fetchedAt
              ? `Last refreshed ${fetchedAt.toLocaleTimeString()}.`
              : ""}
          </p>
        </header>

        <div
          aria-hidden
          style={{
            margin: "0 auto 50px",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        {/* Headline status banner */}
        <section
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 48,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: "0.7rem",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: tone.color,
              border: `1px solid ${tone.color}`,
              padding: "8px 16px",
              borderRadius: 999,
            }}
          >
            {overall}
          </span>
        </section>

        {data && (
          <>
            <section style={{ marginBottom: 48 }}>
              <h2 style={subhead}>Components</h2>
              <dl style={defList}>
                {Object.entries(data.components).map(([name, status]) => (
                  <div key={name} style={{ display: "contents" }}>
                    <dt style={dt}>{name}</dt>
                    <dd style={dd}>
                      <span style={{ color: pickComponentColor(status) }}>
                        {status}
                      </span>
                      {data.latencies_ms?.[name] !== undefined && (
                        <span
                          style={{
                            color: "var(--ink-3)",
                            marginLeft: 12,
                            fontSize: "0.85em",
                          }}
                        >
                          {data.latencies_ms[name].toFixed(1)}ms
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section style={{ marginBottom: 48 }}>
              <h2 style={subhead}>Biomedical sources</h2>
              <p style={{ ...prose, marginBottom: 16 }}>
                {data.sources.total_active} active sources in the orchestrator.
                {data.sources.healthy !== undefined && (
                  <>
                    {" "}
                    Within the last hour: {data.sources.healthy} healthy,
                    {" "}{data.sources.degraded ?? 0} degraded,
                    {" "}{data.sources.unknown ?? 0} unqueried.
                  </>
                )}
                {data.sources.error && (
                  <em style={{ color: "var(--ink-3)" }}>
                    {" "}({data.sources.error})
                  </em>
                )}
              </p>
            </section>

            <section style={{ marginBottom: 48 }}>
              <h2 style={subhead}>Build</h2>
              <dl style={defList}>
                <div style={{ display: "contents" }}>
                  <dt style={dt}>Version</dt>
                  <dd style={dd}>
                    <code style={{ fontFamily: "var(--font-mono), monospace" }}>
                      {data.version}
                    </code>
                  </dd>
                </div>
                <div style={{ display: "contents" }}>
                  <dt style={dt}>Stripe</dt>
                  <dd style={dd}>
                    {data.billing.stripe_configured ? "configured" : "not configured"}
                  </dd>
                </div>
                <div style={{ display: "contents" }}>
                  <dt style={dt}>Snapshot</dt>
                  <dd style={dd}>
                    <code style={{ fontFamily: "var(--font-mono), monospace" }}>
                      {data.timestamp}
                    </code>
                  </dd>
                </div>
              </dl>
            </section>
          </>
        )}

        {!data && !loading && error && (
          <section style={{ marginBottom: 48 }}>
            <p style={{ ...prose, color: "var(--ink-2)" }}>
              The live health endpoint is currently unreachable. This page
              auto-retries every 30 seconds. If it stays unreachable, our
              edge layer is up but the API behind it isn&rsquo;t answering.
            </p>
          </section>
        )}

        <div
          aria-hidden
          style={{
            margin: "70px auto 0",
            width: 64,
            height: 1,
            background: "var(--paper-edge)",
          }}
        />

        <div style={{ textAlign: "center", marginTop: 44 }}>
          <Link
            href="/provenance"
            style={{
              display: "inline-block",
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontVariationSettings: '"opsz" 96, "SOFT" 80, "WONK" 1',
              fontSize: "1.1rem",
              color: "var(--ink-1)",
              textDecoration: "none",
              borderBottom: "1px solid var(--rust)",
              paddingBottom: 2,
            }}
          >
            How citations are verified &rarr;
          </Link>
        </div>
      </article>

      <Colophon />

      <style>{`
        .status-back:hover,
        .status-back:focus-visible {
          color: var(--ink-0);
          border-bottom-color: var(--rust);
        }
      `}</style>
    </main>
  );
}

const subhead: React.CSSProperties = {
  fontFamily: "var(--font-display), Georgia, serif",
  fontWeight: 400,
  fontVariationSettings: '"opsz" 144, "SOFT" 60, "WONK" 0',
  fontSize: "clamp(1.4rem, 2.2vw, 1.7rem)",
  lineHeight: 1.15,
  letterSpacing: "-0.015em",
  color: "var(--ink-0)",
  margin: "0 0 18px",
};

const defList: React.CSSProperties = {
  margin: 0,
  display: "grid",
  gridTemplateColumns: "minmax(180px, 30%) 1fr",
  rowGap: 14,
  columnGap: 28,
};

const dt: React.CSSProperties = {
  fontFamily: "var(--font-display), Georgia, serif",
  fontStyle: "italic",
  fontVariationSettings: '"opsz" 72, "SOFT" 80, "WONK" 1',
  fontSize: "1rem",
  color: "var(--rust)",
  paddingTop: 1,
};

const dd: React.CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  lineHeight: 1.6,
  color: "var(--ink-1)",
  fontFamily: "var(--font-display), Georgia, serif",
};

const prose: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.7,
  color: "var(--ink-1)",
};

function pickComponentColor(status: string): string {
  if (status === "healthy") return "var(--rust)";
  if (status === "degraded") return "#b8762d";
  if (status === "unhealthy") return "#a23b3b";
  return "var(--ink-3)";
}

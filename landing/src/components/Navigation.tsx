"use client";

import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  useLayoutEffect,
} from "react";
import { gsap, useGSAP } from "@/lib/gsap";

/* ─── Overlay context ─── */
export const OverlayContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <OverlayContext.Provider value={{ open, setOpen }}>
      {children}
    </OverlayContext.Provider>
  );
}

export function useOverlay() {
  return useContext(OverlayContext);
}

/* ─── Navigation ─── */
// Five sections — the thesis statement + trust panels added in this design pass
// don't get their own labels in the nav (would clutter at four+
// items on mobile) but the IntersectionObserver still tracks them
// so the Platform pill stays "active" while reading through them.
const navItems = [
  { label: "Overview", id: "section-hero" },
  { label: "Platform", id: "section-pipeline" },
  { label: "Trust", id: "section-trust" },
  { label: "Download", id: "section-download" },
];

export default function Navigation() {
  const [active, setActive] = useState(0);
  const { setOpen } = useOverlay();
  const navRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLSpanElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useGSAP(
    () => {
      gsap.from(navRef.current, {
        y: -30,
        autoAlpha: 0,
        duration: 0.9,
        ease: "power3.out",
        delay: 0.25,
      });
    },
    { scope: navRef }
  );

  /* Wordmark breathing — scroll-driven interpolation across the
     Fraunces variable axes. As the visitor scrolls down the page,
     the nav wordmark drifts from the calm "SOFT 50, WONK 0" state
     of an opening folio into the more flourished "SOFT 100, WONK 1"
     of a marginal annotation. The transition is barely perceptible
     — that's the point. The reader who notices feels they're on a
     site that takes itself seriously; the reader who doesn't gets
     a wordmark that doesn't fight the page.

     Implementation: a single rAF-throttled scroll listener writes
     two CSS custom properties on document.documentElement. The
     wordmark span reads them in its font-variation-settings. No
     React state, no re-renders, no thrashing.

     prefers-reduced-motion: when set, the listener bails on first
     mount and the wordmark stays at the calm initial axes. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) {
      root.style.setProperty("--wm-soft", "60");
      root.style.setProperty("--wm-wonk", "0.5");
      return;
    }

    let raf = 0;
    const SCROLL_END = 1400; // px; somewhere into Pipeline section.
    const update = () => {
      const t = Math.max(0, Math.min(1, window.scrollY / SCROLL_END));
      // Eased so the breath happens mostly in the upper half of
      // scroll — the wordmark "settles" by mid-page.
      const eased = 1 - Math.pow(1 - t, 2);
      const soft = (50 + eased * 50).toFixed(1);
      const wonk = eased.toFixed(3);
      root.style.setProperty("--wm-soft", soft);
      root.style.setProperty("--wm-wonk", wonk);
      raf = 0;
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const moveSlider = (index: number) => {
    const btn = btnRefs.current[index];
    const container = itemsRef.current;
    const slider = sliderRef.current;
    if (!btn || !container || !slider) return;
    const { offsetLeft, offsetWidth, offsetTop, offsetHeight } = btn;
    gsap.to(slider, {
      x: offsetLeft,
      y: offsetTop,
      width: offsetWidth,
      height: offsetHeight,
      duration: 0.5,
      ease: "power3.out",
    });
  };

  useLayoutEffect(() => {
    moveSlider(active);
    const onResize = () => moveSlider(active);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  useEffect(() => {
    const targets = navItems
      .map((it) => document.getElementById(it.id))
      .filter((el): el is HTMLElement => !!el);
    if (!targets.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const idx = navItems.findIndex((it) => it.id === visible.target.id);
          if (idx >= 0) setActive(idx);
        }
      },
      { threshold: [0.35, 0.55, 0.75] }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav
      ref={navRef}
      className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none"
      style={{ paddingTop: 18 }}
    >
      <div
        className="nav-bar pointer-events-auto"
        style={{ width: "min(1160px, calc(100% - 28px))" }}
      >
        {/* Logo */}
        <button
          onClick={() => scrollTo("section-hero")}
          className="group flex items-center gap-2.5"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "4px 2px",
          }}
          aria-label="humanovo"
        >
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-0)",
            }}
          >
            {/* Inline the glyph as an <img> rather than an external
                <svg use>; the glyph file lives at /public/glyph.svg
                and inherits `currentColor` via the parent `color`
                token, so dark-mode inversion is a one-line change.
                Decorative — the wordmark beside it carries the
                accessible name. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/glyph.svg"
              alt=""
              width={26}
              height={26}
              draggable={false}
              style={{ display: "block", pointerEvents: "none" }}
            />
          </span>
          <span
            className="nav-wordmark"
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              fontStyle: "italic",
              fontWeight: 300,
              // Reads breathing axes from CSS custom props that
              // the scroll listener above keeps in sync. Defaults
              // are baked in so SSR + first paint look right.
              fontVariationSettings:
                '"opsz" 72, "SOFT" var(--wm-soft, 60), "WONK" var(--wm-wonk, 0.5)',
              fontSize: "1.35rem",
              color: "var(--ink-0)",
              letterSpacing: "-0.045em",
              lineHeight: 1,
              transition: "font-variation-settings 240ms ease-out",
            }}
          >
            humanovo
          </span>
        </button>

        {/* Nav items */}
        <div
          ref={itemsRef}
          className="relative hidden md:flex items-center"
          style={{ padding: "3px" }}
        >
          <span
            ref={sliderRef}
            aria-hidden
            className="nav-slider"
            style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
          />
          {navItems.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              onClick={() => {
                setActive(i);
                scrollTo(item.id);
              }}
              className={`nav-item ${active === i ? "nav-item-active" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={() => setOpen(true)}
          className="btn-ink"
          style={{ padding: "10px 20px", fontSize: "0.64rem" }}
        >
          Request access
        </button>
      </div>
    </nav>
  );
}

/* ─── Contact Overlay ─── */
export function ContactOverlay() {
  const { open, setOpen } = useOverlay();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    organization: "",
    inquiry: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useGSAP(
    () => {
      if (open) {
        gsap.to(backdropRef.current, {
          autoAlpha: 1,
          duration: 0.35,
          ease: "power2.out",
        });
        gsap.fromTo(
          panelRef.current,
          { y: 40, scale: 0.96, filter: "blur(8px)" },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.55,
            ease: "power3.out",
          }
        );
        gsap.from(
          ".overlay-panel .field, .overlay-panel .field-label, .overlay-panel button, .overlay-panel h2, .overlay-panel p, .overlay-panel .pill",
          {
            y: 14,
            autoAlpha: 0,
            duration: 0.5,
            ease: "power2.out",
            stagger: 0.04,
            delay: 0.1,
          }
        );
      } else {
        gsap.to(panelRef.current, {
          autoAlpha: 0,
          y: 20,
          scale: 0.98,
          filter: "blur(6px)",
          duration: 0.3,
          ease: "power2.in",
        });
        gsap.to(backdropRef.current, {
          autoAlpha: 0,
          duration: 0.3,
          ease: "power2.in",
        });
      }
    },
    { dependencies: [open] }
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setTimeout(() => {
          setSubmitted(false);
          setFormData({ name: "", email: "", organization: "", inquiry: "" });
          setOpen(false);
        }, 1800);
      } else {
        setSubmitted(false);
        alert("Failed to send inquiry. Please try again.");
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      setSubmitted(false);
      alert("Failed to send inquiry. Please try again.");
    }
  };

  return (
    <div
      ref={backdropRef}
      className="overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        visibility: "hidden",
        opacity: 0,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div
        ref={panelRef}
        className="overlay-panel"
        style={{ visibility: "hidden", opacity: 0 }}
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 32,
            height: 32,
            borderRadius: 999,
            background: "transparent",
            border: "1px solid var(--paper-edge)",
            color: "var(--ink-2)",
            fontSize: "1rem",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ marginBottom: 28 }}>
          <span className="pill">
            <span className="dot" />
            Early access
          </span>
          <h2
            className="t-h2"
            style={{ fontSize: "2.1rem", marginTop: 16 }}
          >
            Get in touch.
          </h2>
          <p className="t-lead" style={{ marginTop: 10, fontSize: "0.98rem" }}>
            Tell us what you&rsquo;re researching. We read every reply.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <Field
            label="Full name"
            placeholder="Jane Researcher"
            value={formData.name}
            onChange={(v) => setFormData({ ...formData, name: v })}
          />
          <Field
            label="Email"
            type="email"
            placeholder="you@lab.org"
            value={formData.email}
            onChange={(v) => setFormData({ ...formData, email: v })}
          />
          <Field
            label="Organization"
            placeholder="Institute or company"
            value={formData.organization}
            onChange={(v) => setFormData({ ...formData, organization: v })}
          />
          <div style={{ marginBottom: 24 }}>
            <label className="field-label">Message</label>
            <textarea
              value={formData.inquiry}
              onChange={(e) =>
                setFormData({ ...formData, inquiry: e.target.value })
              }
              required
              rows={3}
              placeholder="What are you researching?"
              className="field"
            />
          </div>

          <button
            type="submit"
            disabled={submitted}
            className="btn-ink"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "14px 22px",
              cursor: submitted ? "default" : "pointer",
              opacity: submitted ? 0.7 : 1,
            }}
          >
            {submitted ? "Sending…" : "Request access"}
          </button>

          {submitted && (
            <p
              style={{
                textAlign: "center",
                marginTop: 18,
                fontSize: "0.82rem",
                color: "var(--ink-2)",
                fontStyle: "italic",
                fontFamily: "var(--font-display), Georgia, serif",
              }}
            >
              Thank you — your inquiry has been sent.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label className="field-label">{label}</label>
      <input
        type={type}
        required
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </div>
  );
}

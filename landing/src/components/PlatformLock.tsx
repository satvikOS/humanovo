"use client";

import { useEffect } from "react";

/*
  PlatformLock — disables copy / cut / paste / drag / context-menu
  across the marketing surface. Form fields (input, textarea,
  [contenteditable]) are exempt so users can still fill the contact
  form normally.
*/
export default function PlatformLock() {
  useEffect(() => {
    const isFormField = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const block = (e: Event) => {
      if (isFormField(e.target)) return;
      e.preventDefault();
    };

    /* Block clipboard operations everywhere except form fields */
    const blockClipboard = (e: ClipboardEvent) => {
      if (isFormField(e.target)) return;
      e.preventDefault();
    };

    /* Block Ctrl/Cmd + C / X / V / S / P / A outside form fields
       (A = select-all — we already disabled user-select, this is belt +
       braces; S/P = save/print of the page). */
    const blockKeys = (e: KeyboardEvent) => {
      if (isFormField(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "c" || k === "x" || k === "v" || k === "a" || k === "s" || k === "p") {
        e.preventDefault();
      }
    };

    document.addEventListener("copy", blockClipboard);
    document.addEventListener("cut", blockClipboard);
    document.addEventListener("paste", blockClipboard);
    document.addEventListener("dragstart", block);
    document.addEventListener("contextmenu", block);
    document.addEventListener("keydown", blockKeys);

    return () => {
      document.removeEventListener("copy", blockClipboard);
      document.removeEventListener("cut", blockClipboard);
      document.removeEventListener("paste", blockClipboard);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("keydown", blockKeys);
    };
  }, []);

  return null;
}

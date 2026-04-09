import { MD_SANITIZE } from "./constants.js";

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function markdownToSafeHtml(md) {
  const raw = marked.parse(String(md ?? ""));
  return typeof DOMPurify !== "undefined" && DOMPurify.sanitize
    ? DOMPurify.sanitize(raw, MD_SANITIZE)
    : raw;
}

export function applyBlankTargets(root) {
  if (!root) return;
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

/** Resolve relative image/media paths in raw README markdown to absolute raw URLs. */
export function resolveReadmeImages(
  markdown,
  fullName,
  defaultBranch = "main",
) {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;
  return markdown
    .replace(
      /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
      (_, alt, src) => `![${alt}](${base}/${src.replace(/^\.\//, "")})`,
    )
    .replace(
      /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    )
    .replace(
      /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    );
}

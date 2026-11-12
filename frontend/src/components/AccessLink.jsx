import { safeHref } from '../format.js';

// A link only when the URL is http(s); otherwise a disabled pill.
export default function AccessLink({ label, net, url, missing }) {
  const href = safeHref(url);
  if (!href) {
    return (
      <span className={`pill pill--${net} pill--off`} title={missing} aria-disabled="true">
        {label}
      </span>
    );
  }
  return (
    <a className={`pill pill--${net}`} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

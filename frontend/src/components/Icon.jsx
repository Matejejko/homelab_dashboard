// Glyphs from the Nerd Font's icon range. Always decorative: every control that
// uses one also carries a text label or an aria-label.
const GLYPHS = {
  server: '',
  cog: '',
  logout: '',
  sun: '',
  moon: '',
  pencil: '',
  plus: '',
  close: '',
  lock: '',
  key: '',
  fit: '',
  warning: '',
  check: '',
  trash: '',
  grid: '',
  list: '',
  cpu: '\uf4bc',
  memory: '\u{f035b}',
  network: '\uf0ec',
  disk: '\uf0a0',
  temperature: '\uf2c9',
  clock: '\uf017',
};

export default function Icon({ name }) {
  return (
    <span className="icon" aria-hidden="true">
      {GLYPHS[name]}
    </span>
  );
}

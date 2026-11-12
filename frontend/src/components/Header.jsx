import Clock from './Clock.jsx';
import Icon from './Icon.jsx';

export default function Header({ theme, onToggleTheme, onOpenSettings, onLogout }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="header">
      <div className="brand">
        <span className="brand__mark"><Icon name="server" /></span>
        <div>
          <h1 className="brand__title">homelab<span className="brand__dim">/dashboard</span></h1>
          <p className="brand__sub">system · network · services</p>
        </div>
      </div>
      <div className="header__tools">
        <Clock />
        <button
          type="button"
          className="btn btn--icon"
          onClick={onToggleTheme}
          aria-label={`Switch to ${nextTheme} theme`}
          title={`Switch to ${nextTheme} theme`}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="btn" onClick={onOpenSettings}>
          <Icon name="cog" /> Settings
        </button>
        <button type="button" className="btn" onClick={onLogout}>
          <Icon name="logout" /> Sign out
        </button>
      </div>
    </header>
  );
}

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Notification } from '../api';
import { useApp } from '../state';

const CATEGORIES: Array<[string, string]> = [
  ['', 'All'], ['mobiles', 'Mobiles'], ['laptops', 'Laptops'], ['audio', 'Audio'], ['wearables', 'Wearables'],
  ['tv', 'Televisions'], ['home', 'Home & Festive'], ['fashion', 'Fashion'], ['appliances', 'Appliances'],
];

export function Header() {
  const { user, cart, logout } = useApp();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (category) sp.set('category', category);
    navigate(`/search?${sp}`);
  };

  return (
    <header className="header">
      <div className="header__bar container">
        <Link to="/" className="logo" data-testid="logo">
          <span className="logo__mark">QA</span>Mart<span className="logo__tld">.in</span>
        </Link>
        <form className="search" onSubmit={submit} role="search">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="search-category">
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input
            type="search" placeholder="Search for iPhone, headphones, diyas…" value={q} onChange={(e) => setQ(e.target.value)}
            aria-label="Search products" data-testid="search-input" maxLength={120}
          />
          <button type="submit" aria-label="Search" data-testid="search-button">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M10 4a6 6 0 1 0 3.5 10.9l4.3 4.3 1.4-1.4-4.3-4.3A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" fill="currentColor" /></svg>
          </button>
        </form>
        <nav className="header__nav">
          {user ? (
            <div className="account">
              <span className="header__small">Hello, {user.name.split(' ')[0]}</span>
              <button className="linklike header__strong" onClick={logout} data-testid="logout">Sign out</button>
            </div>
          ) : (
            <Link to="/login" className="account" data-testid="nav-login">
              <span className="header__small">Hello, sign in</span>
              <span className="header__strong">Account</span>
            </Link>
          )}
          <Link to="/orders" className="account" data-testid="nav-orders">
            <span className="header__small">Returns</span>
            <span className="header__strong">&amp; Orders</span>
          </Link>
          {user && <NotificationBell />}
          <Link to="/cart" className="cart-link" data-testid="nav-cart">
            <span className="cart-link__count" data-testid="cart-count">{cart?.itemCount ?? 0}</span>
            <svg viewBox="0 0 32 32" width="34" height="34"><path d="M3 5h4l3.6 14.4A2 2 0 0 0 12.5 21H25l3-11H9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /><circle cx="13" cy="26" r="2" fill="currentColor" /><circle cx="24" cy="26" r="2" fill="currentColor" /></svg>
            <span className="header__strong">Cart</span>
          </Link>
        </nav>
      </div>
      <div className="subnav">
        <div className="container subnav__inner">
          {CATEGORIES.slice(1).map(([v, l]) => <Link key={v} to={`/search?category=${v}`}>{l}</Link>)}
          <Link to="/search?deals=true" className="subnav__deals">Today's Deals</Link>
        </div>
      </div>
    </header>
  );
}

function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () => api<{ items: Notification[] }>('GET', '/api/notifications').then((r) => alive && setItems(r.items)).catch(() => undefined);
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [location.pathname]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const unread = Math.max(0, items.length - seen);
  return (
    <div className="bell" ref={ref}>
      <button className="bell__btn" aria-label="Notifications" data-testid="notifications-bell" onClick={() => { setOpen(!open); setSeen(items.length); }}>
        <svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5l-2 2v1h18v-1z" fill="currentColor" /></svg>
        {unread > 0 && <span className="bell__count" data-testid="notifications-unread">{unread}</span>}
      </button>
      {open && (
        <div className="bell__panel" data-testid="notifications-panel">
          <div className="bell__title">Notifications</div>
          {items.length === 0 && <div className="muted bell__empty">No notifications yet.</div>}
          {items.slice(0, 8).map((n) => (
            <Link key={n.id} to={`/orders/${n.orderId}`} className="bell__item" onClick={() => setOpen(false)}>
              <strong>{n.subject}</strong>
              <span className="muted">{new Date(n.createdAt).toLocaleString('en-IN')} · {n.channel}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div>
          <div className="logo logo--footer"><span className="logo__mark">QA</span>Mart</div>
          <p className="muted">A teaching application for the course <em>Modern QA Engineering: System Design, DevOps &amp; AI</em>. All products, payments and e-mails are simulated.</p>
        </div>
        <div>
          <strong>For learners</strong>
          <a href="/api-docs/" target="_blank" rel="noreferrer">API documentation</a>
          <a href={`${location.protocol}//${location.hostname}:8081/`} target="_blank" rel="noreferrer">System Design Dashboard</a>
        </div>
        <div>
          <strong>Demo accounts</strong>
          <span className="muted">alice@qamart.test · bob@qamart.test</span>
          <span className="muted">Password: Password@123</span>
        </div>
      </div>
    </footer>
  );
}

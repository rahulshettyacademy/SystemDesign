import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ProductSummary } from '../api';
import { useStock } from '../hooks';
import { ErrorBox, ProductCard, Spinner } from '../components/ui';
import { ProductImage } from '../components/ProductImage';

interface Category { id: string; name: string; count: number }
const CATEGORY_ICONS: Record<string, [string, string]> = {
  mobiles: ['phone', '#1f2937'], laptops: ['laptop', '#475569'], audio: ['headphones', '#1e293b'], wearables: ['watch', '#f43f5e'],
  tv: ['tv', '#0f172a'], home: ['diya', '#ea580c'], fashion: ['saree', '#be123c'], appliances: ['cooker', '#475569'],
};

export function Home() {
  const [sale, setSale] = useState<{ active: boolean; label: string; dealCount: number } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [top, setTop] = useState<ProductSummary[] | null>(null);
  const [deals, setDeals] = useState<ProductSummary[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api('GET', '/api/products/sale').then(setSale).catch(() => undefined);
    api<{ categories: Category[] }>('GET', '/api/products/categories').then((r) => setCategories(r.categories)).catch(() => undefined);
    api<{ items: ProductSummary[] }>('GET', '/api/products?sort=rating&limit=8').then((r) => setTop(r.items)).catch(setError);
    api<{ items: ProductSummary[] }>('GET', '/api/products?deals=true&limit=8').then((r) => setDeals(r.items)).catch(() => undefined);
  }, []);
  const ids = [...(top ?? []), ...deals].map((p) => p.id);
  const { stock, failed } = useStock([...new Set(ids)]);

  return (
    <div className="home">
      <section className={`hero ${sale?.active ? 'hero--sale' : ''}`} data-testid="hero">
        <div className="container hero__inner">
          {sale?.active ? (
            <div>
              <div className="hero__eyebrow">🪔 Festival of Lights</div>
              <h1 data-testid="sale-banner">{sale.label}</h1>
              <p>{sale.dealCount} lightning deals live now · Use code <strong>DIWALI50</strong> for 50% off (up to ₹2,000)</p>
              <Link to="/search?deals=true" className="btn btn--primary btn--lg">Shop the deals</Link>
            </div>
          ) : (
            <div>
              <div className="hero__eyebrow">Welcome to QAMart</div>
              <h1>Everything you need, delivered.</h1>
              <p>Phones, laptops, festive décor and more. Use code <strong>WELCOME10</strong> for 10% off your first order.</p>
              <Link to="/search?q=iphone" className="btn btn--primary btn--lg">Shop iPhones</Link>
            </div>
          )}
          <div className="hero__art" aria-hidden="true">
            <ProductImage icon={sale?.active ? 'diya' : 'phone'} color={sale?.active ? '#ea580c' : '#1f2937'} size="lg" />
          </div>
        </div>
      </section>

      <div className="container">
        <section className="categories" data-testid="categories">
          {categories.map((c) => (
            <Link key={c.id} to={`/search?category=${c.id}`} className="card category-tile">
              <ProductImage icon={CATEGORY_ICONS[c.id]?.[0] ?? 'phone'} color={CATEGORY_ICONS[c.id]?.[1] ?? '#333'} size="sm" />
              <div>
                <strong>{c.name}</strong>
                <span className="muted">{c.count} products</span>
              </div>
            </Link>
          ))}
        </section>

        {deals.length > 0 && (
          <section className="shelf">
            <div className="shelf__head"><h2>Diwali lightning deals</h2><Link to="/search?deals=true">See all deals</Link></div>
            <div className="grid">{deals.map((p) => <ProductCard key={p.id} p={p} stock={stock[p.id]} stockFailed={failed} />)}</div>
          </section>
        )}

        <section className="shelf">
          <div className="shelf__head"><h2>Top rated</h2><Link to="/search?sort=rating">See more</Link></div>
          {error ? <ErrorBox error={error} title="Could not load products" /> : !top ? <Spinner /> : (
            <div className="grid" data-testid="top-rated">{top.map((p) => <ProductCard key={p.id} p={p} stock={stock[p.id]} stockFailed={failed} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}

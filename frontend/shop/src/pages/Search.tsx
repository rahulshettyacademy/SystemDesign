import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, ProductSummary } from '../api';
import { useStock } from '../hooks';
import { ErrorBox, ProductCard, Spinner } from '../components/ui';

interface Result { items: ProductSummary[]; total: number; page: number; totalPages: number }
const CATS: Array<[string, string]> = [['mobiles', 'Mobiles'], ['laptops', 'Laptops'], ['audio', 'Audio'], ['wearables', 'Wearables'], ['tv', 'Televisions'], ['home', 'Home & Festive'], ['fashion', 'Fashion'], ['appliances', 'Appliances']];

export function Search() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const qs = params.toString();

  useEffect(() => {
    setResult(null);
    setError(null);
    const sp = new URLSearchParams(qs);
    if (!sp.get('limit')) sp.set('limit', '12');
    api<Result>('GET', `/api/products?${sp}`).then(setResult).catch(setError);
  }, [qs]);

  const { stock, failed } = useStock(result?.items.map((p) => p.id) ?? []);
  const set = (k: string, v: string | null) => {
    const sp = new URLSearchParams(params);
    if (v) sp.set(k, v);
    else sp.delete(k);
    if (k !== 'page') sp.delete('page');
    setParams(sp);
  };
  const q = params.get('q');

  return (
    <div className="container search-page">
      <aside className="filters card">
        <h3>Category</h3>
        <button className={`filter ${!params.get('category') ? 'is-active' : ''}`} onClick={() => set('category', null)}>All categories</button>
        {CATS.map(([id, name]) => (
          <button key={id} className={`filter ${params.get('category') === id ? 'is-active' : ''}`} onClick={() => set('category', id)} data-testid={`filter-${id}`}>{name}</button>
        ))}
        <h3>Offers</h3>
        <label className="check">
          <input type="checkbox" checked={params.get('deals') === 'true'} onChange={(e) => set('deals', e.target.checked ? 'true' : null)} data-testid="filter-deals" /> Deals only
        </label>
      </aside>
      <section>
        <div className="search-page__bar">
          <div data-testid="results-summary">
            {result ? <><strong>{result.total}</strong> result{result.total === 1 ? '' : 's'}{q && <> for <strong>"{q}"</strong></>}</> : 'Searching…'}
          </div>
          <label>
            Sort by{' '}
            <select value={params.get('sort') ?? 'relevance'} onChange={(e) => set('sort', e.target.value)} data-testid="sort-select">
              <option value="relevance">Featured</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="rating">Avg. customer review</option>
            </select>
          </label>
        </div>
        {error ? (
          <ErrorBox error={error} title={(error as ApiError).status === 400 ? 'Invalid search' : 'Search is unavailable'} />
        ) : !result ? (
          <Spinner label="Searching products…" />
        ) : result.items.length === 0 ? (
          <div className="empty card" data-testid="no-results">
            <h3>No results{q ? ` for "${q}"` : ''}</h3>
            <p className="muted">Try a different spelling or browse a category.</p>
            <Link to="/" className="btn">Back to home</Link>
          </div>
        ) : (
          <>
            <div className="grid" data-testid="search-results">{result.items.map((p) => <ProductCard key={p.id} p={p} stock={stock[p.id]} stockFailed={failed} />)}</div>
            {result.totalPages > 1 && (
              <div className="pager">
                {Array.from({ length: result.totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} className={`btn ${n === result.page ? 'btn--primary' : ''}`} onClick={() => set('page', String(n))}>{n}</button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

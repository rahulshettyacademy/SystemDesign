import { Link } from 'react-router-dom';
import { ApiError, formatINR, ProductSummary, StockInfo } from '../api';
import { ProductImage } from './ProductImage';

export function Stars({ rating, reviews }: { rating: number; reviews?: number }) {
  const full = Math.round(rating * 2) / 2;
  return (
    <span className="stars" title={`${rating} out of 5`}>
      <span className="stars__icons" style={{ ['--pct' as string]: `${(full / 5) * 100}%` }}>★★★★★</span>
      <span className="stars__value">{rating.toFixed(1)}</span>
      {reviews !== undefined && <span className="muted">({reviews.toLocaleString('en-IN')})</span>}
    </span>
  );
}

export function Price({ price, mrp, size = 'md' }: { price: number; mrp: number; size?: 'md' | 'lg' }) {
  const off = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0;
  return (
    <div className={`price price--${size}`}>
      {off > 0 && <span className="price__off">-{off}%</span>}
      <span className="price__now" data-testid="price">{formatINR(price)}</span>
      {off > 0 && <span className="price__mrp">M.R.P. <s>{formatINR(mrp)}</s></span>}
    </div>
  );
}

export function StockBadge({ stock, failed }: { stock?: StockInfo; failed?: boolean }) {
  if (failed) return <span className="badge badge--unknown" data-testid="stock-status">Availability unknown</span>;
  if (!stock) return <span className="badge badge--loading">Checking stock…</span>;
  if (stock.status === 'OUT_OF_STOCK') return <span className="badge badge--out" data-testid="stock-status">Out of stock</span>;
  if (stock.status === 'LOW_STOCK') return <span className="badge badge--low" data-testid="stock-status">Only {stock.available} left</span>;
  return <span className="badge badge--in" data-testid="stock-status">In stock</span>;
}

export function ProductCard({ p, stock, stockFailed }: { p: ProductSummary; stock?: StockInfo; stockFailed?: boolean }) {
  return (
    <Link to={`/product/${p.id}`} className="card product-card" data-testid="product-card" data-product-id={p.id}>
      {p.sale && <span className="ribbon">{p.sale.label}</span>}
      <ProductImage icon={p.image.icon} color={p.image.color} />
      <div className="product-card__body">
        <div className="product-card__brand">{p.brand}</div>
        <div className="product-card__name" data-testid="product-name">{p.name}</div>
        <Stars rating={p.rating} reviews={p.reviews} />
        <Price price={p.price} mrp={p.mrp} />
        <StockBadge stock={stock} failed={stockFailed} />
      </div>
    </Link>
  );
}

export function ErrorBox({ error, title }: { error: unknown; title?: string }) {
  const e = error as ApiError;
  return (
    <div className="alert alert--error" role="alert" data-testid="error-message">
      <strong>{title ?? 'Something went wrong'}</strong>
      <div>{e?.message ?? String(error)}</div>
      {(e?.code || e?.requestId) && (
        <div className="alert__meta">
          {e.code && <code>{e.code}</code>} {e.requestId && <span>Request ID: <code>{e.requestId}</code></span>}
        </div>
      )}
    </div>
  );
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="spinner" role="status">
    <span className="spinner__dot" />
    {label}
  </div>
);

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = {
    PENDING: 'Processing',
    PAYMENT_PENDING: 'Payment pending',
    CONFIRMED: 'Confirmed',
    PAYMENT_FAILED: 'Payment failed',
    REJECTED: 'Not placed',
  };
  return <span className={`pill pill--${status.toLowerCase()}`} data-testid="order-status">{labels[status] ?? status}</span>;
}

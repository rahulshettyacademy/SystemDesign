import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, Cart, onApiCall, ProductDetail, StockInfo } from '../api';
import { ErrorBox, Price, Spinner, Stars, StockBadge } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { useApp } from '../state';

export function ProductPage() {
  const { id } = useParams();
  const { user, setCart } = useApp();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [cacheInfo, setCacheInfo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stock, setStock] = useState<StockInfo | undefined>();
  const [stockFailed, setStockFailed] = useState(false);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<unknown>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setProduct(null);
    setError(null);
    setAdded(false);
    setCacheInfo(null);
    // The X-Cache / X-Served-By diagnostic headers (lab mode only) power the teaching badge.
    const unsubscribe = onApiCall((c) => {
      if (c.method === 'GET' && c.path === `/api/products/${id}`) setCacheInfo(c.cache ? `${c.cache} · served by ${c.servedBy}` : null);
    });
    api<ProductDetail>('GET', `/api/products/${id}`).then(setProduct).catch(setError);
    api<StockInfo>('GET', `/api/inventory/${id}`).then((s) => { setStock(s); setStockFailed(false); }).catch(() => setStockFailed(true));
    return () => void unsubscribe();
  }, [id]);

  const add = async (buyNow = false) => {
    if (!user) {
      navigate(`/login?next=/product/${id}`);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const cart = await api<Cart>('POST', '/api/cart/items', { productId: id, quantity: qty });
      setCart(cart);
      setAdded(true);
      if (buyNow) navigate('/cart');
    } catch (e) {
      setAddError(e);
    } finally {
      setAdding(false);
    }
  };

  if (error) {
    const notFound = (error as ApiError).status === 404 || (error as ApiError).status === 400;
    return (
      <div className="container page">
        <ErrorBox error={error} title={notFound ? 'Product not found' : 'Could not load this product'} />
        <Link to="/" className="btn">Continue shopping</Link>
      </div>
    );
  }
  if (!product) return <div className="container page"><Spinner label="Loading product…" /></div>;
  const outOfStock = stock?.status === 'OUT_OF_STOCK';

  return (
    <div className="container page product-page" data-testid="product-page">
      <nav className="crumbs"><Link to="/">Home</Link> › <Link to={`/search?category=${product.category}`}>{product.category}</Link> › <span>{product.brand}</span></nav>
      <div className="product-page__grid">
        <div className="card product-page__media">
          {product.sale && <span className="ribbon ribbon--lg">{product.sale.label}</span>}
          <ProductImage icon={product.image.icon} color={product.image.color} size="lg" />
        </div>
        <div className="product-page__info">
          <div className="muted">Brand: <strong>{product.brand}</strong> · SKU {product.sku}</div>
          <h1 data-testid="product-title">{product.name}</h1>
          <Stars rating={product.rating} reviews={product.reviews} />
          <hr />
          <Price price={product.price} mrp={product.mrp} size="lg" />
          {product.sale && <div className="sale-note">Deal price. Regular price ₹{product.sale.regularPrice.toLocaleString('en-IN')}.</div>}
          <p className="muted">Inclusive of all taxes · Free delivery</p>
          <p>{product.description}</p>
          {product.specs && (
            <table className="specs" data-testid="specs">
              <tbody>{Object.entries(product.specs).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody>
            </table>
          )}
          {product.variants && (
            <div className="variants">
              {Object.entries(product.variants).map(([k, vals]) => (
                <div key={k}><strong>{k}:</strong> {vals.map((v) => <span key={v} className="chip">{v}</span>)}</div>
              ))}
            </div>
          )}
          {cacheInfo && <div className="diag" data-testid="cache-diagnostic" title="Development-only diagnostic">⚡ Product data: {cacheInfo}</div>}
        </div>
        <aside className="card buybox" data-testid="buybox">
          <Price price={product.price} mrp={product.mrp} />
          <StockBadge stock={stock} failed={stockFailed} />
          {stockFailed && <p className="muted small">Inventory service is not responding. You can still add to cart; stock is checked again at checkout.</p>}
          <label className="qty">
            Quantity
            <select value={qty} onChange={(e) => setQty(Number(e.target.value))} data-testid="quantity-select" disabled={outOfStock}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn btn--primary btn--block" disabled={adding || outOfStock} onClick={() => add(false)} data-testid="add-to-cart">
            {adding ? 'Adding…' : 'Add to Cart'}
          </button>
          <button className="btn btn--accent btn--block" disabled={adding || outOfStock} onClick={() => add(true)} data-testid="buy-now">Buy Now</button>
          {added && <div className="alert alert--success" data-testid="added-to-cart">Added to cart. <Link to="/cart">Go to cart →</Link></div>}
          {addError ? <ErrorBox error={addError} title="Could not add to cart" /> : null}
          <div className="muted small">🔒 Secure (simulated) transaction</div>
        </aside>
      </div>
    </div>
  );
}

import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Cart, formatINR } from '../api';
import { ErrorBox, Spinner } from '../components/ui';
import { ProductImage } from '../components/ProductImage';
import { useApp } from '../state';

interface Coupon { code: string; description: string; minSubtotal: number }

export function CartPage() {
  const { user, cart, cartError, refreshCart, setCart, coupon, setCoupon } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [code, setCode] = useState(coupon?.code ?? '');
  const [couponError, setCouponError] = useState<unknown>(null);
  const [offers, setOffers] = useState<Coupon[]>([]);

  useEffect(() => {
    if (!user) {
      navigate('/login?next=/cart');
      return;
    }
    void refreshCart();
    api<{ items: Coupon[] }>('GET', '/api/coupons').then((r) => setOffers(r.items)).catch(() => undefined);
  }, [user, navigate, refreshCart]);

  // A coupon applied to an older subtotal must be re-validated when the cart changes.
  useEffect(() => {
    if (coupon && cart && cart.subtotal > 0) {
      api('POST', '/api/coupons/validate', { code: coupon.code, subtotal: cart.subtotal })
        .then((r: any) => setCoupon({ code: r.code, discount: r.discount, description: r.description }))
        .catch((e) => { setCoupon(null); setCouponError(e); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart?.subtotal]);

  const mutate = async (productId: string, fn: () => Promise<Cart>) => {
    setBusy(productId);
    setError(null);
    try {
      setCart(await fn());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const applyCoupon = async (e?: FormEvent, c = code) => {
    e?.preventDefault();
    setCouponError(null);
    if (!cart) return;
    try {
      const r = await api<any>('POST', '/api/coupons/validate', { code: c, subtotal: cart.subtotal });
      setCoupon({ code: r.code, discount: r.discount, description: r.description });
      setCode(r.code);
    } catch (err) {
      setCoupon(null);
      setCouponError(err);
    }
  };

  if (!user) return null;
  if (cartError && !cart) return <div className="container page"><ErrorBox error={new Error(cartError)} title="Your cart is unavailable right now" /></div>;
  if (!cart) return <div className="container page"><Spinner label="Loading cart…" /></div>;

  if (cart.items.length === 0) {
    return (
      <div className="container page">
        <div className="card empty" data-testid="empty-cart">
          <h2>Your QAMart cart is empty</h2>
          <p className="muted">Shop today's deals and add something you love.</p>
          <Link to="/" className="btn btn--primary">Continue shopping</Link>
        </div>
      </div>
    );
  }
  const discount = coupon?.discount ?? 0;
  return (
    <div className="container page cart-page" data-testid="cart-page">
      <section className="card">
        <h1>Shopping Cart</h1>
        {error ? <ErrorBox error={error} /> : null}
        {cart.items.map((i) => (
          <div className="cart-row" key={i.productId} data-testid="cart-item" data-product-id={i.productId}>
            <ProductImage icon={i.image?.icon ?? 'phone'} color={i.image?.color ?? '#333'} size="sm" />
            <div className="cart-row__main">
              <Link to={`/product/${i.productId}`} className="cart-row__name">{i.name}</Link>
              <div className="muted small">Price when added: {formatINR(i.unitPrice)}</div>
              <div className="cart-row__actions">
                <label>Qty{' '}
                  <select value={i.quantity} disabled={busy === i.productId} data-testid="cart-qty"
                    onChange={(e) => mutate(i.productId, () => api('PATCH', `/api/cart/items/${i.productId}`, { quantity: Number(e.target.value) }))}>
                    {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => <option key={n}>{n}</option>)}
                  </select>
                </label>
                <button className="linklike" disabled={busy === i.productId} data-testid="cart-remove"
                  onClick={() => mutate(i.productId, () => api('DELETE', `/api/cart/items/${i.productId}`))}>Delete</button>
              </div>
            </div>
            <div className="cart-row__total">{formatINR(i.lineTotal)}</div>
          </div>
        ))}
        <div className="cart-subtotal">Subtotal ({cart.itemCount} item{cart.itemCount > 1 ? 's' : ''}): <strong data-testid="cart-subtotal">{formatINR(cart.subtotal)}</strong></div>
      </section>
      <aside className="card summary">
        <form onSubmit={applyCoupon} className="coupon">
          <label htmlFor="coupon">Have a coupon?</label>
          <div className="coupon__row">
            <input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10" data-testid="coupon-input" maxLength={30} />
            <button className="btn" type="submit" disabled={!code.trim()} data-testid="apply-coupon">Apply</button>
          </div>
          {coupon && (
            <div className="alert alert--success" data-testid="coupon-applied">
              <strong>{coupon.code}</strong> applied: −{formatINR(coupon.discount)}
              <button type="button" className="linklike" onClick={() => { setCoupon(null); setCode(''); }}>Remove</button>
            </div>
          )}
          {couponError ? <ErrorBox error={couponError} title="Coupon not applied" /> : null}
        </form>
        {offers.length > 0 && (
          <div className="offers">
            <div className="muted small">Available offers</div>
            {offers.map((o) => (
              <button key={o.code} type="button" className="offer" onClick={() => applyCoupon(undefined, o.code)} data-testid={`offer-${o.code}`}>
                <code>{o.code}</code> <span>{o.description}</span>
              </button>
            ))}
          </div>
        )}
        <dl className="totals">
          <dt>Items</dt><dd>{formatINR(cart.subtotal)}</dd>
          {discount > 0 && <><dt>Coupon</dt><dd className="green">−{formatINR(discount)}</dd></>}
          <dt>Delivery</dt><dd className="green">FREE</dd>
          <dt className="totals__grand">Order total</dt><dd className="totals__grand" data-testid="cart-total">{formatINR(cart.subtotal - discount)}</dd>
        </dl>
        <button className="btn btn--primary btn--block" onClick={() => navigate('/checkout')} data-testid="proceed-to-checkout">Proceed to Buy</button>
      </aside>
    </div>
  );
}

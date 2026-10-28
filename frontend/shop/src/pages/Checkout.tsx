import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, formatINR, newIdempotencyKey, Order } from '../api';
import { ErrorBox, Spinner } from '../components/ui';
import { useApp } from '../state';

const METHODS = [
  { id: 'demo_success', title: 'Demo card — payment succeeds', hint: 'Approved in ~0.3 s' },
  { id: 'demo_slow', title: 'Demo card — slow bank', hint: 'Approved after ~2 s' },
  { id: 'demo_decline', title: 'Demo card — insufficient funds', hint: 'Always declined' },
];

export function Checkout() {
  const { user, cart, refreshCart, coupon, setCoupon, setCart } = useApp();
  const navigate = useNavigate();
  // ONE idempotency key per checkout attempt: retries / double clicks reuse it, so the
  // backend can never create two orders (or two charges) for the same intent.
  const idemKey = useRef(newIdempotencyKey());
  const [address, setAddress] = useState({ name: '', line1: '12 MG Road, Indiranagar', city: 'Bengaluru', pincode: '560038', phone: '9876543210' });
  const [method, setMethod] = useState('demo_success');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) {
      navigate('/login?next=/checkout');
      return;
    }
    setAddress((a) => ({ ...a, name: a.name || user.name }));
    void refreshCart();
  }, [user, navigate, refreshCart]);

  const placeOrder = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const order = await api<Order>('POST', '/api/orders', { paymentMethod: method, couponCode: coupon?.code, shippingAddress: address }, {
        headers: { 'Idempotency-Key': idemKey.current },
        okStatuses: [202],
      });
      setCoupon(null);
      setCart({ items: [], itemCount: 0, subtotal: 0 }); // the cart service empties it asynchronously
      navigate(`/orders/${order.id ?? (order as any).order?.id}?placed=1`);
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.code === 'VALIDATION_ERROR' && Array.isArray(apiErr.details)) {
        setFieldErrors(Object.fromEntries(apiErr.details.map((d: any) => [d.field.replace('shippingAddress.', ''), d.message])));
      }
      // A definite failure ends this attempt: the next click is a NEW intent with a new key.
      if (apiErr.status !== 409 || apiErr.code === 'OUT_OF_STOCK') idemKey.current = newIdempotencyKey();
      setError(err);
      void refreshCart();
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;
  if (!cart) return <div className="container page"><Spinner /></div>;
  if (cart.items.length === 0 && !submitting) {
    return (
      <div className="container page"><div className="card empty"><h2>Nothing to check out</h2><Link className="btn btn--primary" to="/">Continue shopping</Link></div></div>
    );
  }
  const discount = coupon?.discount ?? 0;
  const failedOrder: Order | undefined = (error as ApiError)?.body?.order;
  const field = (k: keyof typeof address, label: string, props: Record<string, unknown> = {}) => (
    <label className={`field ${fieldErrors[k] ? 'has-error' : ''}`}>
      <span>{label}</span>
      <input value={address[k]} onChange={(e) => setAddress({ ...address, [k]: e.target.value })} data-testid={`address-${k}`} {...props} />
      {fieldErrors[k] && <small className="field__error" data-testid={`error-${k}`}>{fieldErrors[k]}</small>}
    </label>
  );

  return (
    <form className="container page checkout" onSubmit={placeOrder} data-testid="checkout-page" noValidate>
      <div>
        <section className="card">
          <h2>1. Delivery address</h2>
          <div className="form-grid">
            {field('name', 'Full name')}
            {field('phone', 'Mobile number', { inputMode: 'numeric', maxLength: 10 })}
            {field('line1', 'Address')}
            {field('city', 'City')}
            {field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
          </div>
        </section>
        <section className="card">
          <h2>2. Payment method</h2>
          <div className="notice">🧪 Payments are <strong>simulated</strong>. No card details are collected and no money moves.</div>
          {METHODS.map((m) => (
            <label key={m.id} className={`pay-option ${method === m.id ? 'is-selected' : ''}`}>
              <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} data-testid={`pay-${m.id}`} />
              <span><strong>{m.title}</strong><span className="muted small">{m.hint}</span></span>
            </label>
          ))}
        </section>
        <section className="card">
          <h2>3. Review items</h2>
          {cart.items.map((i) => (
            <div key={i.productId} className="review-row"><span>{i.name} × {i.quantity}</span><strong>{formatINR(i.lineTotal)}</strong></div>
          ))}
          <p className="muted small">Prices are confirmed against the catalog when you place the order.</p>
        </section>
      </div>
      <aside className="card summary">
        <button className="btn btn--primary btn--block btn--lg" type="submit" disabled={submitting} data-testid="place-order">
          {submitting ? 'Placing your order…' : 'Place your order'}
        </button>
        {submitting && <p className="muted small">Reserving stock and contacting the payment provider. Please don't close this page.</p>}
        <dl className="totals">
          <dt>Items</dt><dd>{formatINR(cart.subtotal)}</dd>
          {discount > 0 && <><dt>Coupon {coupon?.code}</dt><dd className="green">−{formatINR(discount)}</dd></>}
          <dt>Delivery</dt><dd className="green">FREE</dd>
          <dt className="totals__grand">Order total</dt><dd className="totals__grand" data-testid="checkout-total">{formatINR(cart.subtotal - discount)}</dd>
        </dl>
        {error ? <ErrorBox error={error} title={checkoutErrorTitle(error as ApiError)} /> : null}
        {failedOrder && (
          <p className="small">Order <strong>{failedOrder.orderNumber}</strong> was recorded as <code>{failedOrder.status}</code>. <Link to={`/orders/${failedOrder.id}`}>View details</Link></p>
        )}
        <div className="muted small mono" title="Sent as the Idempotency-Key header">Idempotency-Key: {idemKey.current.slice(0, 18)}…</div>
      </aside>
    </form>
  );
}

function checkoutErrorTitle(e: ApiError) {
  switch (e.code) {
    case 'PAYMENT_DECLINED': return 'Payment declined';
    case 'OUT_OF_STOCK': return 'Sorry, an item just sold out';
    case 'PAYMENT_UNAVAILABLE': return 'Payment service unavailable';
    case 'INVENTORY_UNAVAILABLE': return 'We could not check stock';
    case 'VALIDATION_ERROR': return 'Please fix the highlighted fields';
    case 'REQUEST_IN_PROGRESS': return 'Your order is already being processed';
    default: return e.code?.startsWith('COUPON') ? 'Coupon problem' : 'Could not place your order';
  }
}

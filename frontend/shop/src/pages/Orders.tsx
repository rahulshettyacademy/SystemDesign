import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatINR, Notification, Order } from '../api';
import { ErrorBox, Spinner, StatusPill } from '../components/ui';
import { useApp } from '../state';

export function OrdersPage() {
  const { user } = useApp();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!user) {
      navigate('/login?next=/orders');
      return;
    }
    api<{ items: Order[] }>('GET', '/api/orders').then((r) => setOrders(r.items)).catch(setError);
  }, [user, navigate]);

  if (!user) return null;
  return (
    <div className="container page" data-testid="orders-page">
      <h1>Your Orders</h1>
      {error ? <ErrorBox error={error} title="Order history is unavailable" /> : !orders ? <Spinner /> : orders.length === 0 ? (
        <div className="card empty" data-testid="no-orders"><h3>You have not placed any orders yet.</h3><Link to="/" className="btn btn--primary">Start shopping</Link></div>
      ) : (
        orders.map((o) => (
          <Link to={`/orders/${o.id}`} key={o.id} className="card order-card" data-testid="order-row" data-order-number={o.orderNumber}>
            <div className="order-card__head">
              <div><span className="muted small">ORDER PLACED</span><div>{new Date(o.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div></div>
              <div><span className="muted small">TOTAL</span><div>{formatINR(o.total)}</div></div>
              <div><span className="muted small">ORDER #</span><div className="mono">{o.orderNumber}</div></div>
              <StatusPill status={o.status} />
            </div>
            <div className="order-card__items">{o.items.map((i) => <span key={i.productId}>{i.name} × {i.quantity}</span>)}</div>
          </Link>
        ))
      )}
    </div>
  );
}

const STEPS = ['PENDING', 'PAYMENT_PENDING', 'CONFIRMED'];

export function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useApp();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notes, setNotes] = useState<Notification[] | null>(null);
  const [payments, setPayments] = useState<any[] | null>(null);

  useEffect(() => {
    if (!user) {
      navigate(`/login?next=/orders/${id}`);
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const started = Date.now();
    const load = async () => {
      try {
        const o = await api<Order>('GET', `/api/orders/${id}`);
        if (!alive) return;
        setOrder(o);
        const [n, p] = await Promise.all([
          api<{ items: Notification[] }>('GET', `/api/notifications?orderId=${id}`).catch(() => null),
          api<{ items: any[] }>('GET', `/api/payments?orderId=${id}`).catch(() => null),
        ]);
        if (!alive) return;
        if (n) setNotes(n.items);
        if (p) setPayments(p.items);
        // Eventual consistency: keep polling while the async parts are still settling.
        const settling = o.status === 'PAYMENT_PENDING' || o.status === 'PENDING' || (o.status === 'CONFIRMED' && (n?.items.length ?? 0) === 0);
        if (settling && Date.now() - started < 120_000) timer = window.setTimeout(load, 2000);
      } catch (e) {
        if (alive) setError(e);
      }
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, user, navigate]);

  if (!user) return null;
  if (error) return <div className="container page"><ErrorBox error={error} title="Order not found" /><Link to="/orders" className="btn">Back to your orders</Link></div>;
  if (!order) return <div className="container page"><Spinner label="Loading order…" /></div>;
  const placed = params.get('placed') === '1';
  const failed = order.status === 'PAYMENT_FAILED' || order.status === 'REJECTED';
  const stepIndex = STEPS.indexOf(order.status);

  return (
    <div className="container page order-detail" data-testid="order-detail">
      {placed && order.status === 'CONFIRMED' && (
        <div className="alert alert--success alert--big" data-testid="order-confirmation">
          <strong>✔ Order placed, thank you!</strong> Confirmation will be sent to {user.email}.
        </div>
      )}
      {order.status === 'PAYMENT_PENDING' && (
        <div className="alert alert--warn alert--big" data-testid="payment-pending">
          <strong>We are confirming your payment.</strong> The bank did not answer in time. We will check with them automatically —
          you will <strong>not</strong> be charged twice. This page updates by itself.
        </div>
      )}
      {failed && order.failure && (
        <div className="alert alert--error alert--big" data-testid="order-failure"><strong>{order.status === 'REJECTED' ? 'Order not placed' : 'Payment failed'}:</strong> {order.failure.reason}</div>
      )}
      {order.priceChanges && order.priceChanges.length > 0 && (
        <div className="alert alert--warn">Prices changed since you added items to the cart; you were charged the current price.</div>
      )}

      <div className="order-detail__grid">
        <section className="card">
          <div className="order-detail__head">
            <div>
              <h1>Order <span className="mono" data-testid="order-number">{order.orderNumber}</span></h1>
              <div className="muted">Placed {new Date(order.createdAt).toLocaleString('en-IN')}</div>
            </div>
            <StatusPill status={order.status} />
          </div>
          {!failed && (
            <ol className="progress">
              {['Order received', 'Payment', 'Confirmed'].map((label, i) => (
                <li key={label} className={i <= stepIndex ? 'is-done' : ''}>{label}</li>
              ))}
              <li className={notes && notes.length ? 'is-done' : ''}>Email sent</li>
            </ol>
          )}
          <h3>Items</h3>
          {order.items.map((i) => (
            <div key={i.productId} className="review-row"><Link to={`/product/${i.productId}`}>{i.name}</Link><span>{i.quantity} × {formatINR(i.unitPrice)}</span><strong>{formatINR(i.lineTotal)}</strong></div>
          ))}
          <dl className="totals">
            <dt>Subtotal</dt><dd>{formatINR(order.subtotal)}</dd>
            {order.discount > 0 && <><dt>Coupon {order.couponCode}</dt><dd className="green">−{formatINR(order.discount)}</dd></>}
            <dt className="totals__grand">Total</dt><dd className="totals__grand" data-testid="order-total">{formatINR(order.total)}</dd>
          </dl>
          <h3>Status history</h3>
          <ul className="timeline" data-testid="order-timeline">
            {order.events.map((e, i) => (
              <li key={i}><span className={`pill pill--${e.status.toLowerCase()}`}>{e.status}</span> <span>{e.note}</span> <time className="muted small">{new Date(e.at).toLocaleTimeString('en-IN')}</time></li>
            ))}
          </ul>
        </section>
        <aside>
          <section className="card">
            <h3>Delivery to</h3>
            <p>{order.shippingAddress.name}<br />{order.shippingAddress.line1}<br />{order.shippingAddress.city} {order.shippingAddress.pincode}<br />📞 {order.shippingAddress.phone}</p>
          </section>
          <section className="card" data-testid="payment-info">
            <h3>Payment</h3>
            <p className="small">Method: <code>{order.paymentMethod}</code> (simulated)</p>
            {payments === null ? <span className="muted small">…</span> : payments.length === 0 ? <p className="muted small">No charge was made.</p> : payments.map((p) => (
              <p key={p.paymentId} className="small">₹{p.amount.toLocaleString('en-IN')} — <strong>{p.status}</strong><br /><span className="muted">Requests received for this charge: {p.requestCount}</span></p>
            ))}
          </section>
          <section className="card" data-testid="notification-info">
            <h3>Confirmation email</h3>
            {order.status !== 'CONFIRMED' ? <p className="muted small">Sent once the order is confirmed.</p> : !notes || notes.length === 0 ? (
              <p className="small" data-testid="notification-pending">⏳ Queued — sent asynchronously by the notification service.</p>
            ) : notes.map((n) => (
              <div key={n.id} className="email" data-testid="notification-sent">
                <strong>{n.subject}</strong>
                <p className="small">{n.body}</p>
                <span className="muted small">{n.channel} · {new Date(n.createdAt).toLocaleTimeString('en-IN')}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

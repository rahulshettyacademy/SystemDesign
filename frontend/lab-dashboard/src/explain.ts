/**
 * Plain-English "why did this hop happen?" for the step-by-step replay on the Architecture page.
 * Each explanation is chosen from the hop's endpoints and the real statements/calls it contains,
 * so it describes what the code actually does (see ARCHITECTURE.md for the full flows).
 */
import { Span } from './api';

export interface HopInfo {
  from: string;
  to: string;
  /** Every span merged into this step (consecutive hops between the same two nodes). */
  group: Span[];
}
export interface Explanation {
  title: string;
  why: string;
  concepts: string[];
}

const isProduct = (n: string) => n.startsWith('product-');
const has = (names: string[], s: string) => names.some((n) => n.includes(s));
const routeOf = (s: Span) => s.name.replace(/^Nginx (internal LB )?/, '');

const OWNER: Record<string, string> = {
  auth: 'logins and users (auth_db)',
  cart: 'shopping carts (cart_db)',
  inventory: 'stock levels and reservations (inventory_db)',
  order: 'orders, coupons and checkout (order_db)',
  payment: 'payments (payment_db)',
  notification: 'confirmation e-mails (notification_db)',
};

function customerAction(route: string): string {
  if (route.startsWith('POST /api/orders')) return 'The customer clicked Place order.';
  if (route.startsWith('GET /api/products?') || route === 'GET /api/products') return 'The customer searched or opened a product list.';
  if (route.startsWith('GET /api/products/')) return 'The customer opened a product page.';
  if (route.startsWith('GET /api/inventory')) return 'The product page asks whether the item is in stock.';
  if (route.startsWith('POST /api/cart')) return 'The customer clicked Add to cart.';
  if (route.startsWith('GET /api/cart')) return 'The customer opened the cart.';
  if (route.startsWith('GET /api/notifications')) return 'The order page checks whether the confirmation e-mail has been sent.';
  if (route.startsWith('GET /api/orders')) return 'The customer opened their order history.';
  if (route.startsWith('POST /api/auth/login')) return 'The customer logged in.';
  if (route.startsWith('POST /api/coupons')) return 'The customer applied a coupon code.';
  return 'The browser made an API call.';
}

/** `root` is the request's name, e.g. "POST /api/orders". */
export function explainHop(h: HopInfo, async: boolean, root = ''): Explanation {
  const { from, to, group } = h;
  const first = group[0];
  const names = group.map((s) => s.name);
  const failed = group.some((s) => s.status === 'error');

  // ---------------------------------------------------------------- entering the system
  if (from === 'browser') {
    return {
      title: 'Request enters through the front door',
      why: `${customerAction(routeOf(first))} The browser only knows ONE public address, the Nginx gateway; it never talks to services or databases directly. Nginx stamps the request with an X-Request-ID that every service will copy into its logs and calls, which is how this whole path can be traced.`,
      concepts: ['Frontend → backend', 'REST API', 'API gateway', 'Request ID / tracing'],
    };
  }
  if (from === 'nginx') {
    const route = routeOf(first);
    const area = route.split(' ')[1]?.split('?')[0] ?? '';
    if (isProduct(to)) {
      return {
        title: `Gateway routes to ${to} (load balanced)`,
        why: `Nginx looks at the path (${area}) and sees it belongs to the product service. There are 3 identical product instances, so it picks one by round robin: this time ${to}. Any instance can answer because they keep no data of their own; they all read the same MongoDB and Redis.`,
        concepts: ['API gateway routing', 'Load balancing', 'Horizontal scaling', 'Stateless services'],
      };
    }
    return {
      title: `Gateway routes to the ${to} service`,
      why: `Nginx doesn't do any business logic. It reads the path (${area}) and forwards the request to the service that owns that area: ${to}${OWNER[to] ? `, which owns ${OWNER[to]}` : ''}. From here on, ${to} decides what happens.`,
      concepts: ['API gateway routing', 'Microservices'],
    };
  }

  // ---------------------------------------------------------------- checkout orchestration (order service)
  if (from === 'order' && to === 'postgres') {
    if (root.startsWith('POST /api/coupons') || (has(names, 'coupons') && !has(names, 'INSERT orders') && !has(names, 'coupon_redemptions'))) {
      return {
        title: 'Check the coupon rules',
        why: 'The order service owns coupons, so it checks this code against its rules in order_db: does it exist, is it active and not expired, is the order big enough, has it been fully used, has this customer already used it. This only previews the discount; the coupon is actually redeemed later, inside the checkout transaction, where the rules are checked again.',
        concepts: ['Business rules', 'Database per service', 'SQL'],
      };
    }
    if (has(names, 'INSERT orders')) {
      return {
        title: 'Create the order in one transaction',
        why: 'Order now writes the order (status PENDING), its items and, if a coupon was used, the coupon redemption, all inside ONE database transaction: either everything is saved or nothing is. It happens before stock and payment because those steps need an orderId to refer to, and a saved order is a permanent record of the attempt even if a later step fails.',
        concepts: ['ACID transaction', 'SQL', 'Order state machine'],
      };
    }
    if (has(names, 'INSERT outbox')) {
      return {
        title: 'Confirm the order and record the event',
        why: 'Payment succeeded, so the order moves to CONFIRMED. In the SAME transaction, order writes an "OrderCreated" event into its outbox table instead of sending it straight to RabbitMQ. If the service crashed right after confirming, the event would still be in the database and get sent later: no lost e-mails, no cart left full. Right after this, the 201 response goes back to the customer.',
        concepts: ['Transactional outbox', 'ACID transaction', 'Reliable messaging'],
      };
    }
    if (has(names, 'DELETE coupon_redemptions')) {
      return {
        title: 'Undo: mark the order failed and give the coupon back',
        why: 'A step failed, so order compensates for what it already did: it marks the order as failed (it stays as a record, it is not deleted), records why in the order timeline, and returns the coupon so the customer can use it again. If stock was already reserved, the next step releases it. Nothing was charged.',
        concepts: ['Compensation (saga)', 'Partial failure', 'ACID transaction'],
      };
    }
    if (has(names, 'UPDATE outbox')) {
      return {
        title: 'Mark the event as delivered',
        why: 'RabbitMQ confirmed it received the OrderCreated event, so the outbox publisher stamps the outbox row as published. Until this moment the row was the safety net: if the broker had been down, the publisher would keep retrying from this table.',
        concepts: ['Transactional outbox', 'Publisher confirms'],
      };
    }
    if (has(names, 'UPDATE orders')) {
      return {
        title: 'Stock is held: order moves to PAYMENT_PENDING',
        why: 'Inventory confirmed the items are reserved, so order records the new status and reads the final total (after any coupon discount). PAYMENT_PENDING is important: if the payment reply gets lost, a background reconciler finds orders in this state and asks payment what really happened.',
        concepts: ['Order state machine', 'SQL'],
      };
    }
    if (has(names, 'SELECT order_items') && !root.startsWith('POST /api/orders')) {
      return {
        title: 'Read the customer\'s orders',
        why: 'The order service reads the customer\'s orders, their items and status from its own order_db. It only returns orders that belong to the logged-in user (anyone else gets "not found").',
        concepts: ['Database per service', 'SQL'],
      };
    }
    if (has(names, 'SELECT order_items')) {
      return {
        title: 'Load the order to build the response',
        why: 'Order reads the order, its items and its timeline from its own database to send back the full order to the browser. Every service reads only its own database.',
        concepts: ['Database per service', 'SQL'],
      };
    }
    if (!root.startsWith('POST /api/orders')) {
      return {
        title: 'Read the customer\'s orders',
        why: 'The order service reads the customer\'s orders from its own order_db. It only returns orders that belong to the logged-in user.',
        concepts: ['Database per service', 'SQL'],
      };
    }
    return {
      title: 'Duplicate check (idempotency)',
      why: 'Before doing anything, order checks whether it has already seen this request\'s Idempotency-Key. A double-click or a browser retry sends the same key; if an order already exists for it, the existing order is returned instead of creating a second one, so the customer is never charged twice.',
      concepts: ['Idempotency', 'SQL'],
    };
  }
  if (from === 'order' && to === 'cart') {
    return {
      title: 'Ask the cart service what is being bought',
      why: 'The order service doesn\'t store carts and is not allowed to read cart_db. To know what the customer is buying, it must ask the cart service, which owns that data. It gets back product IDs, quantities and the price each item had when it was added. If cart is down, checkout stops here with 503: nothing was reserved or charged.',
      concepts: ['Synchronous microservice call', 'Data ownership', 'Database per service'],
    };
  }
  if (from === 'order' && to === 'internal-lb') {
    return {
      title: 'Get the real, current prices from product',
      why: 'The cart only knows product IDs and the price at the time each item was added, maybe days ago. Order never trusts that price (or anything the browser sends), so it asks the product service for the current name and price of each ID. Service-to-service calls go through an internal load balancer, which spreads them across the 3 product instances.',
      concepts: ['Synchronous microservice call', 'Internal load balancing', 'Never trust client prices'],
    };
  }
  if (from === 'order' && to === 'inventory') {
    if (has(names, '/release')) {
      return {
        title: 'Undo: release the reserved stock',
        why: 'The order failed after stock was reserved, so order asks inventory to put the units back on the shelf for other customers. Order can\'t change inventory_db itself; only the inventory service may. If this call fails, an inventory sweeper releases abandoned reservations after 30 minutes.',
        concepts: ['Compensation (saga)', 'Data ownership'],
      };
    }
    return {
      title: 'Reserve the stock before taking money',
      why: 'Order asks inventory to hold the items for this order. This happens BEFORE payment so we never charge for a phone we don\'t have: if 100 people race for the last 5 phones, only 5 reservations succeed and the other 95 are never charged. It\'s a reservation, not a sale, so it can be released if payment fails.',
      concepts: ['Synchronous microservice call', 'Orchestration', 'Concurrency control'],
    };
  }
  if (from === 'order' && to === 'payment') {
    return {
      title: failed ? 'Charge attempt failed: retry with the same key' : 'Charge the customer (last, because money is hardest to undo)',
      why: failed
        ? 'This charge attempt did not succeed (the payment service was unreachable or errored). Order retries up to 3 times, with short waits, and sends the SAME idempotency key (pay_<orderId>) every time, so even if an earlier attempt secretly went through, the customer can only be charged once.'
        : 'Only now that prices, coupon and stock are settled does order ask payment to charge. It sends an idempotency key, pay_<orderId>, and waits at most 3 seconds. If the reply is lost, order retries with the SAME key, so the customer can never be charged twice.',
      concepts: ['Synchronous microservice call', 'Idempotency key', 'Timeouts and retries'],
    };
  }
  if (from === 'payment' && to === 'postgres') {
    return {
      title: 'Payment records the attempt (key is UNIQUE)',
      why: 'The payment service stores the result (succeeded or declined) with its idempotency key, and the database enforces that key as UNIQUE. If the same charge arrives again (a retry after a timeout), the insert conflicts and payment returns the ORIGINAL result instead of charging again. The guarantee lives in the database, not just in code.',
      concepts: ['Idempotency', 'Database constraint', 'SQL'],
    };
  }

  // ---------------------------------------------------------------- inventory
  if (from === 'inventory' && to === 'postgres') {
    if (async) {
      return {
        title: 'Reservation becomes a sale (HELD → COMMITTED)',
        why: 'Inventory reacts to the OrderCreated event: the held units are now sold. This happens after the customer already saw "Order confirmed", so for a short moment the order is confirmed while the stock still shows "reserved". That temporary gap is eventual consistency.',
        concepts: ['Eventual consistency', 'Idempotent consumer', 'SQL transaction'],
      };
    }
    if (has(names, 'UPDATE reservations')) {
      return {
        title: 'Stock goes back on the shelf',
        why: 'Inventory moves the reserved units back to available and marks the reservation RELEASED, in one transaction. Other customers can buy them again.',
        concepts: ['Compensation (saga)', 'SQL transaction'],
      };
    }
    if (has(names, 'UPDATE stock') || has(names, 'INSERT reservation') || has(names, 'BEGIN')) {
      return {
        title: 'Hold the units, all or nothing',
        why: 'Inventory runs UPDATE stock … WHERE available >= quantity inside a transaction. The database applies this atomically, so two customers can never both take the last unit. If ANY item in the order is short, the whole reservation rolls back.',
        concepts: ['Concurrency control', 'ACID transaction', 'SQL'],
      };
    }
    return {
      title: 'Read stock levels',
      why: 'Inventory reads its own inventory_db to answer how many units are available. The product page shows this, but checkout re-checks stock at reservation time, because the number can change in the meantime.',
      concepts: ['Database per service', 'SQL'],
    };
  }

  // ---------------------------------------------------------------- products, cache and catalog
  if (from === 'cart' && to === 'internal-lb') {
    return {
      title: 'Cart asks product for the item\'s name and price',
      why: 'When an item is added, cart stores a snapshot of its name and price so the cart page can show them without calling product every time. It asks through the internal load balancer, which picks one of the 3 product instances. Checkout later re-checks this price, because snapshots go stale.',
      concepts: ['Synchronous microservice call', 'Internal load balancing', 'Data snapshot'],
    };
  }
  if (from === 'internal-lb' && isProduct(to)) {
    return {
      title: `Internal load balancer picks ${to}`,
      why: `The internal load balancer chose ${to} by round robin. The calling service doesn't know or care which copy answers; if one instance were down, the load balancer would skip it.`,
      concepts: ['Load balancing', 'Horizontal scaling'],
    };
  }
  if (isProduct(from) && to === 'redis' && has(names, 'Redis SET') && !has(names, 'Redis GET')) {
    return {
      title: 'Save a copy in the cache for next time',
      why: 'The product was loaded from MongoDB, so the product service now stores a copy in Redis under product:<id> with a TTL (60 s by default). For the next minute, every visitor to this page is answered from memory. The trade-off: if the price changes and the copy isn\'t deleted, visitors can see an old price until it expires.',
      concepts: ['Caching (Redis)', 'Cache-aside', 'TTL', 'Stale data'],
    };
  }
  if (isProduct(from) && to === 'redis') {
    const hit = group.some((s) => s.attributes?.['cache.hit'] === true);
    return {
      title: hit ? 'Cache HIT: answered from Redis' : 'Check the cache first',
      why: hit
        ? 'The product details were already in Redis (an in-memory cache), so the product service answers in about a millisecond without touching MongoDB. The copy expires after its TTL (60 s by default), or is deleted when an admin changes the price.'
        : 'The product service first looks in Redis, an in-memory cache, under the key product:<id>. It wasn\'t there (a cache MISS), so the next step reads MongoDB, and the result is then stored in Redis with a TTL so the next visitor gets it from the cache. This pattern is called cache-aside.',
      concepts: ['Caching (Redis)', 'Cache-aside', 'TTL'],
    };
  }
  if (isProduct(from) && to === 'mongodb') {
    const internal = group.some((s) => String(s.attributes?.source ?? '').includes('no cache'));
    if (internal) {
      return {
        title: 'Read prices straight from the database (no cache)',
        why: 'For checkout and cart, product reads MongoDB directly and skips Redis on purpose: money decisions must use the source of truth, not a copy that might be up to 60 seconds old.',
        concepts: ['NoSQL (MongoDB)', 'Source of truth', 'When not to cache'],
      };
    }
    return {
      title: 'Read the catalog from MongoDB',
      why: 'Products live in MongoDB, a document database: phones have specs, clothes have sizes, so each product can have different fields without changing a table schema. A product page reads from here only when the cache missed; lists and search results are always read from here.',
      concepts: ['NoSQL (MongoDB)', 'Flexible schema'],
    };
  }

  // ---------------------------------------------------------------- cart service
  if (from === 'cart' && to === 'postgres') {
    if (has(names, 'DELETE cart_items')) {
      return {
        title: 'Empty the purchased items from the cart',
        why: 'Cart reacts to the OrderCreated event by deleting the items that were just bought. It happens after the response, which is why the shop clears the cart on screen straight away while the real cart follows a moment later. Deleting twice deletes nothing, so a duplicate message is harmless.',
        concepts: ['Eventual consistency', 'Idempotent consumer'],
      };
    }
    if (has(names, 'INSERT') || has(names, 'UPDATE')) {
      return {
        title: 'Save the item in the cart',
        why: 'Cart stores the line (product, quantity, price snapshot) in its own cart_db. The cart lives in a database, not in a server\'s memory, so any instance and any device sees the same cart.',
        concepts: ['Database per service', 'Stateless services', 'SQL'],
      };
    }
    return {
      title: 'Cart reads its own database',
      why: 'The cart service reads the customer\'s cart lines from cart_db, which only it may access.',
      concepts: ['Database per service', 'SQL'],
    };
  }

  // ---------------------------------------------------------------- messaging
  if (to === 'rabbitmq') {
    return {
      title: 'Publish the OrderCreated event',
      why: 'A background publisher in the order service picks up the event from the outbox table and sends it to RabbitMQ\'s shop.events exchange. The customer already has their confirmation; everything from here is follow-up work they don\'t wait for. The exchange copies the event into one queue per interested service.',
      concepts: ['Message queue', 'Producer', 'Asynchronous processing', 'Fan-out'],
    };
  }
  if (from === 'rabbitmq') {
    const job: Record<string, string> = {
      notification: 'send (store) the confirmation e-mail',
      inventory: 'turn the stock reservation into a sale',
      cart: 'remove the purchased items from the cart',
    };
    return {
      title: `${to} receives its copy of the event`,
      why: `RabbitMQ delivers the event from ${to}'s own queue, so ${to} can ${job[to] ?? 'do its part'}. Each consumer works independently and at its own pace: if ${to} were down, the message would wait in the queue; if it kept failing, it would be retried 3 times and then moved to a dead-letter queue.`,
      concepts: ['Message queue', 'Consumer', 'Fan-out', 'Retries and DLQ'],
    };
  }
  if (from === 'notification' && to === 'mongodb') {
    if (has(names, 'insert')) {
      return {
        title: 'Store the confirmation e-mail',
        why: 'The notification service saves the e-mail document. A unique index on the event ID means that even if RabbitMQ delivers the same event twice, only one e-mail is ever stored.',
        concepts: ['NoSQL (MongoDB)', 'Idempotent consumer'],
      };
    }
    return {
      title: async ? 'Duplicate check: was this event already handled?' : 'Read notifications',
      why: async
        ? 'Message queues deliver "at least once", so the same event can arrive twice. Before sending anything, notification checks whether it already processed this event ID.'
        : 'The notification service reads the customer\'s confirmation e-mails from its own notification_db.',
      concepts: async ? ['Idempotent consumer', 'At-least-once delivery'] : ['Database per service', 'NoSQL (MongoDB)'],
    };
  }
  if (from === 'auth' && to === 'postgres') {
    return {
      title: 'Check the login',
      why: 'The auth service looks up the user in auth_db and checks the password hash. On success it issues a JWT token that the browser sends with every later request, and every service verifies it on its own.',
      concepts: ['Authentication (JWT)', 'Database per service'],
    };
  }

  // ---------------------------------------------------------------- fallback
  const via = to === 'postgres' ? 'its PostgreSQL database' : to === 'mongodb' ? 'MongoDB' : to === 'redis' ? 'the Redis cache' : `the ${to} service`;
  return {
    title: `${from} → ${to}`,
    why: `${from} ${first.kind === 'db' || first.kind === 'cache' ? 'reads or writes' : 'calls'} ${via}: ${first.name}.`,
    concepts: [first.kind === 'db' ? 'Data access' : first.kind === 'cache' ? 'Caching' : 'Synchronous microservice call'],
  };
}

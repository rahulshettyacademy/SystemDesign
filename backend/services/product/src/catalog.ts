/**
 * Deterministic product catalog. Notice that documents in the SAME collection have
 * DIFFERENT shapes (specs for phones vs sizes for clothes): that flexibility is why
 * the catalog lives in MongoDB.
 */
export interface ProductDoc {
  _id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number; // whole INR
  mrp: number;
  rating: number;
  reviews: number;
  description: string;
  image: { icon: string; color: string };
  tags: string[];
  specs?: Record<string, string>;
  variants?: Record<string, string[]>;
  highlights?: string[];
  sale?: { active: boolean; price: number; label: string; limitedStock?: number };
  updatedAt?: Date;
}

const p = (d: Omit<ProductDoc, 'tags'> & { tags?: string[] }): ProductDoc => ({ tags: [], ...d });

export const CATALOG: ProductDoc[] = [
  p({ _id: 'iphone-15-128', sku: 'MOB-APL-IP15-128', name: 'Apple iPhone 15 (128 GB) - Black', brand: 'Apple', category: 'mobiles', price: 69900, mrp: 79900, rating: 4.6, reviews: 12873,
    description: 'Dynamic Island, 48MP main camera and USB-C. Aluminium design with colour-infused glass.', image: { icon: 'phone', color: '#1f2937' },
    specs: { display: '6.1" Super Retina XDR', chip: 'A16 Bionic', storage: '128 GB', camera: '48MP + 12MP' }, tags: ['iphone', 'smartphone', '5g'],
    sale: { active: false, price: 59900, label: 'Diwali Lightning Deal', limitedStock: 5 } }),
  p({ _id: 'iphone-15-pro-256', sku: 'MOB-APL-IP15P-256', name: 'Apple iPhone 15 Pro (256 GB) - Natural Titanium', brand: 'Apple', category: 'mobiles', price: 134900, mrp: 144900, rating: 4.7, reviews: 5421,
    description: 'Titanium design, A17 Pro chip and a customisable Action button.', image: { icon: 'phone', color: '#a8a29e' },
    specs: { display: '6.1" ProMotion', chip: 'A17 Pro', storage: '256 GB', camera: '48MP + 12MP + 12MP' }, tags: ['iphone', 'smartphone', 'pro', '5g'] }),
  p({ _id: 'galaxy-s24-256', sku: 'MOB-SAM-S24-256', name: 'Samsung Galaxy S24 (256 GB) - Onyx Black', brand: 'Samsung', category: 'mobiles', price: 74999, mrp: 89999, rating: 4.4, reviews: 8320,
    description: 'Galaxy AI features with a 50MP camera and a bright 120Hz display.', image: { icon: 'phone', color: '#0f172a' },
    specs: { display: '6.2" Dynamic AMOLED 2X', chip: 'Exynos 2400', storage: '256 GB', camera: '50MP + 12MP + 10MP' }, tags: ['android', 'smartphone', '5g'],
    sale: { active: false, price: 62999, label: 'Diwali Deal' } }),
  p({ _id: 'pixel-8-128', sku: 'MOB-GOO-PX8-128', name: 'Google Pixel 8 (128 GB) - Hazel', brand: 'Google', category: 'mobiles', price: 58999, mrp: 75999, rating: 4.3, reviews: 3104,
    description: 'Tensor G3 with the helpful Pixel camera and seven years of updates.', image: { icon: 'phone', color: '#6b7f6b' },
    specs: { display: '6.2" Actua', chip: 'Tensor G3', storage: '128 GB', camera: '50MP + 12MP' }, tags: ['android', 'smartphone'] }),
  p({ _id: 'oneplus-12-256', sku: 'MOB-OPL-12-256', name: 'OnePlus 12 (256 GB) - Flowy Emerald', brand: 'OnePlus', category: 'mobiles', price: 64999, mrp: 69999, rating: 4.5, reviews: 6022,
    description: 'Snapdragon 8 Gen 3, 100W charging and a 2K 120Hz display.', image: { icon: 'phone', color: '#047857' },
    specs: { display: '6.82" 2K LTPO', chip: 'Snapdragon 8 Gen 3', storage: '256 GB', camera: '50MP + 64MP + 48MP' }, tags: ['android', 'smartphone', '5g'] }),
  p({ _id: 'macbook-air-m3', sku: 'LAP-APL-MBA-M3', name: 'Apple MacBook Air 13" M3 (8 GB / 256 GB)', brand: 'Apple', category: 'laptops', price: 104900, mrp: 114900, rating: 4.7, reviews: 2210,
    description: 'Strikingly thin, up to 18 hours of battery life and the M3 chip.', image: { icon: 'laptop', color: '#64748b' },
    specs: { cpu: 'Apple M3', ram: '8 GB', storage: '256 GB SSD', display: '13.6" Liquid Retina' }, tags: ['macbook', 'ultrabook'] }),
  p({ _id: 'dell-xps-13', sku: 'LAP-DEL-XPS13', name: 'Dell XPS 13 (Core Ultra 7, 16 GB / 512 GB)', brand: 'Dell', category: 'laptops', price: 139990, mrp: 159990, rating: 4.3, reviews: 811,
    description: 'Edge-to-edge InfinityEdge display in a machined aluminium chassis.', image: { icon: 'laptop', color: '#334155' },
    specs: { cpu: 'Intel Core Ultra 7', ram: '16 GB', storage: '512 GB SSD', display: '13.4" FHD+' }, tags: ['windows', 'ultrabook'] }),
  p({ _id: 'thinkpad-e14', sku: 'LAP-LEN-E14', name: 'Lenovo ThinkPad E14 Gen 5 (Ryzen 5, 16 GB / 512 GB)', brand: 'Lenovo', category: 'laptops', price: 62990, mrp: 82990, rating: 4.2, reviews: 1290,
    description: 'Business-class durability with a legendary keyboard.', image: { icon: 'laptop', color: '#111827' },
    specs: { cpu: 'AMD Ryzen 5 7530U', ram: '16 GB', storage: '512 GB SSD', display: '14" WUXGA' }, tags: ['windows', 'business'],
    sale: { active: false, price: 54990, label: 'Diwali Deal' } }),
  p({ _id: 'airpods-pro-2', sku: 'AUD-APL-APP2', name: 'Apple AirPods Pro (2nd Gen) with USB-C', brand: 'Apple', category: 'audio', price: 20900, mrp: 24900, rating: 4.6, reviews: 15320,
    description: 'Active Noise Cancellation, Adaptive Audio and personalised spatial audio.', image: { icon: 'earbuds', color: '#e5e7eb' },
    specs: { type: 'In-ear TWS', anc: 'Yes', battery: '6h (30h with case)' }, tags: ['earbuds', 'anc', 'wireless'] }),
  p({ _id: 'sony-wh1000xm5', sku: 'AUD-SON-XM5', name: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones', brand: 'Sony', category: 'audio', price: 29990, mrp: 34990, rating: 4.5, reviews: 7710,
    description: 'Industry-leading noise cancellation with 30 hours of battery.', image: { icon: 'headphones', color: '#1e293b' },
    specs: { type: 'Over-ear', anc: 'Yes', battery: '30h' }, tags: ['headphones', 'anc', 'wireless'],
    sale: { active: false, price: 24990, label: 'Diwali Deal' } }),
  p({ _id: 'boat-airdopes-141', sku: 'AUD-BOT-AD141', name: 'boAt Airdopes 141 TWS Earbuds', brand: 'boAt', category: 'audio', price: 1299, mrp: 4490, rating: 4.0, reviews: 45120,
    description: '42 hours of playback with ENx noise cancellation for calls.', image: { icon: 'earbuds', color: '#1d4ed8' },
    specs: { type: 'In-ear TWS', anc: 'ENx (calls)', battery: '42h total' }, tags: ['earbuds', 'budget', 'wireless'],
    sale: { active: false, price: 899, label: 'Diwali Lightning Deal', limitedStock: 10 } }),
  p({ _id: 'jbl-flip-6', sku: 'AUD-JBL-FLIP6', name: 'JBL Flip 6 Portable Bluetooth Speaker', brand: 'JBL', category: 'audio', price: 9999, mrp: 14999, rating: 4.5, reviews: 5302,
    description: 'Bold JBL Pro Sound, IP67 waterproof and 12 hours of play.', image: { icon: 'speaker', color: '#dc2626' },
    specs: { type: 'Portable speaker', waterproof: 'IP67', battery: '12h' }, tags: ['speaker', 'party'] }),
  p({ _id: 'apple-watch-s9', sku: 'WEA-APL-W9-41', name: 'Apple Watch Series 9 GPS 41mm', brand: 'Apple', category: 'wearables', price: 41900, mrp: 44900, rating: 4.6, reviews: 2980,
    description: 'Brighter display, double tap gesture and advanced health features.', image: { icon: 'watch', color: '#f43f5e' },
    specs: { display: '41mm Always-On Retina', battery: '18h', water: 'WR50' }, tags: ['smartwatch'] }),
  p({ _id: 'noise-colorfit-pro5', sku: 'WEA-NOI-CFP5', name: 'Noise ColorFit Pro 5 Smartwatch', brand: 'Noise', category: 'wearables', price: 3499, mrp: 7999, rating: 4.1, reviews: 18640,
    description: '1.85" AMOLED display, Bluetooth calling and 100+ sports modes.', image: { icon: 'watch', color: '#0ea5e9' },
    specs: { display: '1.85" AMOLED', battery: '7 days', water: 'IP68' }, tags: ['smartwatch', 'budget'],
    sale: { active: false, price: 2499, label: 'Diwali Deal' } }),
  p({ _id: 'samsung-tv-55-qled', sku: 'TV-SAM-Q55', name: 'Samsung 55" Crystal 4K QLED Smart TV', brand: 'Samsung', category: 'tv', price: 54990, mrp: 79900, rating: 4.3, reviews: 4410,
    description: 'Quantum Dot colour, 4K upscaling and Tizen smart platform.', image: { icon: 'tv', color: '#0f172a' },
    specs: { size: '55 inch', resolution: '4K UHD', panel: 'QLED', refresh: '60Hz' }, tags: ['television', '4k'],
    sale: { active: false, price: 44990, label: 'Diwali Deal', limitedStock: 3 } }),
  p({ _id: 'mi-tv-43', sku: 'TV-XIA-A43', name: 'Xiaomi 43" 4K Ultra HD Smart Google TV', brand: 'Xiaomi', category: 'tv', price: 24999, mrp: 42999, rating: 4.2, reviews: 22010,
    description: 'Dolby Vision, Google TV and a bezel-less metal frame.', image: { icon: 'tv', color: '#f97316' },
    specs: { size: '43 inch', resolution: '4K UHD', panel: 'LED', refresh: '60Hz' }, tags: ['television', '4k', 'google tv'] }),
  p({ _id: 'diya-set-12', sku: 'HOM-DIY-12', name: 'Handcrafted Terracotta Diya Set (Pack of 12)', brand: 'Kumhaar Crafts', category: 'home', price: 499, mrp: 999, rating: 4.4, reviews: 3120,
    description: 'Hand-painted clay diyas for Diwali. Reusable and eco-friendly.', image: { icon: 'diya', color: '#ea580c' },
    variants: { finish: ['Classic Red', 'Gold Painted'] }, tags: ['diwali', 'decor', 'festive'],
    sale: { active: false, price: 349, label: 'Festive Special' } }),
  p({ _id: 'led-string-lights', sku: 'HOM-LED-15M', name: 'Warm White LED String Lights (15 m)', brand: 'Brightlane', category: 'home', price: 399, mrp: 899, rating: 4.1, reviews: 9930,
    description: '100 LEDs with 8 lighting modes. Perfect for Diwali balconies.', image: { icon: 'lights', color: '#facc15' },
    variants: { colour: ['Warm White', 'Multicolour'] }, tags: ['diwali', 'decor', 'lights'] }),
  p({ _id: 'brass-pooja-thali', sku: 'HOM-BRS-THALI', name: 'Brass Pooja Thali Set (7 pieces)', brand: 'Pital Ghar', category: 'home', price: 1499, mrp: 2499, rating: 4.5, reviews: 1180,
    description: 'Traditional brass thali with diya, bell, kalash and incense stand.', image: { icon: 'thali', color: '#ca8a04' },
    tags: ['diwali', 'pooja', 'festive'] }),
  p({ _id: 'silk-kurta-men', sku: 'FAS-KUR-SILK', name: "Men's Art Silk Festive Kurta", brand: 'Utsav Threads', category: 'fashion', price: 1299, mrp: 2999, rating: 4.0, reviews: 2560,
    description: 'Comfort-fit art silk kurta with mandarin collar for festive occasions.', image: { icon: 'shirt', color: '#7c3aed' },
    variants: { size: ['S', 'M', 'L', 'XL'], colour: ['Royal Purple', 'Maroon', 'Ivory'] }, tags: ['diwali', 'ethnic', 'kurta'] }),
  p({ _id: 'banarasi-saree', sku: 'FAS-SAR-BNR', name: 'Banarasi Silk Blend Saree with Blouse Piece', brand: 'Kashi Looms', category: 'fashion', price: 2499, mrp: 5999, rating: 4.3, reviews: 1870,
    description: 'Zari-woven Banarasi saree, 6.3 m with an unstitched blouse piece.', image: { icon: 'saree', color: '#be123c' },
    variants: { colour: ['Crimson', 'Emerald', 'Gold'] }, tags: ['diwali', 'ethnic', 'saree'],
    sale: { active: false, price: 1799, label: 'Festive Special' } }),
  p({ _id: 'instant-pot-6l', sku: 'APP-INP-6L', name: 'Electric Pressure Cooker 6 L (7-in-1)', brand: 'Instant Pot', category: 'appliances', price: 8999, mrp: 12999, rating: 4.4, reviews: 6120,
    description: 'Pressure cook, slow cook, sauté, steam and more in one pot.', image: { icon: 'cooker', color: '#475569' },
    specs: { capacity: '6 L', power: '1000 W', programs: '13' }, tags: ['kitchen'] }),
  p({ _id: 'dyson-v12', sku: 'APP-DYS-V12', name: 'Dyson V12 Detect Slim Cordless Vacuum', brand: 'Dyson', category: 'appliances', price: 49900, mrp: 58900, rating: 4.4, reviews: 980,
    description: 'Laser reveals microscopic dust; piezo sensor counts particles.', image: { icon: 'vacuum', color: '#a855f7' },
    specs: { runtime: '60 min', weight: '2.2 kg', bin: '0.35 L' }, tags: ['cleaning', 'diwali cleaning'] }),
  p({ _id: 'kindle-paperwhite', sku: 'ELE-AMZ-KPW', name: 'E-Reader Paperwhite 16 GB (Signature Look)', brand: 'Readwell', category: 'wearables', price: 14999, mrp: 16999, rating: 4.6, reviews: 4300,
    description: '7" glare-free display, adjustable warm light and weeks of battery.', image: { icon: 'reader', color: '#14532d' },
    specs: { display: '7" 300ppi', storage: '16 GB', water: 'IPX8' }, tags: ['ebook', 'reader'] }),
];

export const CATEGORIES: Record<string, string> = {
  mobiles: 'Mobiles',
  laptops: 'Laptops',
  audio: 'Audio',
  wearables: 'Wearables',
  tv: 'Televisions',
  home: 'Home & Festive',
  fashion: 'Fashion',
  appliances: 'Appliances',
};

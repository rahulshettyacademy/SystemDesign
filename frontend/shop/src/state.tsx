import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiCall, Cart, getToken, onApiCall, onUnauthorized, setToken, User } from './api';

interface AppState {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  cart: Cart | null;
  cartError: string | null;
  refreshCart: () => Promise<void>;
  setCart: (c: Cart) => void;
  coupon: { code: string; discount: number; description: string } | null;
  setCoupon: (c: AppState['coupon']) => void;
  calls: ApiCall[];
  labMode: boolean;
  /** false until we know whether the stored token is still valid */
  ready: boolean;
}

const Ctx = createContext<AppState>(null!);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<AppState['coupon']>(null);
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [labMode, setLabMode] = useState(false);
  const [ready, setReady] = useState(!getToken());

  useEffect(
    () =>
      onApiCall((c) => {
        if (c.servedBy) setLabMode(true); // diagnostic headers only exist in LAB_MODE
        setCalls((prev) => [c, ...prev].slice(0, 80));
      }),
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setCart(null);
    setCoupon(null);
  }, []);
  useEffect(() => {
    onUnauthorized(logout);
  }, [logout]);

  const refreshCart = useCallback(async () => {
    if (!getToken()) return setCart(null);
    try {
      setCart(await api<Cart>('GET', '/api/cart'));
      setCartError(null);
    } catch (e) {
      setCartError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<{ user: User }>('GET', '/api/auth/me')
      .then((r) => setUser(r.user))
      .then(refreshCart)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [refreshCart]);

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string; user: User }>('POST', '/api/auth/login', { email, password });
    setToken(r.token);
    setUser(r.user);
    await refreshCart();
  };

  return (
    <Ctx.Provider value={{ user, login, logout, cart, cartError, refreshCart, setCart, coupon, setCoupon, calls, labMode, ready }}>
      {children}
    </Ctx.Provider>
  );
}

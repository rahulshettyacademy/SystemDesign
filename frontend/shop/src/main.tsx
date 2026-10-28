import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppProvider, useApp } from './state';
import { Spinner } from './components/ui';
import { Footer, Header } from './components/Header';
import { ApiInspector } from './components/ApiInspector';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { ProductPage } from './pages/Product';
import { CartPage } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { OrderDetail, OrdersPage } from './pages/Orders';
import { Login, NotFound } from './pages/Login';
import './styles.css';

function Layout() {
  const { pathname } = useLocation();
  const { ready } = useApp();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <>
      <Header />
      <main className="main">{ready ? <Outlet /> : <div className="container page"><Spinner /></div>}</main>
      <Footer />
      <ApiInspector />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);

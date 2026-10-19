// Handle asynchronous operations, primarily code-splitting
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Loading from './components/Loading';

import MenteeDashboard from './pages/MenteeDashboard';
// vite.config.js excludes it from service-worker precache
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

export default function App() {
  return (
    <Routes>
      <Route path='/' element={<MenteeDashboard />} />
      <Route path='/admin' element={
        <Suspense fallback={<Loading />}>
          <AdminDashboard />
        </Suspense>
      } />
      <Route path='*' element={<MenteeDashboard/>} />
    </Routes>
  )
}
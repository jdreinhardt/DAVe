import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AppLayout from './pages/AppLayout';
import ContactsPage from './pages/ContactsPage';
import CalendarPage from './pages/CalendarPage';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/contacts" replace /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'calendar', element: <CalendarPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

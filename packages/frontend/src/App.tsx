import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import AppLayout from './pages/AppLayout';
import ContactsPage from './pages/ContactsPage';
import CalendarPage from './pages/CalendarPage';
import TasksPage from './pages/TasksPage';
import NotesPage from './pages/NotesPage';
import JournalsPage from './pages/JournalsPage';
import HomeRedirect from './components/HomeRedirect';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'contacts', element: <ContactsPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'journals', element: <JournalsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

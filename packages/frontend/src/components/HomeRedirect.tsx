import { Navigate } from 'react-router-dom';
import { useSettings } from '../contexts/Settings';

/**
 * The "/" index route: sends you to your configured home view.
 *
 * Waits for the settings context to finish its server sync first. On a browser
 * that has never run the app there is no localStorage copy yet, so redirecting
 * immediately would always land on the built-in default and ignore the
 * preference stored server-side.
 */
export default function HomeRedirect() {
  const { homeView, ready } = useSettings();

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return <Navigate to={`/${homeView}`} replace />;
}

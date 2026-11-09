import App from './App';
import LandingPage from './LandingPage';

const appHash = '#app';

export default function ProductShell() {
  const [started, setStarted] = React.useState(() => window.location.hash === appHash);

  React.useEffect(() => {
    function onHashChange() {
      setStarted(window.location.hash === appHash);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (!started) {
    return (
      <LandingPage
        onStart={() => {
          window.location.hash = appHash;
        }}
      />
    );
  }
  return <App />;
}

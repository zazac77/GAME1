import { useGame } from '../store/game';
import { Layout } from './Layout';
import { StartScreen } from './StartScreen';

export function App() {
  const hasGame = useGame((s) => s.game !== null);
  return hasGame ? <Layout /> : <StartScreen />;
}

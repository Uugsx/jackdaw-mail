import './app.css';
import './icon-motion.css';
import { loadUILocale } from '../l10n/l10n';

/* Сначала перевод, потом приложение: модули зовут gt() прямо при загрузке,
 * а переводы теперь грузятся отдельным чанком только для выбранного языка. */
loadUILocale()
  .catch(console.error)
  .finally(() => import('./startApp'))
  .catch(console.error);

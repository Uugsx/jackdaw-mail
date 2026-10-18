import type { Collection } from "svelte-collections";

/**
 * Отписывает коллекцию от `source.filterObservable()` от источника и от каждого
 * его элемента. Сама библиотека этого не делает (TODO в её `filter.js`): если
 * пересоздавать фильтр в `$:`, старые копии остаются подписанными на все
 * элементы и пересчитываются при каждом их изменении.
 */
export function releaseObservableFilter<T>(
  source: Collection<T> | null | undefined,
  filtered: Collection<T> | null | undefined,
): void {
  let observer = (filtered as any)?._observer;
  if (!source || !observer) {
    return;
  }
  source.unregisterObserver(observer);
  let itemObservers = observer.itemObservers as Map<T, () => void> | undefined;
  for (let unsubscribe of itemObservers?.values() ?? []) {
    unsubscribe();
  }
  itemObservers?.clear();
}

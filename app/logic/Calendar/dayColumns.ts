/** Колонка события в дневном и недельном виде */
export interface DayColumn {
  /** Номер колонки, с 0 */
  column: number;
  /** Сколько колонок у группы пересекающихся событий */
  columns: number;
}

interface TimeSpan {
  startTime: Date;
  endTime: Date;
}

/** Раскладывает события одного дня по колонкам так, чтобы событие весь день оставалось в своей колонке.
 *
 * Раньше колонки считались отдельно для каждого часа: событие, начавшееся справа,
 * в следующем часе перескакивало влево и наезжало на соседнее.
 *
 * Пересекающиеся (в том числе через третье событие) события образуют группу.
 * Каждое занимает первую свободную колонку, ширина колонки — по числу колонок группы. */
export function layoutDayColumns<T extends TimeSpan>(events: Iterable<T>): Map<T, DayColumn> {
  let sorted = [...events].sort((a, b) =>
    a.startTime.getTime() - b.startTime.getTime() ||
    b.endTime.getTime() - a.endTime.getTime());
  let result = new Map<T, DayColumn>();
  let group: { event: T, column: DayColumn }[] = [];
  /** Время окончания последнего события в каждой колонке группы */
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;

  function closeGroup() {
    for (let { column } of group) {
      column.columns = columnEnds.length;
    }
    group = [];
    columnEnds = [];
  }

  for (let event of sorted) {
    let start = event.startTime.getTime();
    let end = Math.max(event.endTime.getTime(), start);
    if (start >= groupEnd) {
      closeGroup();
      groupEnd = -Infinity;
    }
    let column = columnEnds.findIndex(columnEnd => columnEnd <= start);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    groupEnd = Math.max(groupEnd, end);
    let layout: DayColumn = { column, columns: 1 };
    group.push({ event, column: layout });
    result.set(event, layout);
  }
  closeGroup();
  return result;
}

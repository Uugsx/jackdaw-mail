/** In strings, this is the separator between the actual string and the comment for translators or machine translation.
 * This allows to give context to short strings.
 * It also allows to disambiguate "read" (past tense) between "read" (instruction).
 *
 * Отдельный модуль без зависимостей от Vite: его импортирует экстрактор строк,
 * который запускается в Node, где `import.meta.glob` из messagesLoader недоступен. */
export const commentSymbol = " *=> ";

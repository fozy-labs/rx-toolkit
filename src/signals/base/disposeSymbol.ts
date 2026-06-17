/**
 * Полифилл-безопасная ссылка на well-known символ `Symbol.dispose`.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol/dispose
 */
export const SYMBOL_DISPOSE: typeof Symbol.dispose =
    Symbol.dispose ?? (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);

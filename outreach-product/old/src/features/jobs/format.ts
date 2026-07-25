export function humanize(value: string) {
  return value
    .replace(/([\p{Ll}\d])(\p{Lu})/gu, "$1 $2")
    .replaceAll(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

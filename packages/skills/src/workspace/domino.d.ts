// turndown's HTML parser. Its own types declare the module under its old name, "domino".
declare module "@mixmark-io/domino" {
  export function createDocument(html?: string, force?: boolean): Document;
}

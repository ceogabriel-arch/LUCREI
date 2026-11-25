declare module 'json-bigint' {
  type JsonBigInt = {
    parse(text: string): unknown;
    stringify(value: unknown): string;
  };
  function jsonBigint(options?: { storeAsString?: boolean; useNativeBigInt?: boolean; alwaysParseAsBig?: boolean }): JsonBigInt;
  export = jsonBigint;
}

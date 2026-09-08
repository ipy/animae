/** Derive dotted key paths from a nested `as const` catalog object. */
export type MessageKeyOf<T, Prefix extends string = ""> = T extends string
  ? Prefix extends "" ? never : Prefix
  : {
      [K in keyof T & string]: MessageKeyOf<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
    }[keyof T & string];

export type ParamsForKey<_Catalog, _Key extends string> = Record<string, string | number | boolean | Date | null | undefined>;

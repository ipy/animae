export interface AssetEntry {
  body: Uint8Array;
  contentType: string;
  etag: string;
  modified?: number;
}

export interface AssetProvider {
  get(path: string): Promise<AssetEntry | null>;
  /** Logical root for CSP / debugging (optional). */
  readonly label?: string;
}

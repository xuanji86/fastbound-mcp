/**
 * Lean response types for the FastBound endpoints this server reads.
 *
 * Hand-written on purpose: the live spec has 104 schemas but we touch a subset.
 * Request bodies are validated/typed via zod (see src/schemas). Treat the spec at
 * https://cloud.fastbound.com/swagger/v1-account/swagger.json (v1 Account API) as
 * the reference if these drift.
 */

/** All list endpoints share a `records` total; the array key varies by resource. */
export interface PagedBase {
  records: number;
}

export interface ItemsList extends PagedBase {
  items: FastBoundItem[];
}
export interface AcquisitionsList extends PagedBase {
  acquisitions: unknown[];
}
export interface DispositionsList extends PagedBase {
  dispositions: unknown[];
}
export interface ContactsList extends PagedBase {
  contacts: unknown[];
}
export interface UsersList extends PagedBase {
  users: unknown[];
}

export interface SmartListResponse {
  smartList: string[];
}

export interface Account {
  number: number;
  name: string;
  itemsInInventory: number;
  settings?: unknown;
  owner?: unknown;
}

/** The firearm record as returned by reads. Fields are optional for forward-compat. */
export interface FastBoundItem {
  id?: string;
  externalId?: string;
  itemNumber?: string;
  serial?: string;
  manufacturer?: string;
  countryOfManufacture?: string;
  importer?: string;
  model?: string;
  type?: string;
  caliber?: string;
  location?: string;
  condition?: string;
  mpn?: string;
  upc?: string;
  sku?: string;
  barrelLength?: number;
  overallLength?: number;
  price?: number;
  cost?: number;
  acquisitionType?: string;
  acquisitionContactId?: string;
  dispositionType?: string;
  dispositionId?: string;
  dispositionContactId?: string;
  ttsn?: string;
  otsn?: string;
  deleted?: boolean;
  disposed?: boolean;
  isTheftLoss?: boolean;
  isDestroyed?: boolean;
  doNotDispose?: boolean;
  status?: unknown;
  notes?: unknown[];
  attachments?: unknown[];
  [key: string]: unknown;
}

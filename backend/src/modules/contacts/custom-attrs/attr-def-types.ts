/**
 * attr-def-types.ts — TS types for custom attribute definitions.
 */

export const DATA_TYPES = ['string', 'number', 'date', 'boolean', 'enum'] as const;
export type DataType = (typeof DATA_TYPES)[number];

export interface AttrDef {
  id: string;
  orgId: string;
  key: string;
  label: string;
  dataType: DataType;
  enumValues: string[] | null;
  required: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAttrDefInput {
  key: string;
  label: string;
  dataType: DataType;
  enumValues?: string[] | null;
  required?: boolean;
}

export interface UpdateAttrDefInput {
  label?: string;
  enumValues?: string[] | null;
  required?: boolean;
}

export interface AttrValidationError {
  key: string;
  code: 'unknown_key' | 'invalid_type' | 'invalid_enum' | 'required_missing' | 'value_too_long';
  message: string;
}

export type AttrValidationResult =
  | { ok: true }
  | { ok: false; errors: AttrValidationError[] };

/**
 * attr-def-service.ts — CRUD service for CustomAttributeDefinition.
 * Key and dataType are immutable after creation. Key must match ^[a-z][a-z0-9_]*$.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { Prisma } from '@prisma/client';
import { invalidateDefCache } from './attr-validator.js';
import type { AttrDef, CreateAttrDefInput, UpdateAttrDefInput, DataType } from './attr-def-types.js';
import { DATA_TYPES } from './attr-def-types.js';

const KEY_REGEX = /^[a-z][a-z0-9_]*$/;

export class AttrDefError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AttrDefError';
  }
}

function toAttrDef(r: {
  id: string;
  orgId: string;
  key: string;
  label: string;
  dataType: string;
  enumValues: unknown;
  required: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AttrDef {
  return {
    id: r.id,
    orgId: r.orgId,
    key: r.key,
    label: r.label,
    dataType: r.dataType as DataType,
    enumValues: Array.isArray(r.enumValues) ? (r.enumValues as string[]) : null,
    required: r.required,
    deletedAt: r.deletedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listAttrDefs(orgId: string): Promise<AttrDef[]> {
  const rows = await prisma.customAttributeDefinition.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toAttrDef);
}

export async function createAttrDef(orgId: string, input: CreateAttrDefInput): Promise<AttrDef> {
  if (!KEY_REGEX.test(input.key)) {
    throw new AttrDefError(
      'key must match ^[a-z][a-z0-9_]*$ (lowercase, start with letter)',
      'invalid_key',
    );
  }
  if (!DATA_TYPES.includes(input.dataType)) {
    throw new AttrDefError(
      `dataType must be one of: ${DATA_TYPES.join(', ')}`,
      'invalid_data_type',
    );
  }
  if (input.dataType === 'enum') {
    if (!Array.isArray(input.enumValues) || input.enumValues.length === 0) {
      throw new AttrDefError('enumValues required when dataType is enum', 'enum_values_required');
    }
  }

  try {
    const row = await prisma.customAttributeDefinition.create({
      data: {
        orgId,
        key: input.key,
        label: input.label.trim(),
        dataType: input.dataType,
        enumValues: input.enumValues ?? Prisma.JsonNull,
        required: input.required ?? false,
      },
    });
    invalidateDefCache(orgId);
    return toAttrDef(row);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint') // Prisma P2002
    ) {
      throw new AttrDefError(`key "${input.key}" already exists for this org`, 'duplicate_key');
    }
    throw err;
  }
}

export async function updateAttrDef(
  orgId: string,
  id: string,
  input: UpdateAttrDefInput & { key?: unknown; dataType?: unknown },
): Promise<AttrDef> {
  if ('key' in input && input.key !== undefined) {
    throw new AttrDefError('key is immutable after creation', 'key_immutable');
  }
  if ('dataType' in input && input.dataType !== undefined) {
    throw new AttrDefError('dataType is immutable after creation', 'data_type_immutable');
  }

  const existing = await prisma.customAttributeDefinition.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!existing) throw new AttrDefError('Attribute definition not found', 'not_found');

  if (input.enumValues !== undefined && existing.dataType !== 'enum') {
    throw new AttrDefError('enumValues only applies to enum dataType', 'invalid_enum_update');
  }

  const updated = await prisma.customAttributeDefinition.update({
    where: { id },
    data: {
      label: input.label !== undefined ? input.label.trim() : undefined,
      enumValues: input.enumValues !== undefined
        ? (input.enumValues === null ? Prisma.JsonNull : input.enumValues)
        : undefined,
      required: input.required !== undefined ? input.required : undefined,
    },
  });
  invalidateDefCache(orgId);
  return toAttrDef(updated);
}

export async function softDeleteAttrDef(orgId: string, id: string): Promise<void> {
  const existing = await prisma.customAttributeDefinition.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!existing) throw new AttrDefError('Attribute definition not found', 'not_found');

  await prisma.customAttributeDefinition.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  invalidateDefCache(orgId);
}

export async function getAttrDefsByOrg(orgId: string): Promise<AttrDef[]> {
  return listAttrDefs(orgId);
}

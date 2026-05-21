/**
 * lead-field-mapper.ts — Map Facebook Lead Ads field_data to CRM fields.
 *
 * fieldData shape from Graph API:
 *   [{ name: "tên_đầy_đủ", values: ["Trần Thu Giang"] }, ...]
 *
 * fieldMap configured by admin in FacebookFormMapping.fieldMap:
 *   { "tên_đầy_đủ": "name", "số_điện_thoại": "phone", "email": "email" }
 *
 * Unmapped fields land in customFields (raw FB field name as key).
 */

export interface LeadFieldData {
  name: string;
  values: string[];
}

export interface MappedLeadFields {
  name?: string;
  phone?: string;
  email?: string;
  customFields: Record<string, string>;
}

/**
 * Apply admin-configured fieldMap to Facebook form field_data array.
 *
 * - Takes values[0] from each field (FB always sends array even for single value).
 * - Known targets: "name", "phone", "email" → mapped to top-level fields.
 * - Any field not in fieldMap, OR mapped to unknown target → goes to customFields
 *   under its original FB field name.
 */
export function applyFieldMap(
  fieldData: LeadFieldData[],
  fieldMap: Record<string, string>,
): MappedLeadFields {
  const result: MappedLeadFields = { customFields: {} };

  for (const field of fieldData) {
    const rawValue = field.values?.[0] ?? '';
    const target = fieldMap[field.name];

    if (target === 'name') {
      result.name = rawValue || undefined;
    } else if (target === 'phone') {
      result.phone = rawValue || undefined;
    } else if (target === 'email') {
      result.email = rawValue || undefined;
    } else {
      // Unmapped or unknown target → preserve in customFields
      if (rawValue) {
        result.customFields[field.name] = rawValue;
      }
    }
  }

  return result;
}

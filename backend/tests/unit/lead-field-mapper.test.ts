/**
 * Unit tests for applyFieldMap.
 */
import { describe, it, expect } from 'vitest';
import { applyFieldMap } from '../../src/modules/integrations/providers/facebook/lead-field-mapper.js';

describe('applyFieldMap', () => {
  const fieldMap = {
    'tên_đầy_đủ': 'name',
    'số_điện_thoại': 'phone',
    'email': 'email',
  };

  it('maps name + phone + email correctly', () => {
    const fieldData = [
      { name: 'tên_đầy_đủ', values: ['Trần Thu Giang'] },
      { name: 'số_điện_thoại', values: ['0908123456'] },
      { name: 'email', values: ['giang@example.com'] },
    ];
    const result = applyFieldMap(fieldData, fieldMap);
    expect(result.name).toBe('Trần Thu Giang');
    expect(result.phone).toBe('0908123456');
    expect(result.email).toBe('giang@example.com');
    expect(result.customFields).toEqual({});
  });

  it('unmapped fields go into customFields', () => {
    const fieldData = [
      { name: 'tên_đầy_đủ', values: ['Nguyễn A'] },
      { name: 'số_điện_thoại', values: ['0901234567'] },
      { name: 'Ghi chú', values: ['Quan tâm 3PN'] },
      { name: 'Dự án', values: ['Vinhomes'] },
    ];
    const result = applyFieldMap(fieldData, fieldMap);
    expect(result.name).toBe('Nguyễn A');
    expect(result.customFields['Ghi chú']).toBe('Quan tâm 3PN');
    expect(result.customFields['Dự án']).toBe('Vinhomes');
    expect(Object.keys(result.customFields)).toHaveLength(2);
  });

  it('missing mapped fields → undefined (not null)', () => {
    const fieldData = [
      { name: 'tên_đầy_đủ', values: ['Lê B'] },
      // no phone, no email
    ];
    const result = applyFieldMap(fieldData, fieldMap);
    expect(result.name).toBe('Lê B');
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it('empty values array → field skipped from customFields', () => {
    const fieldData = [
      { name: 'unknown_field', values: [] },
    ];
    const result = applyFieldMap(fieldData, {});
    expect(result.customFields).toEqual({});
  });

  it('empty fieldMap → all fields go to customFields', () => {
    const fieldData = [
      { name: 'full_name', values: ['John'] },
      { name: 'phone_number', values: ['0901000000'] },
    ];
    const result = applyFieldMap(fieldData, {});
    expect(result.name).toBeUndefined();
    expect(result.customFields['full_name']).toBe('John');
    expect(result.customFields['phone_number']).toBe('0901000000');
  });

  it('values array with multiple items → takes first', () => {
    const fieldData = [
      { name: 'số_điện_thoại', values: ['0908111222', '0908333444'] },
    ];
    const result = applyFieldMap(fieldData, fieldMap);
    expect(result.phone).toBe('0908111222');
  });

  it('empty string value for mapped field → undefined', () => {
    const fieldData = [
      { name: 'tên_đầy_đủ', values: [''] },
    ];
    const result = applyFieldMap(fieldData, fieldMap);
    expect(result.name).toBeUndefined();
  });

  it('empty fieldData array → all undefined, empty customFields', () => {
    const result = applyFieldMap([], fieldMap);
    expect(result.name).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.customFields).toEqual({});
  });
});

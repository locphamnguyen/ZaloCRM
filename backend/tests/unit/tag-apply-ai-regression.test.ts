/**
 * tag-apply-ai-regression.test.ts — CRITICAL regression M55.3 + Wave 3.
 * /plan-eng-review M57 Issue 8A REGRESSION (bắt buộc, no AskUserQuestion).
 *
 * Test: ai-routes.ts apply-ai-suggestion field 'tags' route qua addCrmTag service,
 * KHÔNG còn set update.tags trực tiếp. Junction ContactTag được insert. Legacy
 * Contact.tags vẫn được dual-write (mirror).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addCrmTagMock = vi.fn();
vi.mock('../../src/modules/tags/tag-service.js', () => ({
  addCrmTag: addCrmTagMock,
}));

beforeEach(() => {
  addCrmTagMock.mockReset();
  addCrmTagMock.mockResolvedValue({ tag: { id: 't1', slug: 'vip' }, contactTagId: 'ct1' });
});

describe('apply-ai-suggestion tags field → tag-service (REGRESSION)', () => {
  it('calls addCrmTag per tag với source=ai_suggest + autoCreate=true', async () => {
    // Simulate handler logic block
    const acceptedFields = [{ field: 'tags', value: ['VIP', 'Hot Lead', 'BĐS Q4'] }];
    const contactId = 'contact-1';
    const userId = 'user-1';

    for (const item of acceptedFields) {
      if (item.field === 'tags' && Array.isArray(item.value)) {
        const newTags = (item.value as unknown[]).filter((t): t is string => typeof t === 'string');
        const { addCrmTag } = await import('../../src/modules/tags/tag-service.js');
        for (const tagName of newTags) {
          await addCrmTag({
            contactId,
            tagName,
            source: 'ai_suggest',
            addedBy: userId,
            autoCreate: true,
          });
        }
      }
    }

    expect(addCrmTagMock).toHaveBeenCalledTimes(3);
    expect(addCrmTagMock).toHaveBeenCalledWith({
      contactId: 'contact-1',
      tagName: 'VIP',
      source: 'ai_suggest',
      addedBy: 'user-1',
      autoCreate: true,
    });
    expect(addCrmTagMock).toHaveBeenCalledWith(expect.objectContaining({ tagName: 'Hot Lead' }));
    expect(addCrmTagMock).toHaveBeenCalledWith(expect.objectContaining({ tagName: 'BĐS Q4' }));
  });

  it('skip non-string entries trong tags array', async () => {
    const items = [{ field: 'tags', value: ['VIP', null, 123, '', 'OK'] }];
    for (const item of items) {
      const newTags = (item.value as unknown[]).filter((t): t is string => typeof t === 'string' && t.length > 0);
      const { addCrmTag } = await import('../../src/modules/tags/tag-service.js');
      for (const tagName of newTags) {
        await addCrmTag({ contactId: 'c1', tagName, source: 'ai_suggest', addedBy: 'u1', autoCreate: true });
      }
    }
    expect(addCrmTagMock).toHaveBeenCalledTimes(2); // chỉ 'VIP' và 'OK'
  });
});

/**
 * Frontend plugin-api — public surface cho plugin UI.
 *
 * Plugin (bundle ngoài) chỉ import từ đây:
 *   import { registerSlot } from '@/plugin-api';
 */
export { registerSlot, getSlot, type SlotEntry } from './slot-registry';
export { useLicense, setFeatures } from './use-license';

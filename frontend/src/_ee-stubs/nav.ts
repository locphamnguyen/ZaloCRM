// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Community-edition stub for extension navigation (open-core).
 * Mirrors the public API of src/_ee/nav.ts with empty data.
 */
import type { SettingsItem } from '@/composables/use-settings-nav';

export const eeSettingsItems: Record<string, SettingsItem[]> = {};

export interface TopNavShortcut {
  to: string;
  title: string;
  icon: string;
  resource: string;
}

export const eeTopNavShortcuts: TopNavShortcut[] = [];

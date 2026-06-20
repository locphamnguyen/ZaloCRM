// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/** Community stub — automation Block type (open-core). */
export interface Block {
  id: string;
  name?: string;
  [k: string]: unknown;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Open-core seam — automation event bus.
 *
 * Core subsystems (chat, contacts, zalo) EMIT domain events here. In the
 * Extension edition the automation engine bridges these into its internal bus
 * and reacts to them (see _ee/automation). In the Community edition nothing
 * subscribes, so emits are cheap no-ops.
 *
 * This file lives in core and is identical across editions.
 */
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';

export interface AutomationEvent<T = unknown> {
  type: string;
  orgId: string;
  occurredAt: Date;
  contactId?: string;
  segmentHint?: { kind: 'all' | 'import-batch' | 'filter'; [key: string]: unknown };
  payload?: T;
}

const BUS_EVENT = 'automation-event';

class CoreAutomationEventBus {
  private emitter = new EventEmitter();

  emit(event: AutomationEvent): void {
    try {
      this.emitter.emit(BUS_EVENT, event);
    } catch (err) {
      logger.error('[ee.event-bus] listener error:', err);
    }
  }

  /** Subscribe to all events. Returns an unsubscribe function. */
  on(listener: (event: AutomationEvent) => Promise<void> | void): () => void {
    const wrapped = (event: AutomationEvent) => {
      void (async () => {
        try {
          await listener(event);
        } catch (err) {
          logger.error('[ee.event-bus] listener threw:', err);
        }
      })();
    };
    this.emitter.on(BUS_EVENT, wrapped);
    return () => this.emitter.off(BUS_EVENT, wrapped);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners(BUS_EVENT);
  }
}

export const automationEventBus = new CoreAutomationEventBus();

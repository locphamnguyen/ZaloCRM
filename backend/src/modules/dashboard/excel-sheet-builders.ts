// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * excel-sheet-builders.ts — ExcelJS worksheet builders for each report type.
 * Each function adds a worksheet to the provided workbook and populates it with data.
 */
import ExcelJS from 'exceljs';
import { prisma } from '../../shared/database/prisma-client.js';

export async function buildMessagesSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Tin nhắn');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Đã gửi', key: 'sent', width: 12 },
    { header: 'Đã nhận', key: 'received', width: 12 },
    { header: 'Tổng', key: 'total', width: 12 },
  ];

  const rows = await prisma.$queryRaw<
    Array<{ date: Date; sent: bigint; received: bigint; total: bigint }>
  >`
    SELECT
      DATE(m.sent_at) AS date,
      COUNT(*) FILTER (WHERE m.sender_type = 'self') AS sent,
      COUNT(*) FILTER (WHERE m.sender_type = 'contact') AS received,
      COUNT(*) AS total
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.org_id = ${orgId}
      AND m.sent_at >= ${from}::date
      AND m.sent_at < (${to}::date + interval '1 day')
    GROUP BY DATE(m.sent_at)
    ORDER BY date ASC
  `;

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      sent: Number(r.sent),
      received: Number(r.received),
      total: Number(r.total),
    });
  }
}

export async function buildContactsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Liên hệ');
  sheet.columns = [
    { header: 'Ngày', key: 'date', width: 15 },
    { header: 'Liên hệ mới', key: 'count', width: 15 },
  ];

  const rows = await prisma.$queryRaw<Array<{ date: Date; count: bigint }>>`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM contacts
    WHERE org_id = ${orgId}
      AND created_at >= ${from}::date
      AND created_at < (${to}::date + interval '1 day')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;

  for (const r of rows) {
    sheet.addRow({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      count: Number(r.count),
    });
  }
}

export async function buildAppointmentsSheet(
  workbook: ExcelJS.Workbook,
  orgId: string,
  from: string,
  to: string,
): Promise<void> {
  const sheet = workbook.addWorksheet('Lịch hẹn');
  sheet.columns = [
    { header: 'Trạng thái', key: 'status', width: 20 },
    { header: 'Số lượng', key: 'count', width: 12 },
  ];

  const dateFilter = { gte: new Date(from), lte: new Date(to) };
  const stats = await prisma.appointment.groupBy({
    by: ['status'],
    where: { orgId, appointmentDate: dateFilter },
    _count: true,
  });

  for (const s of stats) {
    sheet.addRow({ status: s.status, count: s._count });
  }
}

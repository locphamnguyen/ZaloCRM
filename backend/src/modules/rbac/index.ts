/**
 * RBAC plugin — Department + PermissionGroup + UserAssignment (Phase 4 batch 3).
 * Gom 3 hàm register của module RBAC vào 1 plugin.
 */
import type { ZaloCrmPlugin } from '../../plugin-api/index.js';
import { registerDepartmentRoutes } from './department-routes.js';
import { registerPermissionGroupRoutes } from './permission-group-routes.js';
import { registerUserAssignmentRoutes } from './user-assignment-routes.js';

export const rbacPlugin: ZaloCrmPlugin = {
  name: 'rbac',
  version: '1.0.0',
  edition: 'core',
  async register({ app }) {
    await registerDepartmentRoutes(app);
    await registerPermissionGroupRoutes(app);
    await registerUserAssignmentRoutes(app);
  },
};

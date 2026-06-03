import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  // Folder mode (prismaSchemaFolder, Prisma 7): gộp mọi file *.prisma trong prisma/schema/.
  schema: 'prisma/schema',
  // Giữ migrations ở prisma/migrations (sibling) thay vì trong schema folder.
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});

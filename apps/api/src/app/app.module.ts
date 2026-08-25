import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    // No entities exist yet (schema/migrations land in Story 1.2) — this
    // module's only job right now is to prove apps/api can reach the
    // Compose Postgres instance via DATABASE_URL, with no hardcoded
    // connection values (AD-5) and a fail-fast error if it's missing/invalid.
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const { DATABASE_URL } = validateEnv();
        return {
          type: 'postgres',
          url: DATABASE_URL,
          entities: [],
          synchronize: false,
        };
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

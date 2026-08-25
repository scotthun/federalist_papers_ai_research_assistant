import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDataSourceOptions } from '@federalist-research/database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './env.validation';

@Module({
  imports: [
    // Entities/migrations wiring is shared with the standalone migrate/ingest Nx targets (see
    // libs/database's data-source.ts) so the running app and the migration runner can never
    // drift on what schema exists. Connection target comes from DATABASE_URL at runtime (AD-5)
    // -- never hardcoded -- with a fail-fast error if it's missing/invalid.
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const { DATABASE_URL } = validateEnv();
        return createDataSourceOptions(DATABASE_URL);
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

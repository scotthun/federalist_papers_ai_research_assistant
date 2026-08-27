import { Module } from '@nestjs/common';
import { createAIProviderProvider } from './ai-provider.provider';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  controllers: [PapersController],
  // createAIProviderProvider() (Story 2.2): the AI_PROVIDER token PapersService injects to back
  // GET /api/papers/search/semantic -- see that file's doc comment for why it's lazy rather than
  // an eager `useFactory: () => createAIProvider()`.
  providers: [PapersService, createAIProviderProvider()],
})
export class PapersModule {}

import { Module } from '@nestjs/common';
import { createAIProviderProvider } from '../ai-provider.provider';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  controllers: [PapersController],
  // createAIProviderProvider() (Story 2.2, moved to app/ in Story 3.1 once AskModule needed the
  // same lazy wrapper): the AI_PROVIDER token PapersService injects to back
  // GET /api/papers/search/semantic -- see that file's doc comment for why it's lazy rather than
  // an eager `useFactory: () => createAIProvider()`.
  providers: [PapersService, createAIProviderProvider()],
})
export class PapersModule {}

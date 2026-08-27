import { Module } from '@nestjs/common';
import { createAIProviderProvider } from '../ai-provider.provider';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

@Module({
  controllers: [AskController],
  // createAIProviderProvider() (shared with PapersModule, see that file's doc comment): the
  // AI_PROVIDER token AskService injects for both retrieval's query embedding and the confident
  // tier's generateStructuredOutput call.
  providers: [AskService, createAIProviderProvider()],
})
export class AskModule {}

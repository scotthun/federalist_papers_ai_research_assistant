import { Module } from '@nestjs/common';
import {
  createEmbeddingProviderProvider,
  createGenerationProviderProvider,
  createPaperReferenceExtractorProvider,
} from '../ai-provider.provider';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';

@Module({
  controllers: [AskController],
  // createEmbeddingProviderProvider() (shared with PapersModule) + createGenerationProviderProvider()
  // (see ai-provider.provider.ts's doc comments): AskService injects both -- EMBEDDING_PROVIDER for
  // retrieval's query embedding (always Gemini) and GENERATION_PROVIDER for the confident tier's
  // generateStructuredOutput call (gemini or openrouter, per AI_PROVIDER).
  // createPaperReferenceExtractorProvider() (spec-explicit-paper-number-pinning.md): the seam
  // AskService depends on to detect paper numbers named explicitly in the question text itself.
  providers: [
    AskService,
    createEmbeddingProviderProvider(),
    createGenerationProviderProvider(),
    createPaperReferenceExtractorProvider(),
  ],
})
export class AskModule {}

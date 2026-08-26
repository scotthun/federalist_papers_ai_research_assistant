import { Test, TestingModule } from '@nestjs/testing';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

describe('PapersController', () => {
  let controller: PapersController;
  let service: { findAll: jest.Mock };

  beforeEach(async () => {
    service = { findAll: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [PapersController],
      providers: [{ provide: PapersService, useValue: service }],
    }).compile();

    controller = app.get<PapersController>(PapersController);
  });

  it('delegates to PapersService.findAll and returns its result', async () => {
    const papers = [{ paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] }];
    service.findAll.mockResolvedValue(papers);

    await expect(controller.findAll()).resolves.toEqual(papers);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });
});

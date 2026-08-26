import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

describe('PapersController', () => {
  let controller: PapersController;
  let service: { findAll: jest.Mock; findOne: jest.Mock; search: jest.Mock };

  beforeEach(async () => {
    service = { findAll: jest.fn(), findOne: jest.fn(), search: jest.fn() };

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

  describe('search', () => {
    it('delegates to PapersService.search with the raw query and returns its result', async () => {
      const papers = [{ paperNumber: 51, title: 'The Structure of the Government', authors: ['Hamilton'] }];
      service.search.mockResolvedValue(papers);

      await expect(controller.search('Hamilton')).resolves.toEqual(papers);
      expect(service.search).toHaveBeenCalledWith('Hamilton');
    });

    it('passes an empty string to PapersService.search when q is absent', async () => {
      service.search.mockResolvedValue([]);

      await expect(controller.search(undefined)).resolves.toEqual([]);
      expect(service.search).toHaveBeenCalledWith('');
    });

    it('returns an empty array when the service finds no matches', async () => {
      service.search.mockResolvedValue([]);

      await expect(controller.search('zzznonsensezzz')).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('delegates to PapersService.findOne with the parsed paperNumber and returns its result', async () => {
      const detail = {
        paperNumber: 1,
        title: 'General Introduction',
        authors: ['Hamilton'],
        fullText: 'Paragraph one.\n\nParagraph two.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
      };
      service.findOne.mockResolvedValue(detail);

      await expect(controller.findOne('1')).resolves.toEqual(detail);
      expect(service.findOne).toHaveBeenCalledWith(1);
    });

    it('throws NotFoundException when the service returns null', async () => {
      service.findOne.mockResolvedValue(null);

      await expect(controller.findOne('999')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a non-numeric route segment without calling the service', async () => {
      await expect(controller.findOne('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(service.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a non-integer numeric route segment', async () => {
      await expect(controller.findOne('1.5')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(service.findOne).not.toHaveBeenCalled();
    });

    // Number() + Number.isInteger() alone would silently accept all of these -- they must go
    // through parsePaperNumberRouteSegment's stricter check instead (see its own spec in
    // libs/shared for the exhaustive cases; these confirm the controller actually wires it up).
    it.each([
      ['0x10', 'hex notation'],
      ['1e2', 'exponential notation'],
      ['1.0', 'a decimal fraction that is numerically a whole number'],
      ['+1', 'a leading "+"'],
    ])(
      'throws NotFoundException for %s (%s) without calling the service',
      async (segment) => {
        await expect(controller.findOne(segment)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(service.findOne).not.toHaveBeenCalled();
      },
    );
  });
});

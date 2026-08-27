import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

describe('PapersController', () => {
  let controller: PapersController;
  let service: {
    findAll: jest.Mock;
    findOne: jest.Mock;
    search: jest.Mock;
    searchSemantic: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      search: jest.fn(),
      searchSemantic: jest.fn(),
    };

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

  describe('searchSemantic', () => {
    it('delegates to PapersService.searchSemantic with the raw query and no options when none are given', async () => {
      const chunks = [
        {
          chunkId: 'chunk-1',
          paperNumber: 51,
          paperTitle: 'The Structure of the Government',
          content: 'Ambition must be made to counteract ambition.',
          score: 0.87,
        },
      ];
      service.searchSemantic.mockResolvedValue(chunks);

      await expect(
        controller.searchSemantic('how does government check itself'),
      ).resolves.toEqual(chunks);
      expect(service.searchSemantic).toHaveBeenCalledWith(
        'how does government check itself',
        {},
      );
    });

    it('passes an empty string to the service when q is absent', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic(undefined);

      expect(service.searchSemantic).toHaveBeenCalledWith('', {});
    });

    it('parses topK and paperNumber into RetrieveOptions', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic('executive power', '3', '70');

      expect(service.searchSemantic).toHaveBeenCalledWith('executive power', {
        topK: 3,
        paperNumber: 70,
      });
    });

    it('passes a trimmed author option through', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic('union', undefined, undefined, '  Madison  ');

      expect(service.searchSemantic).toHaveBeenCalledWith('union', { author: 'Madison' });
    });

    it('omits a blank/whitespace-only author instead of passing it through', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic('union', undefined, undefined, '   ');

      expect(service.searchSemantic).toHaveBeenCalledWith('union', {});
    });

    // Malformed topK/paperNumber (Number()-lenient lookalikes, negatives, non-numeric junk)
    // must never crash the request -- they're simply ignored, same "never a hang or an
    // unhandled crash" contract as the rest of this controller's query-param handling.
    it.each(['0x10', '1e2', '1.0', '-3', 'abc'])(
      'ignores a malformed topK value (%s) instead of passing it through',
      async (malformed) => {
        service.searchSemantic.mockResolvedValue([]);

        await controller.searchSemantic('union', malformed);

        expect(service.searchSemantic).toHaveBeenCalledWith('union', {});
      },
    );

    // A malformed paperNumber changes result-set semantics (an unintended filter), not just a
    // limit -- same parsePositiveIntQueryParam helper as topK above, so it must be just as safe.
    it.each(['0x10', '1e2', '1.0', '-3', 'abc'])(
      'ignores a malformed paperNumber value (%s) instead of passing it through as a filter',
      async (malformed) => {
        service.searchSemantic.mockResolvedValue([]);

        await controller.searchSemantic('union', undefined, malformed);

        expect(service.searchSemantic).toHaveBeenCalledWith('union', {});
      },
    );

    // No upper bound previously meant `?topK=999999` passed straight through as the SQL LIMIT.
    it('clamps a topK value above the maximum (50) instead of passing it through unbounded', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic('union', '999999');

      expect(service.searchSemantic).toHaveBeenCalledWith('union', { topK: 50 });
    });

    it('passes a topK value at the maximum (50) through unchanged', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic('union', '50');

      expect(service.searchSemantic).toHaveBeenCalledWith('union', { topK: 50 });
    });

    it('normalizes a repeated query param to its first value for every param', async () => {
      service.searchSemantic.mockResolvedValue([]);

      await controller.searchSemantic(['a', 'b'], ['3', '5'], ['70', '80'], ['Hamilton', 'Madison']);

      expect(service.searchSemantic).toHaveBeenCalledWith('a', {
        topK: 3,
        paperNumber: 70,
        author: 'Hamilton',
      });
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

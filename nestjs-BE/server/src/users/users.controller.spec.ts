import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { HttpStatus } from '@nestjs/common';
import { RequestWithUser } from '../utils/interface';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: { findUserJoinedSpaces: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
  });

  it('findUserJoinedSpaces', async () => {
    const reqMock = { user: { uuid: 'user uuid' } } as RequestWithUser;
    const spacesMock = [];

    (usersService.findUserJoinedSpaces as jest.Mock).mockResolvedValue(
      spacesMock,
    );

    const response = controller.findUserJoinedSpaces(reqMock);

    await expect(response).resolves.toEqual({
      statusCode: HttpStatus.OK,
      message: 'OK',
      data: spacesMock,
    });
  });
});
